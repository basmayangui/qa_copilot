"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  Pencil,
  CheckCircle2,
  Save,
  X,
  Loader2,
  Minus,
} from "lucide-react";
import {
  parseGherkin,
  saveTestCase,
  normalizeGherkinText,
  STEP_KEYWORD_RE,
  type DetailLevel,
  type ParsedScenario,
  type TestType,
} from "@/lib/test-cases";

// Valeurs envoyées au backend (cf. DETAIL_LEVEL_INSTRUCTIONS dans
// backend/api/gherkin_agent.py). On garde la labellisation FR pour
// l'utilisateur, mais on envoie un identifiant stable côté API.
const DETAIL_LEVELS = [
  { value: "standard" as DetailLevel, label: "Standard" },
  { value: "avance" as DetailLevel, label: "Avancé" },
  { value: "expert" as DetailLevel, label: "Expert QA" },
] as const;

// Types de tests proposés à l'utilisateur. Les identifiants doivent
// matcher les clés de TEST_TYPE_INSTRUCTIONS dans gherkin_agent.py.
const TEST_TYPES = [
  { value: "fonctionnels" as TestType, label: "Fonctionnels" },
  { value: "non_regression" as TestType, label: "Non-régression" },
  { value: "performance" as TestType, label: "Performance" },
  { value: "stress" as TestType, label: "Stress" },
] as const;

// Clé localStorage de persistance — v2 = nouveau shape (projectName /
// testType au lieu de specification). Les drafts v1 sont ignorés.
const DRAFT_STORAGE_KEY = "expersi.test-cases.draft.v2";

type StoredDraft = {
  projectName: string;
  testType: TestType;
  detailLevel: DetailLevel;
  gherkin: string;
  scenarioText: Record<string, string>;
  validatedMap: Record<string, string>;
};

