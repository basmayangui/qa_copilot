/**
 * Types et utilitaires partagés autour des cas de test validés.
 *
 * Le parser Gherkin sert principalement à la page "Générer des cas de
 * tests" pour découper la sortie LLM en cartes individuelles
 * (Valider/Éditer par scénario). Les types ValidatedTestCase / TestCasePayload
 * sont utilisés par les trois pages : test-cases, test-scripts, campaigns.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// --------------------------------------------------------------------
// Backend payloads
// --------------------------------------------------------------------
export type DetailLevel = "standard" | "avance" | "expert";

export type TestType =
  | "fonctionnels"
  | "non_regression"
  | "performance"
  | "stress";

export type ValidatedTestCase = {
  id: string;
  title: string;
  tags: string[];
  gherkin: string;
  source_spec: string;
  detail_level: DetailLevel;
  feature: string;
  project_name: string;
  test_type: TestType;
  created_at: string;
  updated_at: string;
};

export type TestCasePayload = {
  title: string;
  gherkin: string;
  tags?: string[];
  source_spec?: string;
  detail_level?: DetailLevel;
  feature?: string;
  project_name?: string;
  test_type?: TestType;
};

// --------------------------------------------------------------------
// Parser Gherkin → scénarios individuels
// --------------------------------------------------------------------
export type ParsedScenario = {
  /** Identifiant stable côté client pour les états React. */
  clientId: string;
  /** Texte après "Scenario:" ou "Scenario Outline:". */
  title: string;
  /** Tags Gherkin attachés (ligne précédant le Scenario). */
  tags: string[];
  /** Bloc complet (tags + Scenario + steps + éventuels Examples). */
  rawText: string;
};

export type ParsedGherkin = {
  feature: string | null;
  background: string | null;
  scenarios: ParsedScenario[];
};

// Gherkin est internationalisé : on accepte aussi bien les mots-clés
// anglais que français pour ne pas rater une génération que le LLM
// produit en FR par mimétisme avec le prompt.
//
// Les deux-points après le mot-clé sont théoriquement obligatoires mais
// les LLM les omettent parfois ("Scenario Accès..." au lieu de
// "Scenario: Accès..."). On accepte donc colon OU whitespace après le
// keyword, suivi du titre.
const SCENARIO_RE =
  /^(?:Scenario(?: Outline)?|Sc[ée]nario(?: Outline)?|Plan du Sc[ée]nario|Exemple|Example)(?::|\s)\s*(.+)$/i;
const FEATURE_RE = /^(?:Feature|Fonctionnalit[ée])(?::|\s)\s*(.+)$/i;
const BACKGROUND_RE = /^(?:Background|Contexte)(?::|\s)\s*(.*)$/i;
const TAG_LINE_RE = /^\s*@[\w-]+(?:\s+@[\w-]+)*\s*$/;

// Plage de "blancs invisibles" Unicode qui ne sont pas couverts par
// String.prototype.trim() : zero-width joiner/non-joiner, BOM, etc.
// Certains LLM en sèment parfois en début de ligne, ce qui casse la
// reconnaissance des mots-clés Gherkin si on s'appuie uniquement sur
// trim() + ^Keyword.
const INVISIBLE_LEADING = "[\\s\\u200B-\\u200F\\u2028\\u2029\\uFEFF\\u00A0]*";

// Mots-clés des étapes Gherkin (EN + FR). Exporté car ré-utilisé dans
// app/test-cases pour la détection des scénarios incomplets et pour
// la coloration du GherkinViewer.
export const STEP_KEYWORD_RE = new RegExp(
  `^${INVISIBLE_LEADING}(Given|When|Then|And|But|[ÉE]tant donn[ée]|Quand|Alors|Et|Mais)\\b`,
  "i",
);

