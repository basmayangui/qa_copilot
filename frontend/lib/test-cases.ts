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

export type ValidatedTestCase = {
  id: string;
  title: string;
  tags: string[];
  gherkin: string;
  source_spec: string;
  detail_level: DetailLevel;
  feature: string;
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

const SCENARIO_RE = /^Scenario(?: Outline)?:\s*(.*)$/i;
const FEATURE_RE = /^Feature:\s*(.*)$/i;
const BACKGROUND_RE = /^Background:\s*(.*)$/i;
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
    scenarios.push({
      clientId: `scn-${scenarios.length}`,
      title: currentTitle,
      tags: currentTags,
      rawText: currentBlock.join("\n").replace(/\n+$/, ""),
    });
    currentTitle = null;
    currentBlock = [];
    currentTags = [];
  };

  for (const line of lines) {
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

    // Ligne de tags : on la met en attente pour le prochain Scenario.
    if (TAG_LINE_RE.test(trimmed)) {
      // si on est en cours de bloc, c'est une frontière de scénario
      flushScenario();
      if (inBackground) {
        background = backgroundBlock.join("\n").trim();
        inBackground = false;
        backgroundBlock = [];
      }
      pendingTags = trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
      // on ne push pas la ligne de tag tout de suite, elle sera dans
      // le bloc du Scenario suivant.
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
      // on commence le bloc en incluant la ligne de tags si présente,
      // puis la ligne Scenario:
      currentBlock = [];
      if (currentTags.length > 0) {
        currentBlock.push(currentTags.join(" "));
      }
      currentBlock.push(line);
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