export default function TestCasesPage() {
  // Critères de génération
  const [projectName, setProjectName] = useState("");
  const [testType, setTestType] = useState<TestType>("fonctionnels");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("standard");

  const [gherkin, setGherkin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  // --- États pour la validation/édition par scénario ---
  // Map clientId → texte courant (peut diverger du parser après édition).
  const [scenarioText, setScenarioText] = useState<Record<string, string>>({});
  // Map clientId → id backend si le scénario est validé.
  const [validatedMap, setValidatedMap] = useState<Record<string, string>>({});
  // Scénario en cours d'édition (un seul à la fois).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Buffer d'édition.
  const [editBuffer, setEditBuffer] = useState<string>("");
  // Scénario en cours de validation (loading par bouton).
  const [savingId, setSavingId] = useState<string | null>(null);

  // --- Sélection multiple pour validation en masse ---
  // Non persisté : la sélection est éphémère, le draft retient juste
  // le résultat (cas validés).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // --- Persistance localStorage : survit aux navigations sidebar ---
  // hydratedRef évite d'écraser le draft persisté avant qu'on n'ait eu
  // le temps de l'hydrater (race conditions).
  const hydratedRef = useRef(false);

  // Hydratation au montage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Partial<StoredDraft>;
        if (typeof data.projectName === "string") {
          setProjectName(data.projectName);
        }
        if (data.testType) {
          setTestType(data.testType);
        }
        if (data.detailLevel) {
          setDetailLevel(data.detailLevel);
        }
        if (typeof data.gherkin === "string") {
          setGherkin(data.gherkin);
        }
        if (data.scenarioText && typeof data.scenarioText === "object") {
          // Ré-applique la normalisation d'indentation aux textes en
          // cache (utile si le draft a été persisté avant que le parser
          // n'ait sa version actuelle).
          const renormalized: Record<string, string> = {};
          for (const [id, text] of Object.entries(data.scenarioText)) {
            renormalized[id] =
              typeof text === "string" ? normalizeGherkinText(text) : "";
          }
          setScenarioText(renormalized);
        }
        if (data.validatedMap && typeof data.validatedMap === "object") {
          setValidatedMap(data.validatedMap);
        }
      }
    } catch {
      /* draft corrompu ou indisponible — on ignore */
    }
    hydratedRef.current = true;
  }, []);

  // Persistance à chaque changement (post-hydratation)
  useEffect(() => {
    if (!hydratedRef.current) return;

    // Garde-fou : ne JAMAIS écrire un draft entièrement vide. Voir
    // commentaire dans la version précédente — évite la race React
    // qui effacerait le draft fraîchement hydraté.
    const isEmpty =
      !projectName.trim() &&
      !gherkin.trim() &&
      Object.keys(scenarioText).length === 0 &&
      Object.keys(validatedMap).length === 0;
    if (isEmpty) return;

    try {
      const draft: StoredDraft = {
        projectName,
        testType,
        detailLevel,
        gherkin,
        scenarioText,
        validatedMap,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* quota dépassé ou localStorage indispo — on ignore */
    }
  }, [projectName, testType, detailLevel, gherkin, scenarioText, validatedMap]);

  // Parse mémoïsé sur la sortie LLM courante.
  const parsed = useMemo(
    () => (gherkin ? parseGherkin(gherkin) : null),
    [gherkin],
  );

  // À chaque nouvelle génération, on réinitialise les buffers locaux
  // de scénarios et on remplit scenarioText avec le rawText d'origine.
  function resetScenarioState(scenarios: ParsedScenario[]) {
    const initial: Record<string, string> = {};
    for (const s of scenarios) initial[s.clientId] = s.rawText;
    setScenarioText(initial);
    setValidatedMap({});
    setEditingId(null);
    setEditBuffer("");
    setSavingId(null);
    setSelectedIds(new Set());
    setBulkSaving(false);
    setBulkProgress(null);
  }

  // --- Actions ---
  function startEdit(s: ParsedScenario) {
    setEditingId(s.clientId);
    setEditBuffer(scenarioText[s.clientId] ?? s.rawText);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBuffer("");
  }

  function saveEdit() {
    if (editingId === null) return;
    // Re-normalise l'indentation après édition pour rester cohérent
    // avec le reste de l'affichage.
    setScenarioText((prev) => ({
      ...prev,
      [editingId]: normalizeGherkinText(editBuffer),
    }));
    setEditingId(null);
    setEditBuffer("");
  }

  async function validateScenario(s: ParsedScenario) {
    const currentText = scenarioText[s.clientId] ?? s.rawText;
    setSavingId(s.clientId);
    try {
      const saved = await saveTestCase({
        title: extractTitleFromBlock(currentText) || s.title,
        gherkin: currentText,
        // tags viennent du parser (déjà consolidés), pas du body
        // (qui ne les contient plus depuis le strip).
        tags: s.tags,
        source_spec: projectName,
        detail_level: detailLevel,
        feature: parsed?.feature ?? projectName,
        project_name: projectName,
        test_type: testType,
      });
      setValidatedMap((prev) => ({ ...prev, [s.clientId]: saved.id }));
      // retire ce scénario de la sélection s'il y était
      setSelectedIds((prev) => {
        if (!prev.has(s.clientId)) return prev;
        const next = new Set(prev);
        next.delete(s.clientId);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(
        `Validation impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`,
      );
    } finally {
      setSavingId(null);
    }
  }

  // --- Sélection multiple ---
  function toggleSelect(clientId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function selectAllUnvalidated() {
    if (!parsed) return;
    const ids = parsed.scenarios
      .filter((s) => {
        if (validatedMap[s.clientId]) return false;
        // on évite de cocher les scénarios incomplets (tronqués)
        const text = scenarioText[s.clientId] ?? s.rawText;
        return hasSteps(text);
      })
      .map((s) => s.clientId);
    setSelectedIds(new Set(ids));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkValidate() {
    if (bulkSaving || !parsed) return;
    const ids = Array.from(selectedIds).filter(
      (id) => !validatedMap[id],
    );
    if (ids.length === 0) return;

    setBulkSaving(true);
    setError("");
    setBulkProgress({ done: 0, total: ids.length });

    let errorCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const s = parsed.scenarios.find((x) => x.clientId === id);
      if (!s) continue;
      const currentText = scenarioText[id] ?? s.rawText;
      // Skip silencieusement les scénarios sans steps (tronqués).
      if (!hasSteps(currentText)) {
        skippedCount++;
        setBulkProgress({ done: i + 1, total: ids.length });
        continue;
      }
      try {
        const saved = await saveTestCase({
          title: extractTitleFromBlock(currentText) || s.title,
          gherkin: currentText,
          tags: s.tags,
          source_spec: projectName,
          detail_level: detailLevel,
          feature: parsed.feature ?? projectName,
          project_name: projectName,
          test_type: testType,
        });
        // Mise à jour incrémentale pour que l'utilisateur voie la
        // progression scénario par scénario.
        setValidatedMap((prev) => ({ ...prev, [id]: saved.id }));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (e) {
        console.error("[bulk]", id, e);
        errorCount++;
      } finally {
        setBulkProgress({ done: i + 1, total: ids.length });
      }
    }

    setBulkSaving(false);
    setBulkProgress(null);
    if (errorCount > 0 || skippedCount > 0) {
      const parts: string[] = [];
      if (errorCount > 0) parts.push(`${errorCount} en erreur`);
      if (skippedCount > 0)
        parts.push(`${skippedCount} ignoré(s) (scénarios incomplets)`);
      setError(`Sur ${ids.length} : ${parts.join(" · ")}.`);
    }
  }

  async function generateGherkin() {
    if (!projectName.trim()) {
      setError("Veuillez saisir un nom de projet.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setGherkin("");

      const response = await axios.post("http://localhost:8000/generate", {
        project_name: projectName,
        test_type: testType,
        detail_level: detailLevel,
      });

      let newGherkin: string = response.data.gherkin ?? "";
      // Diagnostic défensif : si le backend renvoie une réponse vide,
      // on injecte un commentaire visible pour ne pas afficher
      // l'écran de bienvenue (qui ferait croire qu'il ne s'est rien passé).
      if (!newGherkin.trim()) {
        newGherkin =
          "# ⚠ Le LLM a renvoyé une réponse vide.\n" +
          "# Vérifie le terminal uvicorn — la ligne\n" +
          "#   [gherkin_agent] LLM RESPONSE (project=..., type=..., level=...) — N chars\n" +
          "# indique combien de caractères ont été reçus.\n" +
          "# Si N=0, le modèle (gpt-5-nano) a refusé ou consommé son budget en\n" +
          "# raisonnement interne sans émettre de texte visible.";
      }
      setGherkin(newGherkin);
      // reset des états de validation/édition pour la nouvelle sortie
      const newParsed = newGherkin ? parseGherkin(newGherkin) : null;
      resetScenarioState(newParsed?.scenarios ?? []);
    } catch (err) {
      console.error(err);
      setError("Erreur lors de la génération des scénarios.");
    } finally {
      setLoading(false);
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(gherkin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-5xl font-bold mb-4">Générer des cas de tests</h1>
        <p className="text-gray-400 text-lg">
          Générez automatiquement des scénarios Gherkin à partir de vos
          spécifications fonctionnelles.
        </p>
      </div>

      {/* Critères de génération */}
      <div className="border border-[#1B1F35] rounded-3xl bg-[#0A1020] p-8">
        <h2 className="text-2xl font-semibold mb-6">
          Critères de génération
        </h2>

        <div className="space-y-6">
          {/* Nom du projet */}
          <div>
            <label
              htmlFor="project-name"
              className="block mb-2 text-gray-400"
            >
              Nom du projet
            </label>
            <input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Ex : Paiement, Authentification, Panier..."
              className="
                w-full bg-[#0F172A]
                border border-[#1E293B]
                rounded-xl p-4
                text-white outline-none
                focus:border-[#A855F7]
                placeholder:text-gray-500
              "
            />
            <p className="mt-2 text-xs text-gray-500 italic">
              Sert à la fois de nom de projet pour vos cas validés et de
              requête pour le RAG : le LLM récupère automatiquement les
              extraits de specs liés à ce projet.
            </p>
          </div>

          {/* Type + Niveau côte à côte */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="test-type"
                className="block mb-2 text-gray-400"
              >
                Type de tests
              </label>
              <select
                id="test-type"
                value={testType}
                onChange={(e) => setTestType(e.target.value as TestType)}
                className="
                  w-full bg-[#0F172A]
                  border border-[#1E293B]
                  rounded-xl p-4
                  text-white outline-none
                  focus:border-[#A855F7]
                "
              >
                {TEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-gray-500 italic">
                {testType === "fonctionnels" &&
                  "User flows, règles métier, validations."}
                {testType === "non_regression" &&
                  "Chemins critiques à protéger entre versions (tags @critical, @regression)."}
                {testType === "performance" &&
                  "Temps de réponse, débit, scalabilité avec assertions de seuils."}
                {testType === "stress" &&
                  "Limites du système : charge extrême, ressources saturées."}
              </p>
            </div>

            <div>
              <label
                htmlFor="detail-level"
                className="block mb-2 text-gray-400"
              >
                Niveau de détail
              </label>
              <select
                id="detail-level"
                value={detailLevel}
                onChange={(e) =>
                  setDetailLevel(e.target.value as DetailLevel)
                }
                className="
                  w-full bg-[#0F172A]
                  border border-[#1E293B]
                  rounded-xl p-4
                  text-white outline-none
                  focus:border-[#A855F7]
                "
              >
                {DETAIL_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-gray-500 italic">
                {detailLevel === "standard" &&
                  "5-8 scénarios — sobre."}
                {detailLevel === "avance" &&
                  "10-15 scénarios — cas d'erreur + valeurs limites."}
                {detailLevel === "expert" &&
                  "15-25 scénarios — Scenario Outline, Background, tags riches."}
              </p>
            </div>
          </div>

          {error && (
            <div
              className="
                bg-red-500/10 border border-red-500
                text-red-400 rounded-xl p-4
                flex items-center gap-2
              "
            >
              <AlertCircle size={18} /> {error}
            </div>
          )}

          <button
            onClick={generateGherkin}
            disabled={loading}
            className="
              w-full mt-4 py-4 rounded-2xl text-lg font-semibold
              bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F59E0B]
              hover:opacity-90 transition
              disabled:opacity-50
              flex items-center justify-center gap-2
            "
          >
            <Sparkles size={20} />
            {loading ? "Génération en cours..." : "Générer les scénarios"}
          </button>
        </div>
      </div>

      {/* RESULT */}
      <div className="mt-10 border border-[#1B1F35] rounded-3xl bg-[#0A1020] p-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-3xl font-semibold">Cas de tests générés</h2>
            {parsed && (
              <p className="text-gray-500 text-sm mt-1">
                {parsed.scenarios.length} scénario(s)
                {Object.keys(validatedMap).length > 0 && (
                  <>
                    {" · "}
                    <span className="text-emerald-400">
                      {Object.keys(validatedMap).length} validé(s)
                    </span>
                  </>
                )}
                {parsed.feature && (
                  <>
                    {" · Feature : "}
                    <span className="text-gray-300">{parsed.feature}</span>
                  </>
                )}
              </p>
            )}
          </div>

          {gherkin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRaw((v) => !v)}
                title="Affiche la réponse brute du LLM, utile pour diagnostiquer un parsing incomplet"
                className={`
                  px-4 py-2 rounded-xl text-sm transition
                  flex items-center gap-2
                  ${
                    showRaw
                      ? "bg-[#7C3AED]/20 border border-[#7C3AED] text-[#E9D5FF]"
                      : "border border-[#334155] hover:bg-[#111827]"
                  }
                `}
              >
                {showRaw ? "Masquer brut" : "Voir brut"}
              </button>
              <button
                onClick={handleCopy}
                className="
                  px-4 py-2 rounded-xl
                  border border-[#334155]
                  hover:bg-[#111827] transition
                  flex items-center gap-2 text-sm
                "
              >
                {copied ? (
                  <>
                    <Check size={16} className="text-emerald-400" /> Copié
                  </>
                ) : (
                  <>
                    <Copy size={16} /> Copier tout
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Réponse brute du LLM — toggle utile pour diagnostiquer */}
        {showRaw && gherkin && (
          <details
            open
            className="
              mb-5 border border-[#7C3AED]/40 rounded-2xl
              bg-[#050816] overflow-hidden
            "
          >
            <summary className="
              px-4 py-2 cursor-pointer text-xs text-[#E9D5FF]
              bg-[#7C3AED]/10 border-b border-[#7C3AED]/40
            ">
              Réponse brute du LLM — {gherkin.length} caractères
            </summary>
            <pre className="
              font-mono text-[12.5px] leading-6 p-4
              text-gray-200 whitespace-pre-wrap break-words
              overflow-auto max-h-[500px]
            ">
              {gherkin}
            </pre>
          </details>
        )}

        {!gherkin && !loading && (
          <div className="flex items-center justify-center h-[250px] text-gray-500 text-xl">
            Vos scénarios Gherkin apparaîtront ici
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-[250px] gap-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-bounce" />
              <span
                className="w-2 h-2 rounded-full bg-[#C026D3] animate-bounce"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="w-2 h-2 rounded-full bg-[#F59E0B] animate-bounce"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
            <p className="text-gray-400">Génération IA en cours…</p>
          </div>
        )}

        {parsed && parsed.scenarios.length === 0 && (
          <div className="space-y-3">
            <div className="
              flex items-start gap-3
              bg-amber-500/10 border border-amber-500/40
              text-amber-200 rounded-xl p-4
            ">
              <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">
                  Aucun scénario Gherkin n'a pu être extrait.
                </p>
                <p className="text-sm text-amber-100/80">
                  Le LLM a répondu (voir contenu brut ci-dessous), mais
                  la réponse ne contient aucun mot-clé{" "}
                  <code className="text-amber-200">Scenario:</code> /{" "}
                  <code className="text-amber-200">Scénario:</code>{" "}
                  exploitable. Vérifie le terminal uvicorn pour le log{" "}
                  <code className="text-amber-200">
                    [gherkin_agent] LLM RESPONSE
                  </code>
                  .
                </p>
              </div>
            </div>
            <details
              open
              className="
                border border-[#1E293B] rounded-xl
                bg-[#050816] overflow-hidden
              "
            >
              <summary className="
                px-4 py-2 cursor-pointer text-xs text-gray-400
                bg-[#0B1226] border-b border-[#1E293B]
                hover:text-white transition
              ">
                Réponse brute du LLM ({gherkin.length} caractères)
              </summary>
              <pre className="
                font-mono text-[12.5px] leading-6 p-4
                text-gray-200 whitespace-pre-wrap break-words
                overflow-auto max-h-[400px]
              ">
                {gherkin || "(vide)"}
              </pre>
            </details>
          </div>
        )}

        {parsed && parsed.scenarios.length > 0 && (
          <>
            <BulkToolbar
              total={parsed.scenarios.length}
              unvalidatedCount={
                parsed.scenarios.filter((s) => !validatedMap[s.clientId])
                  .length
              }
              selectedCount={selectedIds.size}
              bulkSaving={bulkSaving}
              bulkProgress={bulkProgress}
              onSelectAll={selectAllUnvalidated}
              onClearSelection={clearSelection}
              onBulkValidate={bulkValidate}
            />

            <div className="space-y-5">
              {parsed.scenarios.map((s) => {
                const isValidated = !!validatedMap[s.clientId];
                const isEditing = editingId === s.clientId;
                const isSaving = savingId === s.clientId;
                const isSelected = selectedIds.has(s.clientId);
                const currentText = scenarioText[s.clientId] ?? s.rawText;
                return (
                  <ScenarioCard
                    key={s.clientId}
                    scenario={s}
                    isValidated={isValidated}
                    isEditing={isEditing}
                    isSaving={isSaving}
                    isSelected={isSelected}
                    bulkSaving={bulkSaving}
                    currentText={currentText}
                    editBuffer={editBuffer}
                    onToggleSelect={() => toggleSelect(s.clientId)}
                    onStartEdit={() => startEdit(s)}
                    onChangeEdit={setEditBuffer}
                    onSaveEdit={saveEdit}
                    onCancelEdit={cancelEdit}
                    onValidate={() => validateScenario(s)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ===================================================================
 * GherkinViewer — coloriseur Gherkin maison
 * Palette alignée sur le branding EXPERSI : violet / magenta / orange
 * + couleurs sémantiques pour Given / When / Then.
 * =================================================================== */

const KEYWORD_COLORS: Record<string, string> = {
  // EN
  Feature: "#A855F7",
  Rule: "#A855F7",
  Background: "#D946EF",
  Scenario: "#F59E0B",
  "Scenario Outline": "#F59E0B",
  Example: "#F59E0B",
  Examples: "#FBBF24",
  Given: "#38BDF8",
  When: "#FB923C",
  Then: "#34D399",
  And: "#94A3B8",
  But: "#94A3B8",
  // FR — même palette pour qu'on retrouve les mêmes repères visuels
  Fonctionnalité: "#A855F7",
  Fonctionnalite: "#A855F7",
  Contexte: "#D946EF",
  Scénario: "#F59E0B",
  Scenario_FR: "#F59E0B",
  "Scénario Outline": "#F59E0B",
  "Plan du Scénario": "#F59E0B",
  Exemple: "#F59E0B",
  Exemples: "#FBBF24",
  "Étant donné": "#38BDF8",
  Quand: "#FB923C",
  Alors: "#34D399",
  Et: "#94A3B8",
  Mais: "#94A3B8",
};

const SECTION_KEYWORDS = [
  // EN
  "Feature",
  "Rule",
  "Background",
  "Scenario Outline",
  "Scenario",
  "Example",
  "Examples",
  // FR
  "Fonctionnalité",
  "Fonctionnalite",
  "Contexte",
  "Plan du Scénario",
  "Scénario Outline",
  "Scénario",
  "Exemple",
  "Exemples",
];

const STEP_KEYWORDS = [
  // EN
  "Given",
  "When",
  "Then",
  "And",
  "But",
  // FR
  "Étant donné",
  "Etant donné",
  "Quand",
  "Alors",
  "Et",
  "Mais",
];

function GherkinViewer({ code }: { code: string }) {
  // Filet de sécurité : on re-normalise systématiquement à l'affichage.
  // Toutes les autres entrées (parseGherkin, resetScenarioState, saveEdit,
  // hydratation localStorage) sont censées déjà passer par normalizeGherkinText,
  // mais si une régression ou un draft hérité passe à travers, le viewer
  // garantit quand même un rendu propre.
  const normalized = normalizeGherkinText(code);
  const lines = normalized.split("\n");

  return (
    <div className="bg-[#050816] overflow-hidden">
      <pre
        className="
          font-mono text-[13.5px] leading-7
          p-5 overflow-auto
          text-gray-200
          whitespace-pre
        "
      >
        {lines.map((line, i) => (
          <LineRow key={i} line={line} index={i + 1} />
        ))}
      </pre>
    </div>
  );
}

function LineRow({ line, index }: { line: string; index: number }) {
  return (
    <div className="flex">
      <span
        className="
          inline-block w-10 text-right pr-4 select-none
          text-gray-600
        "
      >
        {index}
      </span>
      <span className="flex-1">
        {line.length === 0 ? " " : <GherkinLine line={line} />}
      </span>
    </div>
  );
}

function GherkinLine({ line }: { line: string }) {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);

  // Commentaire
  if (trimmed.startsWith("#")) {
    return (
      <>
        {indent}
        <span className="text-gray-500 italic">{trimmed}</span>
      </>
    );
  }

  // Tags (@smoke @regression ...)
  if (trimmed.startsWith("@")) {
    return (
      <>
        {indent}
        {trimmed.split(/\s+/).filter(Boolean).map((tag, i) => (
          <span
            key={i}
            className="
              inline-block mr-1 mb-0.5
              px-2 py-0.5 rounded-md
              bg-[#3B0764] text-[#F0ABFC]
              border border-[#7C3AED]/40
              text-xs font-medium
            "
          >
            {tag}
          </span>
        ))}
      </>
    );
  }

  // Table row (| cell | cell |)
  if (trimmed.startsWith("|")) {
    return (
      <>
        {indent}
        {renderTableRow(trimmed)}
      </>
    );
  }

  // Section (Feature:, Scenario:, ...)
  for (const kw of SECTION_KEYWORDS) {
    const re = new RegExp("^(" + kw + ")(:)(.*)$");
    const m = trimmed.match(re);
    if (m) {
      const color = KEYWORD_COLORS[kw] ?? "#E2E8F0";
      return (
        <>
          {indent}
          <span style={{ color }} className="font-bold">
            {m[1]}
          </span>
          <span className="text-gray-400">{m[2]}</span>
          <span className="text-gray-100">{renderInline(m[3])}</span>
        </>
      );
    }
  }

  // Step (Given / When / Then / And / But)
  for (const kw of STEP_KEYWORDS) {
    const re = new RegExp("^(" + kw + ")(\\s+)(.*)$");
    const m = trimmed.match(re);
    if (m) {
      const color = KEYWORD_COLORS[kw] ?? "#E2E8F0";
      return (
        <>
          {indent}
          <span style={{ color }} className="font-semibold">
            {m[1]}
          </span>
          {m[2]}
          <span className="text-gray-200">{renderInline(m[3])}</span>
        </>
      );
    }
  }

  // Ligne neutre
  return (
    <>
      {indent}
      <span className="text-gray-300">{renderInline(trimmed)}</span>
    </>
  );
}

/* --- Coloration inline : "strings", <placeholders>, nombres --- */
function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /("[^"]*")|(<[^>]+>)|(\b\d+(?:\.\d+)?\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const [, str, placeholder, number] = match;
    if (str !== undefined) {
      parts.push(
        <span key={key++} className="text-[#FDE68A]">
          {str}
        </span>,
      );
    } else if (placeholder !== undefined) {
      parts.push(
        <span key={key++} className="text-[#C084FC] font-medium">
          {placeholder}
        </span>,
      );
    } else if (number !== undefined) {
      parts.push(
        <span key={key++} className="text-[#FBBF24]">
          {number}
        </span>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

/* --- Table Gherkin : | header | header | --- */
function renderTableRow(line: string): ReactNode {
  const cells = line.split("|");
  const out: ReactNode[] = [];

  cells.forEach((cell, i) => {
    if (i > 0) {
      out.push(
        <span key={`s${i}`} className="text-[#475569]">
          |
        </span>,
      );
    }
    if (cell.length > 0) {
      out.push(
        <span key={`c${i}`} className="text-[#FDE68A]">
          {cell}
        </span>,
      );
    }
  });
  return out;
}

/* ===================================================================
 * BulkToolbar — barre d'action pour la validation en masse
 * =================================================================== */

function BulkToolbar({
  total,
  unvalidatedCount,
  selectedCount,
  bulkSaving,
  bulkProgress,
  onSelectAll,
  onClearSelection,
  onBulkValidate,
}: {
  total: number;
  unvalidatedCount: number;
  selectedCount: number;
  bulkSaving: boolean;
  bulkProgress: { done: number; total: number } | null;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkValidate: () => void;
}) {
  const allUnvalidatedSelected =
    unvalidatedCount > 0 && selectedCount === unvalidatedCount;
  const someSelected = selectedCount > 0 && !allUnvalidatedSelected;
  const noneSelectable = unvalidatedCount === 0;

  // Toggle « master » de la case à cocher :
  // - rien de coché → on coche tout (sélection des non-validés)
  // - au moins un coché (partiel ou complet) → on décoche tout
  const handleMasterToggle = () => {
    if (selectedCount === 0) onSelectAll();
    else onClearSelection();
  };

  return (
    <div
      className="
        mb-5 p-3 rounded-2xl
        border border-[#1E293B] bg-[#0B1226]
        flex items-center justify-between gap-3 flex-wrap
      "
    >
      <div className="flex items-center gap-3 text-sm">
        {/* Case à cocher master — remplace le bouton 'Tout sélectionner' */}
        <button
          onClick={handleMasterToggle}
          disabled={bulkSaving || noneSelectable}
          aria-label={
            allUnvalidatedSelected
              ? "Tout désélectionner"
              : "Tout sélectionner"
          }
          title={
            noneSelectable
              ? "Aucun scénario validable"
              : allUnvalidatedSelected
                ? "Tout désélectionner"
                : someSelected
                  ? `Désélectionner (${selectedCount} sélectionné${selectedCount > 1 ? "s" : ""})`
                  : "Tout sélectionner"
          }
          className={`
            w-5 h-5 rounded-md border-2 flex-shrink-0
            flex items-center justify-center transition
            ${
              allUnvalidatedSelected
                ? "bg-[#7C3AED] border-[#7C3AED]"
                : someSelected
                  ? "bg-[#7C3AED]/40 border-[#7C3AED]"
                  : "border-gray-600 hover:border-[#7C3AED]"
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {allUnvalidatedSelected && (
            <Check size={12} className="text-white" />
          )}
          {someSelected && <Minus size={12} className="text-white" />}
        </button>

        <span className="text-gray-400">
          {selectedCount > 0 ? (
            <>
              <span className="text-[#A855F7] font-semibold">
                {selectedCount}
              </span>{" "}
              sélectionné{selectedCount > 1 ? "s" : ""}
              {" · "}
              <span className="text-gray-500">
                {unvalidatedCount} validables au total
              </span>
            </>
          ) : (
            <>
              <span className="text-gray-300">{total}</span> scénario(s)
              {unvalidatedCount < total && (
                <>
                  {" · "}
                  <span className="text-gray-500">
                    {unvalidatedCount} restant(s) à valider
                  </span>
                </>
              )}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onBulkValidate}
          disabled={bulkSaving || selectedCount === 0}
          className="
            px-4 py-1.5 rounded-lg text-sm font-semibold
            bg-gradient-to-r from-[#7C3AED] to-[#10B981]
            hover:brightness-110
            disabled:opacity-40 disabled:cursor-not-allowed
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]
            flex items-center justify-center gap-2
            min-w-[220px]
          "
        >
          {bulkSaving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>
                {bulkProgress
                  ? `Validation ${bulkProgress.done}/${bulkProgress.total}…`
                  : "Validation…"}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={14} />
              <span>
                Valider la sélection
                {selectedCount > 0 && ` (${selectedCount})`}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ===================================================================
 * ScenarioCard — affichage d'UN scénario avec actions Valider/Éditer
 * =================================================================== */

type ScenarioCardProps = {
  scenario: ParsedScenario;
  isValidated: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isSelected: boolean;
  bulkSaving: boolean;
  currentText: string;
  editBuffer: string;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onValidate: () => void;
};

function ScenarioCard({
  scenario,
  isValidated,
  isEditing,
  isSaving,
  isSelected,
  bulkSaving,
  currentText,
  editBuffer,
  onToggleSelect,
  onStartEdit,
  onChangeEdit,
  onSaveEdit,
  onCancelEdit,
  onValidate,
}: ScenarioCardProps) {
  // tags : ils sont consolidés par le parser dans scenario.tags
  // (cf. lib/test-cases.ts) — on ne les re-scanne pas dans le body
  // car le body n'en contient plus (dédoublonnage avec le bandeau).
  const tags = scenario.tags;
  const title = extractTitleFromBlock(currentText) || scenario.title;
  const incomplete = !hasSteps(currentText);

  return (
    <div
      className={`
        border rounded-2xl bg-[#050816] overflow-hidden transition
        ${
          isValidated
            ? "border-emerald-500/50 shadow-[0_0_20px_-12px_rgba(16,185,129,0.4)]"
            : incomplete
              ? "border-amber-500/40"
              : isSelected
                ? "border-[#A855F7] shadow-[0_0_20px_-12px_rgba(168,85,247,0.5)]"
                : "border-[#1E293B] hover:border-[#7C3AED]/40"
        }
      `}
    >
      {/* Header carte */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[#0B1226] border-b border-[#1E293B]">
        <div className="flex items-center gap-3 min-w-0">
          {isValidated ? (
            <CheckCircle2
              size={20}
              className="text-emerald-400 flex-shrink-0"
              aria-label="Validé"
            />
          ) : (
            <button
              onClick={onToggleSelect}
              disabled={bulkSaving}
              aria-label={isSelected ? "Désélectionner" : "Sélectionner"}
              title={isSelected ? "Désélectionner" : "Sélectionner pour validation en masse"}
              className={`
                w-5 h-5 rounded-md border-2 flex-shrink-0
                flex items-center justify-center transition
                ${
                  isSelected
                    ? "bg-[#7C3AED] border-[#7C3AED]"
                    : "border-gray-600 hover:border-[#7C3AED]"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {isSelected && <Check size={12} className="text-white" />}
            </button>
          )}
          <h3 className="font-semibold text-base truncate">{title}</h3>
          {incomplete && !isValidated && (
            <span
              title="Ce scénario n'a pas de steps Given/When/Then — la génération a probablement été tronquée. Édite-le pour ajouter le corps, ou régénère."
              className="
                flex items-center gap-1
                text-[10px] px-2 py-0.5 rounded-md
                bg-amber-500/10 text-amber-300
                border border-amber-500/40
                flex-shrink-0
              "
            >
              <AlertCircle size={11} /> incomplet
            </span>
          )}
          {tags.length > 0 && (
            <div className="flex gap-1 flex-shrink-0">
              {tags.map((t) => (
                <span
                  key={t}
                  className="
                    text-[10px] px-2 py-0.5 rounded-md
                    bg-[#3B0764] text-[#F0ABFC]
                    border border-[#7C3AED]/40
                  "
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing && !isValidated && (
            <button
              onClick={onStartEdit}
              className="
                px-3 py-1.5 rounded-lg
                border border-[#334155] text-gray-300
                hover:bg-[#111827] hover:border-[#7C3AED] hover:text-white
                transition flex items-center gap-1.5 text-sm
              "
            >
              <Pencil size={14} /> Éditer
            </button>
          )}
          {!isEditing && (
            <button
              onClick={onValidate}
              disabled={isSaving || (incomplete && !isValidated)}
              title={
                incomplete && !isValidated
                  ? "Scénario incomplet — édite-le pour ajouter les steps avant de valider"
                  : undefined
              }
              className={`
                px-3 py-1.5 rounded-lg
                transition flex items-center gap-1.5 text-sm
                ${
                  isValidated
                    ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 cursor-default"
                    : "bg-gradient-to-r from-[#7C3AED] to-[#10B981] hover:opacity-90 text-white"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Validation...
                </>
              ) : isValidated ? (
                <>
                  <CheckCircle2 size={14} /> Validé
                </>
              ) : (
                <>
                  <Check size={14} /> Valider
                </>
              )}
            </button>
          )}
          {isEditing && (
            <>
              <button
                onClick={onCancelEdit}
                className="
                  px-3 py-1.5 rounded-lg
                  border border-[#334155] text-gray-300
                  hover:bg-[#111827] transition flex items-center gap-1.5 text-sm
                "
              >
                <X size={14} /> Annuler
              </button>
              <button
                onClick={onSaveEdit}
                className="
                  px-3 py-1.5 rounded-lg
                  bg-[#7C3AED] hover:bg-[#6D28D9]
                  transition flex items-center gap-1.5 text-sm
                "
              >
                <Save size={14} /> Enregistrer
              </button>
            </>
          )}
        </div>
      </div>

      {/* Corps : éditeur ou viewer */}
      {isEditing ? (
        <textarea
          value={editBuffer}
          onChange={(e) => onChangeEdit(e.target.value)}
          className="
            w-full min-h-[200px]
            bg-[#050816] text-gray-100
            font-mono text-[13px] leading-7
            p-5 outline-none resize-y
          "
          spellCheck={false}
        />
      ) : (
        <GherkinViewer code={currentText} />
      )}
    </div>
  );
}

/* --- Helpers : extraction title/tags d'un bloc Gherkin --- */
function extractTitleFromBlock(block: string): string {
  for (const line of block.split("\n")) {
    const m = line.match(
      /^\s*(?:Scenario(?: Outline)?|Sc[ée]nario(?: Outline)?|Plan du Sc[ée]nario|Exemple|Example)(?::|\s)\s*(.+)$/i,
    );
    if (m) return m[1].trim();
  }
  return "";
}

// STEP_KEYWORD_RE est importé de lib/test-cases.ts pour rester en phase
// avec la normalisation faite côté parser.

/**
 * Extrait les tags Gherkin d'un bloc, peu importe où ils sont placés
 * (avant Scenario:, ou après, dans une ligne séparée). On parcourt
 * toutes les lignes jusqu'à la première step pour ramasser ce qui
 * commence par @. Les doublons sont éliminés en gardant l'ordre.
 *
 * Pourquoi cette tolérance : les LLM produisent assez librement
 * `@perf @critical` au-dessus OU en-dessous de `Scenario:`, surtout
 * quand on leur demande plusieurs tags par scénario. Plutôt que
 * d'imposer la convention stricte, on accepte les deux.
 */
function extractTagsFromBlock(block: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // On s'arrête dès qu'on rencontre une vraie step : on est passé
    // au corps du scénario, plus aucun tag à attendre.
    if (STEP_KEYWORD_RE.test(trimmed)) break;
    if (trimmed.startsWith("@")) {
      for (const tag of trimmed.split(/\s+/).filter((t) => t.startsWith("@"))) {
        if (!seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
    }
    // Toute autre ligne (Scenario:, description, etc.) est ignorée
    // pour l'extraction des tags — on continue à scanner.
  }
  return tags;
}

/**
 * Détecte un scénario incomplet : aucune step Given/When/Then dans
 * le bloc. Le LLM nous a probablement coupé après le titre.
 */
function hasSteps(block: string): boolean {
  return block.split("\n").some((line) => STEP_KEYWORD_RE.test(line));
}
