"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code2,
  Search,
  CheckCircle2,
  Sparkles,
  Tag as TagIcon,
  Clock3,
  Loader2,
  Copy,
  Check,
  Download,
  AlertCircle,
} from "lucide-react";
import {
  fetchValidatedTestCases,
  generateScripts,
  saveValidatedScript,
  scriptFilename,
  DETAIL_LEVEL_LABELS,
  SCRIPT_FRAMEWORK_LABELS,
  type ValidatedTestCase,
  type ScriptFramework,
  type GeneratedScriptPerCase,
} from "@/lib/test-cases";
import { Pencil, Save, X, Minus } from "lucide-react";

const POLL_INTERVAL_MS = 10_000;

const FRAMEWORKS: { value: ScriptFramework; label: string }[] = [
  { value: "playwright", label: "Playwright (TypeScript)" },
];

const UNTAGGED = "__untagged__";

export default function TestScriptsPage() {
  const [cases, setCases] = useState<ValidatedTestCase[]>([]);
  const [loadingError, setLoadingError] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // --- État génération des scripts (1 par cas) ---
  const [framework, setFramework] = useState<ScriptFramework>("playwright");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string>("");

  // Les N scripts retournés par le backend.
  const [scripts, setScripts] = useState<GeneratedScriptPerCase[]>([]);
  // Code courant par script (après édition éventuelle). Clé = test_case_id.
  const [scriptCodes, setScriptCodes] = useState<Record<string, string>>({});
  // Scripts validés en backend : test_case_id → id du ValidatedScript.
  const [validatedScripts, setValidatedScripts] = useState<Record<string, string>>({});
  // Édition inline (un seul script à la fois).
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editScriptBuffer, setEditScriptBuffer] = useState("");
  const [savingScriptId, setSavingScriptId] = useState<string | null>(null);
  const [copiedScriptId, setCopiedScriptId] = useState<string | null>(null);

  // Sélection multi-scripts pour validation en masse (différent de
  // `selected` qui sert au choix des cas dont générer les scripts).
  // Clé = test_case_id.
  const [selectedScriptIds, setSelectedScriptIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkValidating, setBulkValidating] = useState(false);
  const [bulkValidateProgress, setBulkValidateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Tags actuellement repliés (par nom). Permet de gérer Plier/Déplier
  // tout au niveau de la page tout en gardant chaque groupe contrôlable
  // individuellement.
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoadingError("");
      const data = await fetchValidatedTestCases();
      setCases(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setLoadingError(`Impossible de charger les cas validés (${msg})`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(load, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // Filtre par recherche
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        t.feature.toLowerCase().includes(q),
    );
  }, [cases, search]);

  // Groupement par tag pour l'arborescence — un cas peut apparaître
  // dans plusieurs groupes s'il porte plusieurs tags. Sa sélection
  // (par ID) reste partagée entre toutes ses apparitions.
  const groupedByTag = useMemo(() => {
    const groups = new Map<string, ValidatedTestCase[]>();
    for (const tc of filtered) {
      if (tc.tags.length === 0) {
        if (!groups.has(UNTAGGED)) groups.set(UNTAGGED, []);
        groups.get(UNTAGGED)!.push(tc);
        continue;
      }
      for (const tag of tc.tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(tc);
      }
    }
    // tri : tags alphabétiques en premier, untagged en dernier
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sélection en masse pour tout un groupe de tag :
  // - si TOUS les cas du groupe sont déjà cochés → on désélectionne tout
  // - sinon → on coche tout le groupe (couvre les cas 0 et partiel)
  function toggleGroupSelection(group: ValidatedTestCase[]) {
    setSelected((prev) => {
      const allInGroupSelected =
        group.length > 0 && group.every((c) => prev.has(c.id));
      const next = new Set(prev);
      if (allInGroupSelected) {
        for (const c of group) next.delete(c.id);
      } else {
        for (const c of group) next.add(c.id);
      }
      return next;
    });
  }

  // --- Génération des scripts (1 par cas) ---
  async function runGenerate() {
    if (selected.size === 0 || generating) return;
    setGenerating(true);
    setGenError("");
    setScripts([]);
    setScriptCodes({});
    setValidatedScripts({});
    setEditingScriptId(null);
    setEditScriptBuffer("");
    try {
      // Si tous les cas sélectionnés partagent le même project_name,
      // on l'envoie pour personnaliser le test.describe() de chaque fichier.
      const projects = new Set(
        Array.from(selected)
          .map((id) => cases.find((c) => c.id === id)?.project_name || "")
          .filter(Boolean),
      );
      const project_name =
        projects.size === 1 ? Array.from(projects)[0] : "";

      const result = await generateScripts({
        test_case_ids: Array.from(selected),
        framework,
        project_name,
      });
      setScripts(result.scripts);
      // initialise scriptCodes avec le code généré pour chaque cas
      const initialCodes: Record<string, string> = {};
      for (const s of result.scripts) {
        initialCodes[s.test_case_id] = s.code;
      }
      setScriptCodes(initialCodes);

      setTimeout(() => {
        document
          .getElementById("generated-scripts")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setGenError(`Échec de la génération : ${msg}`);
    } finally {
      setGenerating(false);
    }
  }

  // --- Édition d'un script ---
  function startEditScript(s: GeneratedScriptPerCase) {
    setEditingScriptId(s.test_case_id);
    setEditScriptBuffer(scriptCodes[s.test_case_id] ?? s.code);
  }

  function cancelEditScript() {
    setEditingScriptId(null);
    setEditScriptBuffer("");
  }

  function saveEditScript() {
    if (editingScriptId === null) return;
    setScriptCodes((prev) => ({
      ...prev,
      [editingScriptId]: editScriptBuffer,
    }));
    setEditingScriptId(null);
    setEditScriptBuffer("");
  }

  // --- Validation d'un script ---
  async function validateScript(s: GeneratedScriptPerCase) {
    const currentCode = scriptCodes[s.test_case_id] ?? s.code;
    setSavingScriptId(s.test_case_id);
    try {
      const saved = await saveValidatedScript({
        test_case_id: s.test_case_id,
        test_case_title: s.test_case_title,
        framework: s.framework,
        language: s.language,
        code: currentCode,
        project_name: s.project_name,
        tags: s.tags,
        test_type: s.test_type,
      });
      setValidatedScripts((prev) => ({
        ...prev,
        [s.test_case_id]: saved.id,
      }));
      // retire de la sélection s'il y était
      setSelectedScriptIds((prev) => {
        if (!prev.has(s.test_case_id)) return prev;
        const next = new Set(prev);
        next.delete(s.test_case_id);
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setGenError(`Validation impossible : ${msg}`);
    } finally {
      setSavingScriptId(null);
    }
  }

  // --- Sélection multi-scripts pour validation en masse ---
  function toggleScriptSelection(testCaseId: string) {
    setSelectedScriptIds((prev) => {
      const next = new Set(prev);
      if (next.has(testCaseId)) next.delete(testCaseId);
      else next.add(testCaseId);
      return next;
    });
  }

  // Liste des scripts éligibles à la validation en masse
  // (générés sans erreur, pas déjà validés).
  function eligibleForBulk(): GeneratedScriptPerCase[] {
    return scripts.filter(
      (s) => !s.error && !validatedScripts[s.test_case_id],
    );
  }

  function selectAllScripts() {
    const eligible = eligibleForBulk();
    setSelectedScriptIds(new Set(eligible.map((s) => s.test_case_id)));
  }

  function clearScriptSelection() {
    setSelectedScriptIds(new Set());
  }

  async function bulkValidateScripts() {
    if (bulkValidating) return;
    const ids = Array.from(selectedScriptIds).filter(
      (id) => !validatedScripts[id],
    );
    if (ids.length === 0) return;

    setBulkValidating(true);
    setGenError("");
    setBulkValidateProgress({ done: 0, total: ids.length });

    let errorCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const s = scripts.find((x) => x.test_case_id === id);
      if (!s || s.error) {
        setBulkValidateProgress({ done: i + 1, total: ids.length });
        continue;
      }
      const currentCode = scriptCodes[id] ?? s.code;
      try {
        const saved = await saveValidatedScript({
          test_case_id: s.test_case_id,
          test_case_title: s.test_case_title,
          framework: s.framework,
          language: s.language,
          code: currentCode,
          project_name: s.project_name,
          tags: s.tags,
          test_type: s.test_type,
        });
        setValidatedScripts((prev) => ({ ...prev, [id]: saved.id }));
        setSelectedScriptIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (e) {
        console.error("[bulk-validate-script]", id, e);
        errorCount++;
      } finally {
        setBulkValidateProgress({ done: i + 1, total: ids.length });
      }
    }

    setBulkValidating(false);
    setBulkValidateProgress(null);
    if (errorCount > 0) {
      setGenError(`${errorCount} validation(s) en erreur sur ${ids.length}.`);
    }
  }

  async function copyScriptCode(s: GeneratedScriptPerCase) {
    const code = scriptCodes[s.test_case_id] ?? s.code;
    await navigator.clipboard.writeText(code);
    setCopiedScriptId(s.test_case_id);
    setTimeout(() => setCopiedScriptId(null), 1500);
  }

  function downloadScriptCode(s: GeneratedScriptPerCase) {
    const code = scriptCodes[s.test_case_id] ?? s.code;
    const filename = perScriptFilename(s);
    const blob = new Blob([code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white p-10">
      {/* HEADER */}
      <div className="mb-10">
        <div
          className="
            inline-flex items-center gap-3
            px-5 py-2 rounded-full
            border border-[#7C3AED] bg-[#7C3AED]/10
            mb-6
          "
        >
          <Code2 size={18} />
          <span className="text-sm">Automatisation des tests</span>
        </div>

        <h1 className="text-5xl font-black mb-4">
          Générer des scripts de tests
        </h1>

        <p className="text-xl text-gray-400 max-w-3xl leading-8">
          Choisissez les cas de test validés à partir desquels vous voulez
          générer des scripts d'automatisation (Playwright, Cypress,
          Selenium…). Seuls les cas explicitement validés depuis la page
          « Générer des cas de tests » apparaissent ici.
        </p>
      </div>

      {/* TOP BAR : count + selection + search */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="text-gray-300">
            <span className="font-semibold text-2xl">{cases.length}</span>{" "}
            <span className="text-gray-500">cas validés</span>
          </div>
          {selected.size > 0 && (
            <div className="text-[#A855F7] text-sm">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="
              flex items-center gap-3
              bg-[#111827] border border-[#1E293B] rounded-2xl
              px-5 py-3 w-[280px]
              focus-within:border-[#7C3AED] transition
            "
          >
            <Search size={18} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un cas..."
              className="bg-transparent outline-none w-full placeholder:text-gray-500"
            />
          </div>

          {/* Framework selector */}
          <select
            value={framework}
            onChange={(e) =>
              setFramework(e.target.value as ScriptFramework)
            }
            disabled={generating}
            className="
              bg-[#111827] border border-[#1E293B] rounded-2xl
              px-5 py-3 text-white outline-none
              focus:border-[#7C3AED] transition
              disabled:opacity-50
            "
          >
            {FRAMEWORKS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <button
            disabled={selected.size === 0 || generating}
            onClick={runGenerate}
            className="
              px-5 py-3 rounded-2xl
              bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F59E0B]
              hover:opacity-90 transition
              disabled:opacity-40 disabled:cursor-not-allowed
              flex items-center gap-2 font-semibold
            "
          >
            {generating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Génération en cours…
              </>
            ) : (
              <>
                <Sparkles size={18} />
                Générer les scripts
                {selected.size > 0 && ` (${selected.size})`}
              </>
            )}
          </button>
        </div>
      </div>

      {genError && (
        <div
          className="
            bg-red-500/10 border border-red-500/40
            text-red-300 rounded-xl p-4 mb-6
            flex items-start gap-3
          "
        >
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <div>{genError}</div>
        </div>
      )}

      {loadingError && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 mb-6">
          {loadingError}
        </div>
      )}

      {/* LIST */}
      {cases.length === 0 && !loadingError && (
        <div
          className="
            rounded-3xl border border-dashed border-[#1E293B]
            bg-[#0B1020]/40 py-16 text-center text-gray-500
          "
        >
          Aucun cas de test validé pour le moment.
          <br />
          Allez sur la page « Générer des cas de tests », générez vos
          scénarios puis cliquez sur « Valider » sur ceux qui vous
          conviennent. Ils apparaîtront ici.
        </div>
      )}

      {cases.length > 0 && filtered.length === 0 && (
        <div className="text-center text-gray-500 italic py-12">
          Aucun cas ne correspond à « {search} ».
        </div>
      )}

      {groupedByTag.length > 0 && (
        <div className="flex items-center justify-end mb-3">
          <button
            onClick={() => {
              const allTags = groupedByTag.map(([t]) => t);
              const allCollapsed = allTags.every((t) => collapsedTags.has(t));
              setCollapsedTags(allCollapsed ? new Set() : new Set(allTags));
            }}
            className="
              text-xs text-gray-400 hover:text-[#A855F7] transition
              underline-offset-2 hover:underline
            "
          >
            {groupedByTag.every(([t]) => collapsedTags.has(t))
              ? "Déplier tout"
              : "Plier tout"}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {groupedByTag.map(([tag, group]) => (
          <TagGroup
            key={tag}
            tag={tag}
            cases={group}
            selectedIds={selected}
            onToggle={toggleSelect}
            onToggleGroupSelection={toggleGroupSelection}
            collapsed={collapsedTags.has(tag)}
            onToggleCollapsed={() =>
              setCollapsedTags((prev) => {
                const next = new Set(prev);
                if (next.has(tag)) next.delete(tag);
                else next.add(tag);
                return next;
              })
            }
          />
        ))}
      </div>

      {/* SCRIPTS GÉNÉRÉS — un par cas, chaque carte Éditer/Valider */}
      {scripts.length > 0 && (
        <div
          id="generated-scripts"
          className="
            mt-10 border border-[#1B1F35] rounded-3xl
            bg-[#0A1020] p-8
          "
        >
          <div className="mb-6">
            <h2 className="text-2xl font-bold">
              Scripts {SCRIPT_FRAMEWORK_LABELS[framework]} générés
            </h2>
            <p className="text-gray-500 text-sm mt-1">
              {scripts.length} script(s) — 1 fichier par cas
              {Object.keys(validatedScripts).length > 0 && (
                <>
                  {" · "}
                  <span className="text-emerald-400">
                    {Object.keys(validatedScripts).length} validé(s)
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-gray-500 italic mt-1">
              Édite chaque script si besoin, puis clique sur Valider. Les
              scripts validés apparaissent dans l'onglet « Exécuter les
              scripts de test ».
            </p>
          </div>

          {/* Barre de validation en masse */}
          <BulkScriptToolbar
            total={scripts.length}
            eligibleCount={eligibleForBulk().length}
            selectedCount={selectedScriptIds.size}
            bulkSaving={bulkValidating}
            bulkProgress={bulkValidateProgress}
            onSelectAll={selectAllScripts}
            onClearSelection={clearScriptSelection}
            onBulkValidate={bulkValidateScripts}
          />

          <div className="space-y-5">
            {scripts.map((s) => (
              <ScriptCard
                key={s.test_case_id}
                script={s}
                currentCode={scriptCodes[s.test_case_id] ?? s.code}
                isValidated={!!validatedScripts[s.test_case_id]}
                isEditing={editingScriptId === s.test_case_id}
                isSaving={savingScriptId === s.test_case_id}
                isSelected={selectedScriptIds.has(s.test_case_id)}
                bulkSaving={bulkValidating}
                isCopied={copiedScriptId === s.test_case_id}
                editBuffer={editScriptBuffer}
                onToggleSelect={() => toggleScriptSelection(s.test_case_id)}
                onChangeEdit={setEditScriptBuffer}
                onStartEdit={() => startEditScript(s)}
                onSaveEdit={saveEditScript}
                onCancelEdit={cancelEditScript}
                onValidate={() => validateScript(s)}
                onCopy={() => copyScriptCode(s)}
                onDownload={() => downloadScriptCode(s)}
                downloadName={perScriptFilename(s)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
 * Helpers
 * =================================================================== */
// perScriptFilename est un simple alias de scriptFilename de la lib
// partagée — gère désormais les accents (é → e, etc.).
function perScriptFilename(script: GeneratedScriptPerCase): string {
  return scriptFilename(script);
}

/* ===================================================================
 * BulkScriptToolbar — validation en masse des scripts générés
 * =================================================================== */
function BulkScriptToolbar({
  total,
  eligibleCount,
  selectedCount,
  bulkSaving,
  bulkProgress,
  onSelectAll,
  onClearSelection,
  onBulkValidate,
}: {
  total: number;
  eligibleCount: number;
  selectedCount: number;
  bulkSaving: boolean;
  bulkProgress: { done: number; total: number } | null;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkValidate: () => void;
}) {
  const allEligibleSelected =
    eligibleCount > 0 && selectedCount === eligibleCount;
  const someSelected = selectedCount > 0 && !allEligibleSelected;
  const noneSelectable = eligibleCount === 0;

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
        <button
          onClick={handleMasterToggle}
          disabled={bulkSaving || noneSelectable}
          aria-label={
            allEligibleSelected ? "Tout désélectionner" : "Tout sélectionner"
          }
          title={
            noneSelectable
              ? "Aucun script à valider"
              : allEligibleSelected
                ? "Tout désélectionner"
                : someSelected
                  ? `Désélectionner (${selectedCount} sélectionné${selectedCount > 1 ? "s" : ""})`
                  : "Tout sélectionner"
          }
          className={`
            w-5 h-5 rounded-md border-2 flex-shrink-0
            flex items-center justify-center transition
            ${
              allEligibleSelected
                ? "bg-[#7C3AED] border-[#7C3AED]"
                : someSelected
                  ? "bg-[#7C3AED]/40 border-[#7C3AED]"
                  : "border-gray-600 hover:border-[#7C3AED]"
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {allEligibleSelected && <Check size={12} className="text-white" />}
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
                {eligibleCount} validable{eligibleCount > 1 ? "s" : ""}
              </span>
            </>
          ) : (
            <>
              <span className="text-gray-300">{total}</span> script(s) généré(s)
              {eligibleCount < total && (
                <>
                  {" · "}
                  <span className="text-gray-500">
                    {eligibleCount} restant(s) à valider
                  </span>
                </>
              )}
            </>
          )}
        </span>
      </div>

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
  );
}

/* ===================================================================
 * ScriptCard — UN script généré pour UN cas, avec Éditer/Valider
 * =================================================================== */
function ScriptCard({
  script,
  currentCode,
  isValidated,
  isEditing,
  isSaving,
  isSelected,
  bulkSaving,
  isCopied,
  editBuffer,
  onToggleSelect,
  onChangeEdit,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onValidate,
  onCopy,
  onDownload,
  downloadName,
}: {
  script: GeneratedScriptPerCase;
  currentCode: string;
  isValidated: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isSelected: boolean;
  bulkSaving: boolean;
  isCopied: boolean;
  editBuffer: string;
  onToggleSelect: () => void;
  onChangeEdit: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onValidate: () => void;
  onCopy: () => void;
  onDownload: () => void;
  downloadName: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasError = !!script.error;
  return (
    <div
      className={`
        border rounded-2xl bg-[#050816] overflow-hidden transition
        ${
          isValidated
            ? "border-emerald-500/50 shadow-[0_0_20px_-12px_rgba(16,185,129,0.4)]"
            : hasError
              ? "border-red-500/40"
              : isSelected
                ? "border-[#A855F7] shadow-[0_0_20px_-12px_rgba(168,85,247,0.5)]"
                : "border-[#1E293B] hover:border-[#7C3AED]/40"
        }
      `}
    >
      {/* Header carte */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[#0B1226] border-b border-[#1E293B]">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {isValidated ? (
            <CheckCircle2
              size={20}
              className="text-emerald-400 flex-shrink-0"
              aria-label="Validé"
            />
          ) : hasError ? (
            <AlertCircle
              size={20}
              className="text-red-400 flex-shrink-0"
              aria-label="Erreur"
            />
          ) : (
            <button
              onClick={onToggleSelect}
              disabled={bulkSaving}
              aria-label={isSelected ? "Désélectionner" : "Sélectionner"}
              title={
                isSelected
                  ? "Désélectionner"
                  : "Sélectionner pour validation en masse"
              }
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
          <h3 className="font-semibold truncate min-w-0">
            {script.test_case_title}
          </h3>
          {script.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B0764] text-[#F0ABFC] border border-[#7C3AED]/40"
            >
              {t}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing && !isValidated && !hasError && (
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
          {!isEditing && !hasError && (
            <button
              onClick={onValidate}
              disabled={isSaving || isValidated}
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

      {/* Sous-header avec actions secondaires + plier */}
      {!isEditing && (
        <div className="flex items-center justify-between px-5 py-2 bg-[#0B1226]/60 border-b border-[#1E293B] text-xs text-gray-400 flex-wrap gap-2">
          <div>
            {script.project_name && (
              <>
                Projet :{" "}
                <span className="text-gray-300">{script.project_name}</span>
                {" · "}
              </>
            )}
            {currentCode.split("\n").length} lignes
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCopy}
              className="
                px-2 py-1 rounded-md text-xs
                border border-[#334155]
                hover:bg-[#111827] transition
                flex items-center gap-1
              "
            >
              {isCopied ? (
                <>
                  <Check size={12} className="text-emerald-400" /> Copié
                </>
              ) : (
                <>
                  <Copy size={12} /> Copier
                </>
              )}
            </button>
            <button
              onClick={onDownload}
              title={`Télécharger ${downloadName}`}
              className="
                px-2 py-1 rounded-md text-xs
                bg-[#7C3AED]/10 border border-[#7C3AED]/40
                text-[#E9D5FF] hover:bg-[#7C3AED]/20
                transition flex items-center gap-1
              "
            >
              <Download size={12} /> .spec.ts
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="
                text-[#A855F7] hover:text-[#C084FC]
                transition underline-offset-2 hover:underline
                text-xs
              "
            >
              {expanded ? "Afficher moins" : "Afficher plus"}
            </button>
          </div>
        </div>
      )}

      {/* Corps : code, éditeur ou message d'erreur */}
      {hasError ? (
        <div className="px-5 py-4 text-sm text-red-300 bg-red-500/5">
          Échec de la génération pour ce cas : {script.error}
        </div>
      ) : isEditing ? (
        <textarea
          value={editBuffer}
          onChange={(e) => onChangeEdit(e.target.value)}
          className="
            w-full min-h-[300px]
            bg-[#050816] text-gray-100
            font-mono text-[13px] leading-7
            p-5 outline-none resize-y
          "
          spellCheck={false}
        />
      ) : (
        expanded && (
          <pre className="font-mono text-[13px] leading-7 p-5 overflow-auto text-gray-200 max-h-[500px] whitespace-pre">
            {currentCode}
          </pre>
        )
      )}
    </div>
  );
}

/* ===================================================================
 * TagGroup — section pliable d'un tag, contient plusieurs CompactCase
 * =================================================================== */
function TagGroup({
  tag,
  cases,
  selectedIds,
  onToggle,
  onToggleGroupSelection,
  collapsed,
  onToggleCollapsed,
}: {
  tag: string;
  cases: ValidatedTestCase[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroupSelection: (cases: ValidatedTestCase[]) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const isUntagged = tag === UNTAGGED;
  const selectedInGroup = cases.filter((c) => selectedIds.has(c.id)).length;
  const allSelected =
    cases.length > 0 && selectedInGroup === cases.length;
  const someSelected = selectedInGroup > 0 && !allSelected;

  return (
    <div className="rounded-3xl border border-[#1B1F35] bg-[#0A1020] overflow-hidden">
      <div
        className="
          w-full flex items-center justify-between
          px-6 py-4
          bg-gradient-to-r from-[#0B1226] to-[#0F172A]
          border-b border-[#1B1F35]
        "
      >
        <div className="flex items-center gap-3">
          {/* Checkbox tri-état — sélection en masse du tag entier */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroupSelection(cases);
            }}
            title={
              allSelected
                ? `Désélectionner tout le tag "${isUntagged ? "Sans tag" : tag}"`
                : `Sélectionner tout le tag "${isUntagged ? "Sans tag" : tag}"`
            }
            className={`
              w-5 h-5 rounded-md border-2 flex-shrink-0
              flex items-center justify-center transition
              ${
                allSelected
                  ? "bg-[#7C3AED] border-[#7C3AED]"
                  : someSelected
                    ? "bg-[#7C3AED]/40 border-[#7C3AED]"
                    : "border-gray-600 hover:border-[#7C3AED]"
              }
            `}
          >
            {allSelected && <Check size={12} className="text-white" />}
            {someSelected && <Minus size={12} className="text-white" />}
          </button>

          {/* Cliquer sur le titre/icône plie/déplie le groupe */}
          <button
            onClick={onToggleCollapsed}
            className="flex items-center gap-3 hover:opacity-80 transition"
          >
            <TagIcon size={18} className="text-[#A855F7]" />
            <h2 className="text-xl font-bold">
              {isUntagged ? (
                <span className="text-gray-400 italic">Sans tag</span>
              ) : (
                <span className="text-[#F0ABFC]">{tag}</span>
              )}
            </h2>
            <span className="text-sm text-gray-500">· {cases.length} cas</span>
            {selectedInGroup > 0 && (
              <span className="text-xs text-[#A855F7]">
                · {selectedInGroup} sélectionné{selectedInGroup > 1 ? "s" : ""}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={onToggleCollapsed}
          className="text-xs text-gray-500 hover:text-white transition"
        >
          {collapsed ? "▾ Déplier" : "▴ Plier"}
        </button>
      </div>

      {!collapsed && (
        <div className="divide-y divide-[#1B1F35]">
          {cases.map((tc) => (
            <CompactCase
              key={tc.id}
              tc={tc}
              selected={selectedIds.has(tc.id)}
              onToggle={() => onToggle(tc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
 * CompactCase — ligne compacte, gherkin masqué (Afficher plus)
 * =================================================================== */
function CompactCase({
  tc,
  selected,
  onToggle,
}: {
  tc: ValidatedTestCase;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`
        px-6 py-3 transition
        ${selected ? "bg-[#1E0B3A]/40" : "hover:bg-[#111827]/30"}
      `}
    >
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          aria-label={selected ? "Désélectionner" : "Sélectionner"}
          className={`
            mt-1 w-5 h-5 rounded-md border-2 flex-shrink-0
            flex items-center justify-center transition
            ${
              selected
                ? "bg-[#7C3AED] border-[#7C3AED]"
                : "border-gray-600 hover:border-[#7C3AED]"
            }
          `}
        >
          {selected && <CheckCircle2 size={14} className="text-white" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h3 className="font-semibold truncate">{tc.title}</h3>
            {tc.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B0764] text-[#F0ABFC] border border-[#7C3AED]/40"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            {tc.feature && (
              <span className="flex items-center gap-1.5">
                <TagIcon size={11} /> {tc.feature}
              </span>
            )}
            <span>
              Niveau :{" "}
              <span className="text-gray-300">
                {DETAIL_LEVEL_LABELS[tc.detail_level] ?? tc.detail_level}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={11} />
              {new Date(tc.created_at).toLocaleString()}
            </span>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="
                ml-auto text-[#A855F7] hover:text-[#C084FC]
                transition underline-offset-2 hover:underline
              "
            >
              {expanded ? "Afficher moins" : "Afficher plus"}
            </button>
          </div>

          {expanded && (
            <pre className="
              mt-3 font-mono text-[12.5px] leading-6 text-gray-300
              bg-[#050816] border border-[#1E293B] rounded-xl
              p-4 overflow-auto max-h-[400px]
            ">
              {tc.gherkin}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