// Regex spécialisées par type — servent au splitter multi-When et à la
// résolution du type "hérité" des steps And/But.
const GIVEN_RE = new RegExp(
  `^${INVISIBLE_LEADING}(Given|[ÉE]tant donn[ée])\\b`,
  "i",
);
const WHEN_RE = new RegExp(
  `^${INVISIBLE_LEADING}(When|Quand)\\b`,
  "i",
);
const THEN_RE = new RegExp(
  `^${INVISIBLE_LEADING}(Then|Alors)\\b`,
  "i",
);
const AND_BUT_RE = new RegExp(
  `^${INVISIBLE_LEADING}(And|But|Et|Mais)\\b`,
  "i",
);

type ResolvedStepType = "given" | "when" | "then" | null;

function classifyStep(line: string, prev: ResolvedStepType): ResolvedStepType {
  if (GIVEN_RE.test(line)) return "given";
  if (WHEN_RE.test(line)) return "when";
  if (THEN_RE.test(line)) return "then";
  if (AND_BUT_RE.test(line)) return prev; // hérite du type précédent
  return null;
}

// Regex qui capture le mot-clé + le reste de la ligne, en absorbant
// tout blanc invisible éventuel devant. Utilisée par normalizeStepIndent.
const STEP_SPLIT_RE = new RegExp(
  `^${INVISIBLE_LEADING}(Given|When|Then|And|But|[ÉE]tant donn[ée]|Quand|Alors|Et|Mais)(.*)$`,
  "i",
);

// Lignes de section : Scenario:, Feature:, Background:, Examples: et
// leurs équivalents français. On les ramène à la colonne 0 pour avoir
// une convention Gherkin standard et stable.
const SECTION_SPLIT_RE = new RegExp(
  `^${INVISIBLE_LEADING}(Scenario(?: Outline)?|Sc[ée]nario(?: Outline)?|Plan du Sc[ée]nario|Feature|Fonctionnalit[ée]|Background|Contexte|Examples|Exemples|Rule)(.*)$`,
  "i",
);

