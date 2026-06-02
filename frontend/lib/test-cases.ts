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

/**
 * Découpe un document Gherkin en scénarios.
 *
 * Le parser est volontairement tolérant : il n'exige pas de Feature
 * en tête, accepte les blocs sans tags, et conserve les Examples
 * intégrés à leur Scenario Outline parent.
 */
export function parseGherkin(code: string): ParsedGherkin {
  const lines = code.split("\n");

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

  return { feature, background, scenarios };
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
