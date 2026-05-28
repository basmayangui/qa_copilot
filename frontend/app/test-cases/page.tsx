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
} from "lucide-react";
import {
  parseGherkin,
  saveTestCase,
  type DetailLevel,
  type ParsedScenario,
} from "@/lib/test-cases";

// Valeurs envoyées au backend (cf. DETAIL_LEVEL_INSTRUCTIONS dans
// backend/api/gherkin_agent.py). On garde la labellisation FR pour
// l'utilisateur, mais on envoie un identifiant stable côté API.
const DETAIL_LEVELS = [
  { value: "standard" as DetailLevel, label: "Standard" },
  { value: "avance" as DetailLevel, label: "Avancé" },
  { value: "expert" as DetailLevel, label: "Expert QA" },
] as const;

// Clé localStorage de persistance — change la version si on modifie
// la forme du draft (les drafts anciens seront alors ignorés).
const DRAFT_STORAGE_KEY = "expersi.test-cases.draft.v1";

type StoredDraft = {
  specification: string;
  gherkin: string;
  detailLevel: DetailLevel;
  scenarioText: Record<string, string>;
  validatedMap: Record<string, string>;
};

export default function TestCasesPage() {
  const [specification, setSpecification] = useState("");
  const [gherkin, setGherkin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("standard");

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
        if (typeof data.specification === "string") {
          setSpecification(data.specification);
        }
        if (typeof data.gherkin === "string") {
          setGherkin(data.gherkin);
        }
        if (data.detailLevel) {
          setDetailLevel(data.detailLevel);
        }
        if (data.scenarioText && typeof data.scenarioText === "object") {
          setScenarioText(data.scenarioText);
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

    // Garde-fou : ne JAMAIS écrire un draft entièrement vide. Sans ça,
    // l'effet de persistance peut être déclenché juste après l'hydratation
    // avec encore la closure du state vide initial (race React), ce qui
    // efface le draft qu'on vient de charger. Si tout est vide, on n'a
    // de toute façon rien à sauvegarder.
    const isEmpty =
      !specification.trim() &&
      !gherkin.trim() &&
      Object.keys(scenarioText).length === 0 &&
      Object.keys(validatedMap).length === 0;
    if (isEmpty) return;

    try {
      const draft: StoredDraft = {
        specification,
        gherkin,
        detailLevel,
        scenarioText,
        validatedMap,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* quota dépassé ou localStorage indispo — on ignore */
    }
  }, [specification, gherkin, detailLevel, scenarioText, validatedMap]);

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
    setScenarioText((prev) => ({ ...prev, [editingId]: editBuffer }));
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
        tags: extractTagsFromBlock(currentText),
        source_spec: specification.slice(0, 4000),
        detail_level: detailLevel,
        feature: parsed?.feature ?? "",
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
      .filter((s) => !validatedMap[s.clientId])
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
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const s = parsed.scenarios.find((x) => x.clientId === id);
      if (!s) continue;
      const currentText = scenarioText[id] ?? s.rawText;
      try {
        const saved = await saveTestCase({
          title: extractTitleFromBlock(currentText) || s.title,
          gherkin: currentText,
          tags: extractTagsFromBlock(currentText),
          source_spec: specification.slice(0, 4000),
          detail_level: detailLevel,
          feature: parsed.feature ?? "",
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
    if (errorCount > 0) {
      setError(
        `${errorCount} validation(s) en erreur sur ${ids.length}.`,
      );
    }
  }

  async function generateGherkin() {
    if (!specification.trim()) {
      setError("Veuillez saisir une spécification.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setGherkin("");

      const response = await axios.post("http://localhost:8000/generate", {
        text: specification,
        detail_level: detailLevel,
      });

      const newGherkin = response.data.gherkin ?? "";
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

      {/* Main Card */}
      <div className="border border-[#1B1F35] rounded-3xl bg-[#0A1020] p-8">
        <div className="grid grid-cols-2 gap-10">
          {/* LEFT */}
          <div>
            <h2 className="text-2xl font-semibold mb-6">
              Spécification fonctionnelle
            </h2>

            <textarea
              value={specification}
              onChange={(e) => setSpecification(e.target.value)}
              placeholder="Collez votre spécification fonctionnelle ici..."
              className="
                w-full h-[350px]
                bg-[#0F172A]
                border border-[#1E293B]
                rounded-2xl p-5
                text-white resize-none outline-none
                focus:border-[#A855F7]
              "
            />
          </div>

          {/* RIGHT */}
          <div>
            <h2 className="text-2xl font-semibold mb-6">
              Paramètres de génération
            </h2>

            <div className="space-y-6">
              <div>
                <label className="block mb-2 text-gray-400">Langue</label>
                <select
                  className="
                    w-full bg-[#0F172A]
                    border border-[#1E293B]
                    rounded-xl p-4
                  "
                >
                  <option>Français</option>
                  <option>English</option>
                </select>
              </div>

              <div>
                <label className="block mb-2 text-gray-400">
                  Niveau de détail
                </label>
                <select
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
                    "5-8 scénarios — happy paths principaux, style sobre."}
                  {detailLevel === "avance" &&
                    "10-15 scénarios — cas d'erreur, valeurs limites, tags @happy/@error/@edge."}
                  {detailLevel === "expert" &&
                    "15-25 scénarios — Scenario Outline, Background, tags riches, cas de sécurité."}
                </p>
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
                  w-full mt-8 py-4 rounded-2xl text-lg font-semibold
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
          )}
        </div>

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

        {parsed && parsed.background && (
          <div className="mb-6 border border-[#1E293B] rounded-2xl bg-[#050816]">
            <div className="px-5 py-2 border-b border-[#1E293B] text-xs text-gray-400">
              Background partagé
            </div>
            <pre className="font-mono text-[13px] leading-7 p-5 text-gray-200 whitespace-pre overflow-auto">
              {parsed.background}
            </pre>
          </div>
        )}

        {parsed && parsed.scenarios.length === 0 && (
          <div className="text-gray-500 italic">
            Aucun scénario n'a pu être extrait de la sortie. La copie brute
            est disponible via le bouton ci-dessus.
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
};

const SECTION_KEYWORDS = [
  "Feature",
  "Rule",
  "Background",
  "Scenario Outline",
  "Scenario",
  "Example",
  "Examples",
];

const STEP_KEYWORDS = ["Given", "When", "Then", "And", "But"];

function GherkinViewer({ code }: { code: string }) {
  const lines = code.split("\n");

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

  return (
    <div
      className="
        mb-5 p-3 rounded-2xl
        border border-[#1E293B] bg-[#0B1226]
        flex items-center justify-between gap-3 flex-wrap
      "
    >
      <div className="flex items-center gap-3 text-sm">
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
          onClick={onSelectAll}
          disabled={bulkSaving || unvalidatedCount === 0 || allUnvalidatedSelected}
          className="
            px-3 py-1.5 rounded-lg text-sm
            border border-[#334155] text-gray-300
            hover:bg-[#111827] hover:border-[#7C3AED] hover:text-white
            disabled:opacity-40 disabled:cursor-not-allowed
            transition
          "
        >
          Tout sélectionner
        </button>

        <button
          onClick={onClearSelection}
          disabled={bulkSaving || selectedCount === 0}
          className="
            px-3 py-1.5 rounded-lg text-sm
            border border-[#334155] text-gray-300
            hover:bg-[#111827] disabled:opacity-40 disabled:cursor-not-allowed
            transition
          "
        >
          Tout désélectionner
        </button>

        <button
          onClick={onBulkValidate}
          disabled={bulkSaving || selectedCount === 0}
          className="
            px-4 py-1.5 rounded-lg text-sm font-semibold
            bg-gradient-to-r from-[#7C3AED] to-[#10B981]
            hover:opacity-90 transition
            disabled:opacity-40 disabled:cursor-not-allowed
            flex items-center gap-2
          "
        >
          {bulkSaving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {bulkProgress
                ? `Validation ${bulkProgress.done}/${bulkProgress.total}…`
                : "Validation…"}
            </>
          ) : (
            <>
              <CheckCircle2 size={14} />
              Valider la sélection
              {selectedCount > 0 && ` (${selectedCount})`}
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
  // tags affichables : on les relit du texte courant (pas du parser
  // initial) pour rester cohérent après une édition manuelle
  const tags = extractTagsFromBlock(currentText);
  const title = extractTitleFromBlock(currentText) || scenario.title;

  return (
    <div
      className={`
        border rounded-2xl bg-[#050816] overflow-hidden transition
        ${
          isValidated
            ? "border-emerald-500/50 shadow-[0_0_20px_-12px_rgba(16,185,129,0.4)]"
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
              disabled={isSaving}
              className={`
                px-3 py-1.5 rounded-lg
                transition flex items-center gap-1.5 text-sm
                ${
                  isValidated
                    ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 cursor-default"
                    : "bg-gradient-to-r from-[#7C3AED] to-[#10B981] hover:opacity-90 text-white"
                }
                disabled:opacity-50
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
    const m = line.match(/^\s*Scenario(?: Outline)?:\s*(.*)$/i);
    if (m) return m[1].trim();
  }
  return "";
}

function extractTagsFromBlock(block: string): string[] {
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // première ligne non vide : si tags, on les renvoie
    if (trimmed.startsWith("@")) {
      return trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
    }
    return [];
  }
  return [];
}