// Lignes "parasites" qu'on supprime du Gherkin rendu :
// - fences markdown ``` que certains LLM mettent malgré la consigne
// - séparateurs horizontaux markdown (---, ***, ___) que Mistral ajoute
//   parfois entre plusieurs Features pour "structurer" sa réponse
// - lignes 100% vides de fences seules
const FENCE_LINE_RE = /^\s*(?:```\s*\w*|-{3,}|\*{3,}|_{3,})\s*$/;

const STEP_LEADING_INDENT = "  "; // 2 espaces avant le mot-clé

/**
 * Calcule la largeur du mot-clé le plus long présent dans le code, de
 * sorte que le contenu de toutes les lignes step démarre à la même
 * colonne après normalisation. Plancher à 5 ("Given") pour garder une
 * marge visuelle même quand seuls des mots-clés courts sont utilisés.
 */
function maxStepKeywordWidth(code: string): number {
  let max = 5;
  for (const line of code.split("\n")) {
    const m = line.match(STEP_SPLIT_RE);
    if (m && m[1].length > max) max = m[1].length;
  }
  return max;
}

/**
 * Normalise une step line : 2 espaces d'indent, mot-clé padé à la
 * largeur cible, puis le reste tel quel. Effet : les phrases qui
 * suivent les mots-clés démarrent toutes à la même colonne.
 *
 *   "Given foo"     → "  Given foo"
 *   "When bar"      → "  When  bar"
 *   "And baz"       → "  And   baz"
 *   "  Then qux"    → "  Then  qux"
 *
 * Les lignes qui ne sont pas des steps (Scenario:, tags, tables,
 * commentaires, etc.) sont laissées intactes.
 */
/**
 * Ramène une ligne de section (Scenario:, Feature:, Background:,
 * Examples:, etc.) à la colonne 0 en absorbant tout blanc invisible.
 * Garantit que toutes les sections démarrent à la même position quel
 * que soit le caprice d'indentation du LLM.
 */
function normalizeSectionIndent(line: string): string {
  const m = line.match(SECTION_SPLIT_RE);
  if (!m) return line;
  const keyword = m[1];
  const rest = m[2];
  return `${keyword}${rest.trimEnd()}`;
}

function normalizeStepIndent(line: string, kwWidth: number): string {
  if (!line.trim()) return line;
  // STEP_SPLIT_RE absorbe directement les éventuels caractères invisibles
  // en tête de ligne, donc pas besoin de trim explicite ici.
  const m = line.match(STEP_SPLIT_RE);
  if (!m) return line;
  const keyword = m[1];
  const rest = m[2]; // inclut l'espace initial après le mot-clé s'il y en a
  const padding = " ".repeat(Math.max(kwWidth - keyword.length, 0));
  // On normalise l'espacement entre le keyword (paddé) et le contenu à
  // EXACTEMENT un espace : on retire tous les espaces de tête éventuels
  // ("Given    foo" → "foo"), puis on préfixe par " ". Sans ça, des
  // LLM verbeux qui mettent 3-4 espaces après le keyword cassent
  // l'alignement parce que padding + leur whitespace = total variable.
  const content = rest.replace(/^\s+/, "").trimEnd();
  // Cas dégénéré : keyword sans contenu (step tronqué) → on évite
  // une espace pendante en fin de ligne.
  if (!content) {
    return `${STEP_LEADING_INDENT}${keyword}${padding}`;
  }
  return `${STEP_LEADING_INDENT}${keyword}${padding} ${content}`;
}

/**
 * Applique l'ensemble des normalisations Gherkin à un texte entier :
 * strip des fences markdown, sections ramenées à la colonne 0, steps
 * indentées et alignées sur le contenu. Source de vérité unique pour
 * tous les chemins de réécriture (hydratation localStorage, édition,
 * etc.) — applique exactement les mêmes transformations que parseGherkin.
 */
export function normalizeGherkinText(text: string): string {
  if (!text) return text;
  const kwWidth = maxStepKeywordWidth(text);
  return text
    .split("\n")
    .filter((line) => !FENCE_LINE_RE.test(line))
    .map((line) => normalizeSectionIndent(line))
    .map((line) => normalizeStepIndent(line, kwWidth))
    .join("\n");
}

/**
 * Découpe un document Gherkin en scénarios.
 *
 * Le parser est volontairement tolérant : il n'exige pas de Feature
 * en tête, accepte les blocs sans tags, et conserve les Examples
 * intégrés à leur Scenario Outline parent.
 */
export function parseGherkin(code: string): ParsedGherkin {
  // Pré-pass : applique trois normalisations sur le code brut LLM avant
  // le découpage en scénarios :
  // 1. Strip les fences markdown ```...``` que le LLM peut laisser
  //    malgré la consigne.
  // 2. Ramène les lignes de section (Scenario:, Feature:, etc.) à la
  //    colonne 0.
  // 3. Force l'indent + padding sur chaque step pour aligner le contenu.
  const kwWidth = maxStepKeywordWidth(code);
  const lines = code
    .split("\n")
    .filter((line) => !FENCE_LINE_RE.test(line))
    .map((line) => normalizeSectionIndent(line))
    .map((line) => normalizeStepIndent(line, kwWidth));

  let feature: string | null = null;
  let background: string | null = null;
  const scenarios: ParsedScenario[] = [];

  let pendingTags: string[] = [];
  let currentBlock: string[] = [];
  let currentTitle: string | null = null;
  let currentTags: string[] = [];
  let inBackground = false;
  let backgroundBlock: string[] = [];

  const flushScenario = () => {
    if (currentTitle === null) return;

    // Consolidation des tags : tout ce qui était attaché AVANT
    // `Scenario:` (currentTags) + toute ligne de tags trouvée DANS le
    // bloc (cas LLM mal placé). Doublons éliminés en gardant l'ordre.
    const seen = new Set<string>();
    const allTags: string[] = [];
    for (const tag of currentTags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        allTags.push(tag);
      }
    }

    // On reconstruit le rawText SANS les lignes de tags, pour éviter
    // la double affichage (badges dans le bandeau + ligne dans le code).
    const bodyLines: string[] = [];
    for (const blockLine of currentBlock) {
      const t = blockLine.trim();
      if (TAG_LINE_RE.test(t)) {
        for (const tag of t.split(/\s+/).filter((x) => x.startsWith("@"))) {
          if (!seen.has(tag)) {
            seen.add(tag);
            allTags.push(tag);
          }
        }
        // ligne de tags : on l'extrait, on ne la garde pas dans le body
        continue;
      }
      bodyLines.push(blockLine);
    }

    scenarios.push({
      clientId: `scn-${scenarios.length}`,
      title: currentTitle,
      tags: allTags,
      rawText: bodyLines.join("\n").replace(/\n+$/, ""),
    });
    currentTitle = null;
    currentBlock = [];
    currentTags = [];
  };

  /**
   * Regarde les lignes suivantes en sautant les lignes vides et les
   * autres lignes de tags. Renvoie la 1ère ligne « réelle » trouvée.
   * Sert à décider si une ligne de tags est une frontière de scénario
   * (suivie d'un Scenario:) ou simplement mal placée à l'intérieur.
   */
  const peekNextReal = (startIdx: number): string => {
    for (let j = startIdx; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "") continue;
      if (TAG_LINE_RE.test(t)) continue;
      return t;
    }
    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ligne vide : on la conserve dans le bloc courant pour préserver
    // la mise en forme du Gherkin
    if (trimmed === "") {
      if (currentTitle !== null) currentBlock.push(line);
      else if (inBackground) backgroundBlock.push(line);
      continue;
    }

    const mFeature = trimmed.match(FEATURE_RE);
    if (mFeature) {
      flushScenario();
      feature = mFeature[1].trim() || null;
      inBackground = false;
      continue;
    }

    const mBackground = trimmed.match(BACKGROUND_RE);
    if (mBackground) {
      flushScenario();
      inBackground = true;
      backgroundBlock = [line];
      continue;
    }

    // Ligne de tags : on regarde ce qui vient APRÈS pour décider.
    if (TAG_LINE_RE.test(trimmed)) {
      const next = peekNextReal(i + 1);
      const isBoundary = SCENARIO_RE.test(next);

      if (isBoundary) {
        // Standard Gherkin : tags juste avant un Scenario:. Quel que
        // soit l'état (dans un scénario ou non), c'est une FRONTIÈRE.
        flushScenario();
        if (inBackground) {
          background = backgroundBlock.join("\n").trim();
          inBackground = false;
          backgroundBlock = [];
        }
        // On cumule (au cas où plusieurs lignes de tags consécutives)
        const newTags = trimmed
          .split(/\s+/)
          .filter((t) => t.startsWith("@"));
        pendingTags = [...pendingTags, ...newTags];
        continue;
      }

      // Pas suivi de Scenario: → tags mal placés à l'intérieur. On les
      // conserve dans le bloc courant pour ne pas les perdre.
      if (currentTitle !== null) {
        currentBlock.push(line);
      } else if (inBackground) {
        backgroundBlock.push(line);
      } else {
        // En dehors de tout, on les met quand même en pending
        const newTags = trimmed
          .split(/\s+/)
          .filter((t) => t.startsWith("@"));
        pendingTags = [...pendingTags, ...newTags];
      }
      continue;
    }

    const mScenario = trimmed.match(SCENARIO_RE);
    if (mScenario) {
      // Cloture du Background éventuel
      if (inBackground) {
        background = backgroundBlock.join("\n").trim();
        inBackground = false;
        backgroundBlock = [];
      }
      flushScenario();
      currentTitle = mScenario[1].trim() || "Scenario sans titre";
      currentTags = pendingTags;
      pendingTags = [];
      // Le bloc démarre directement à la ligne Scenario: — les tags
      // sont gérés à part dans currentTags et seront extraits dans
      // scenario.tags par flushScenario.
      currentBlock = [line];
      continue;
    }

    // Ligne ordinaire : appartient au bloc courant (scenario ou background)
    if (currentTitle !== null) {
      currentBlock.push(line);
    } else if (inBackground) {
      backgroundBlock.push(line);
    }
    // sinon : ligne avant tout scenario / background, ignorée
  }

  // Flush final
  if (inBackground) {
    background = backgroundBlock.join("\n").trim();
  }
  flushScenario();

  // Défense en profondeur : split des scénarios à plusieurs cycles
  // When → Then. Mistral, malgré les consignes BDD strictes, produit
  // parfois un mégascénario qui enchaîne plusieurs transitions. On le
  // découpe en N sous-scénarios — chacun reprend les Given du parent
  // + un unique cycle When/Then. Les titres sont suffixés par
  // "(étape X/N)" pour rester traçables.
  const splitScenarios: ParsedScenario[] = [];
  for (const scn of scenarios) {
    const subScns = splitMultiWhenScenario(scn);
    splitScenarios.push(...subScns);
  }
  // Renumérote les clientId pour rester stables / contigus côté React.
  for (let i = 0; i < splitScenarios.length; i++) {
    splitScenarios[i].clientId = `scn-${i}`;
  }
  scenarios.length = 0;
  scenarios.push(...splitScenarios);

  // Défense en profondeur : si un Background a été parsé (parce que le
  // LLM a ignoré la consigne "pas de Background"), on injecte ses steps
  // dans CHAQUE scénario juste après la ligne "Scenario:". Sans ça, les
  // scénarios validés perdraient leur contexte initial une fois envoyés
  // au générateur de scripts Playwright.
  if (background) {
    const bgSteps: string[] = [];
    for (const bgLine of background.split("\n")) {
      const t = bgLine.trim();
      if (!t) continue;
      if (BACKGROUND_RE.test(t)) continue; // saute l'en-tête "Background:"
      if (STEP_KEYWORD_RE.test(t)) bgSteps.push(bgLine);
    }
    if (bgSteps.length > 0) {
      for (const scn of scenarios) {
        const scnLines = scn.rawText.split("\n");
        let scenarioIdx = -1;
        for (let i = 0; i < scnLines.length; i++) {
          if (SCENARIO_RE.test(scnLines[i].trim())) {
            scenarioIdx = i;
            break;
          }
        }
        if (scenarioIdx >= 0) {
          const before = scnLines.slice(0, scenarioIdx + 1);
          const after = scnLines.slice(scenarioIdx + 1);
          scn.rawText = [...before, ...bgSteps, ...after].join("\n");
        }
      }
      // On vide le Background standalone : son contenu vit maintenant
      // dans chaque scenario.rawText.
      background = null;
    }
  }

  return { feature, background, scenarios };
}

// --------------------------------------------------------------------
// Splitter : un scénario à plusieurs cycles When → Then devient N
// sous-scénarios autonomes. Best-effort : les Given du parent sont
// recopiés en tête de chaque sous-scénario. Le Given peut ne pas
// refléter parfaitement l'état réel au moment du cycle (le 2e cycle
// commence en théorie là où le 1er s'est terminé), mais c'est mieux
// que de perdre le contexte initial ou de garder un mégascénario.
// --------------------------------------------------------------------
function splitMultiWhenScenario(scn: ParsedScenario): ParsedScenario[] {
  const lines = scn.rawText.split("\n");

  // Localise la ligne "Scenario:" — point d'ancrage pour reconstruire
  // les sous-scénarios.
  let scenarioIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SCENARIO_RE.test(lines[i].trim())) {
      scenarioIdx = i;
      break;
    }
  }
  if (scenarioIdx < 0) return [scn];

  const headerLines = lines.slice(0, scenarioIdx); // lignes avant Scenario: (rare)
  const scenarioLine = lines[scenarioIdx];
  const bodyLines = lines.slice(scenarioIdx + 1);

  // Partitionne le body :
  //   - givenLines : Given(s) qui précèdent le 1er When (contexte commun)
  //   - cycles[i]  : lignes formant un cycle When/Then/And... unique
  const givenLines: string[] = [];
  const cycles: string[][] = [];
  let currentCycle: string[] = [];
  let prev: ResolvedStepType = null;
  let inCycle = false;
  // Un cycle n'est "terminé" qu'à partir du moment où il a vu un Then.
  // Sans ça, un "When" suivant est presque toujours une continuation que
  // le LLM a mal libellée (ex : "When je remplis les champs / And ... /
  // When je soumets / Then ..." — le 2e When est en fait un And).
  let currentCycleHasThen = false;

  for (const line of bodyLines) {
    // Distinction CRITIQUE : un "When" EXPLICITE (mot-clé littéral)
    // marque une frontière de cycle. Un "And"/"But" qui hérite
    // sémantiquement de "when" reste DANS le cycle courant — sinon
    // on découpe à tort à chaque "And je clique...".
    const isExplicitWhen = WHEN_RE.test(line);
    const isExplicitThen = THEN_RE.test(line);
    const type = classifyStep(line, prev);

    if (isExplicitWhen) {
      if (inCycle && !currentCycleHasThen) {
        // Le cycle courant n'a pas encore de Then : ce "When" est
        // probablement une continuation mal libellée par le LLM. On
        // l'absorbe dans le cycle au lieu d'ouvrir un nouveau cycle
        // qui se retrouverait sans Then.
        currentCycle.push(line);
        prev = "when";
      } else {
        // Soit pas encore de cycle, soit le cycle précédent a son
        // Then : on clôt et on ouvre un nouveau cycle.
        if (currentCycle.length > 0) cycles.push(currentCycle);
        currentCycle = [line];
        inCycle = true;
        currentCycleHasThen = false;
        prev = "when";
      }
    } else if (type === "given" && !inCycle) {
      givenLines.push(line);
      prev = "given";
    } else {
      // Continuation : Given mid-cycle, Then, And/But hérité, table
      // row, ligne vide, commentaire... → reste dans le cycle courant
      // si commencé, sinon attache aux Given.
      if (inCycle) {
        currentCycle.push(line);
        if (isExplicitThen) currentCycleHasThen = true;
      } else {
        givenLines.push(line);
      }
      if (type !== null) prev = type;
    }
  }
  if (currentCycle.length > 0) cycles.push(currentCycle);

  // 0 ou 1 cycle → pas de split nécessaire. On retourne le scénario tel
  // quel (objet existant, pour ne pas casser les références).
  if (cycles.length <= 1) return [scn];

  // 2+ cycles → split. Chaque sous-scénario hérite des Given du parent.
  const scenarioMatch = scenarioLine.trim().match(SCENARIO_RE);
  const baseTitle = scenarioMatch?.[1]?.trim() || scn.title;

  return cycles.map((cycleLines, i) => {
    const subTitle = `${baseTitle} (étape ${i + 1}/${cycles.length})`;
    const subScenarioLine = `Scenario: ${subTitle}`;
    const rawLines = [
      ...headerLines,
      subScenarioLine,
      ...givenLines,
      ...cycleLines,
    ];
    return {
      clientId: `${scn.clientId}-${i + 1}`, // sera renumérota juste après
      title: subTitle,
      tags: scn.tags,
      rawText: rawLines.join("\n").replace(/\n+$/, ""),
    };
  });
}

// --------------------------------------------------------------------
// Helpers API
// --------------------------------------------------------------------
export async function fetchValidatedTestCases(): Promise<ValidatedTestCase[]> {
  const res = await fetch(`${API_BASE}/test-cases`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveTestCase(
  payload: TestCasePayload,
): Promise<ValidatedTestCase> {
  const res = await fetch(`${API_BASE}/test-cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateTestCase(
  id: string,
  payload: Partial<TestCasePayload>,
): Promise<ValidatedTestCase> {
  const res = await fetch(`${API_BASE}/test-cases/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteValidatedTestCase(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/test-cases/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// --------------------------------------------------------------------
// Formats d'affichage
// --------------------------------------------------------------------
export const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  standard: "Standard",
  avance: "Avancé",
  expert: "Expert QA",
};

export const TEST_TYPE_LABELS: Record<TestType, string> = {
  fonctionnels: "Fonctionnels",
  non_regression: "Non-régression",
  performance: "Performance",
  stress: "Stress",
};

// --------------------------------------------------------------------
// Génération de scripts de tests (Playwright, ...)
// --------------------------------------------------------------------
export type ScriptFramework = "playwright"; // "cypress" | "selenium" à venir
export type ScriptLanguage = "typescript";

export const SCRIPT_FRAMEWORK_LABELS: Record<ScriptFramework, string> = {
  playwright: "Playwright",
};

// Un script généré par le LLM pour UN cas validé.
export type GeneratedScriptPerCase = {
  test_case_id: string;
  test_case_title: string;
  framework: ScriptFramework;
  language: ScriptLanguage;
  code: string;
  tags: string[];
  project_name: string;
  test_type: string;
  error?: string;
};

// Réponse du backend pour /test-scripts/generate.
export type GeneratedScriptsResponse = {
  framework: ScriptFramework;
  language: ScriptLanguage;
  project_name: string;
  scripts: GeneratedScriptPerCase[];
  missing_ids: string[];
};

export async function generateScripts(args: {
  test_case_ids: string[];
  framework?: ScriptFramework;
  language?: ScriptLanguage;
  project_name?: string;
}): Promise<GeneratedScriptsResponse> {
  const res = await fetch(`${API_BASE}/test-scripts/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      framework: "playwright",
      language: "typescript",
      ...args,
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

// --------------------------------------------------------------------
// Scripts de tests VALIDÉS (persistés en backend, consommés par /executions)
// --------------------------------------------------------------------
export type ValidatedScript = {
  id: string;
  test_case_id: string | null;
  test_case_title: string;
  framework: ScriptFramework;
  language: ScriptLanguage;
  code: string;
  project_name: string;
  tags: string[];
  test_type: string;
  created_at: string;
  updated_at: string;
};

export type ValidatedScriptPayload = {
  test_case_id?: string | null;
  test_case_title: string;
  framework: ScriptFramework;
  language?: ScriptLanguage;
  code: string;
  project_name?: string;
  tags?: string[];
  test_type?: string;
};

export async function fetchValidatedScripts(): Promise<ValidatedScript[]> {
  const res = await fetch(`${API_BASE}/validated-scripts`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveValidatedScript(
  payload: ValidatedScriptPayload,
): Promise<ValidatedScript> {
  const res = await fetch(`${API_BASE}/validated-scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function deleteValidatedScript(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/validated-scripts/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// --------------------------------------------------------------------
// Helpers de nommage de fichiers
// --------------------------------------------------------------------

/**
 * Slug ASCII compatible avec un nom de fichier. Translittère les
 * caractères accentués (é → e, à → a, ç → c, ô → o, ñ → n, ...)
 * AVANT de remplacer le reste par des tirets.
 */
export function slugify(text: string): string {
  return (
    text
      // décompose en base + accent (NFD), puis retire les marques
      // diacritiques (plage Unicode U+0300..U+036F). Ainsi :
      //   "é" → "e" + ́ (combining acute) → on garde "e"
      //   "à" → "a", "ç" → "c", "ô" → "o", "ñ" → "n", etc.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "tests"
  );
}

/** Construit un nom de fichier `<projet>__<titre>.spec.ts`. */
export function scriptFilename(s: {
  project_name?: string;
  test_case_title?: string;
}): string {
  const projectSlug = slugify(s.project_name || "tests");
  const titleSlug = slugify(s.test_case_title || "case");
  return `${projectSlug}__${titleSlug}.spec.ts`;
}
