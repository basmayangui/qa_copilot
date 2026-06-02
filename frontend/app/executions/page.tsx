"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PlayCircle,
  Search,
  Copy,
  Check,
  Download,
  Trash2,
  Clock3,
  Folder,
  AlertCircle,
} from "lucide-react";
import {
  fetchValidatedScripts,
  deleteValidatedScript,
  scriptFilename,
  SCRIPT_FRAMEWORK_LABELS,
  type ValidatedScript,
} from "@/lib/test-cases";

const POLL_INTERVAL_MS = 10_000;

const UNGROUPED = "__ungrouped__";

export default function ExecutionsPage() {
  const [scripts, setScripts] = useState<ValidatedScript[]>([]);
  const [loadingError, setLoadingError] = useState<string>("");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );

  const load = useCallback(async () => {
    try {
      setLoadingError("");
      const data = await fetchValidatedScripts();
      setScripts(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setLoadingError(`Impossible de charger les scripts validés (${msg})`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh quand l'onglet est visible
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

  // Filtre par recherche (titre, tags, projet)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter(
      (s) =>
        s.test_case_title.toLowerCase().includes(q) ||
        s.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        s.project_name.toLowerCase().includes(q),
    );
  }, [scripts, search]);

  // Groupement par projet — vue plus utile pour "exécuter" qu'un flat
  const groupedByProject = useMemo(() => {
    const groups = new Map<string, ValidatedScript[]>();
    for (const s of filtered) {
      const key = s.project_name || UNGROUPED;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  async function handleCopy(s: ValidatedScript) {
    await navigator.clipboard.writeText(s.code);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function handleDownload(s: ValidatedScript) {
    const filename = scriptFilename(s);
    const blob = new Blob([s.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(s: ValidatedScript) {
    if (
      !confirm(
        `Supprimer le script « ${s.test_case_title} » de la liste des exécutables ?`,
      )
    ) {
      return;
    }
    try {
      await deleteValidatedScript(s.id);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setLoadingError(`Suppression impossible (${msg})`);
    }
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
          <PlayCircle size={18} />
          <span className="text-sm">Exécution des tests</span>
        </div>

        <h1 className="text-5xl font-black mb-4">
          Exécuter les scripts de test
        </h1>

        <p className="text-xl text-gray-400 max-w-3xl leading-8">
          Les scripts de test validés depuis l'onglet « Générer des
          scripts de tests » apparaissent ici, regroupés par projet.
          Vous pouvez les inspecter, les copier ou les télécharger
          comme fichiers <code>.spec.ts</code> Playwright.
        </p>
      </div>

      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-6">
          <div>
            <span className="font-semibold text-2xl">{scripts.length}</span>{" "}
            <span className="text-gray-500">script(s) validé(s)</span>
          </div>
          <div>
            <span className="font-semibold text-2xl">
              {groupedByProject.length}
            </span>{" "}
            <span className="text-gray-500">projet(s)</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="
              flex items-center gap-3
              bg-[#111827] border border-[#1E293B] rounded-2xl
              px-5 py-3 w-[300px]
              focus-within:border-[#7C3AED] transition
            "
          >
            <Search size={18} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un script, un projet, un tag..."
              className="bg-transparent outline-none w-full placeholder:text-gray-500"
            />
          </div>
        </div>
      </div>

      {loadingError && (
        <div
          className="
            bg-red-500/10 border border-red-500/40 text-red-300
            rounded-xl p-4 mb-6 flex items-start gap-3
          "
        >
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <div>{loadingError}</div>
        </div>
      )}

      {/* EMPTY STATE */}
      {scripts.length === 0 && !loadingError && (
        <div
          className="
            rounded-3xl border border-dashed border-[#1E293B]
            bg-[#0B1020]/40 py-16 text-center text-gray-500
          "
        >
          Aucun script validé pour le moment.
          <br />
          Allez sur la page « Générer des scripts de tests », sélectionnez
          des cas validés et cliquez sur Valider pour chaque script qui vous
          convient. Ils apparaîtront ici.
        </div>
      )}

      {scripts.length > 0 && filtered.length === 0 && (
        <div className="text-center text-gray-500 italic py-12">
          Aucun script ne correspond à « {search} ».
        </div>
      )}

      {/* Bouton global Plier/Déplier */}
      {groupedByProject.length > 0 && (
        <div className="flex items-center justify-end mb-3">
          <button
            onClick={() => {
              const all = groupedByProject.map(([p]) => p);
              const allCollapsed = all.every((p) =>
                collapsedProjects.has(p),
              );
              setCollapsedProjects(
                allCollapsed ? new Set() : new Set(all),
              );
            }}
            className="
              text-xs text-gray-400 hover:text-[#A855F7]
              transition underline-offset-2 hover:underline
            "
          >
            {groupedByProject.every(([p]) => collapsedProjects.has(p))
              ? "Déplier tout"
              : "Plier tout"}
          </button>
        </div>
      )}

      {/* GROUPES PAR PROJET */}
      <div className="space-y-6">
        {groupedByProject.map(([project, list]) => (
          <ProjectGroup
            key={project}
            project={project}
            scripts={list}
            collapsed={collapsedProjects.has(project)}
            onToggleCollapsed={() =>
              setCollapsedProjects((prev) => {
                const next = new Set(prev);
                if (next.has(project)) next.delete(project);
                else next.add(project);
                return next;
              })
            }
            copiedId={copiedId}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

/* ===================================================================
 * ProjectGroup
 * =================================================================== */
function ProjectGroup({
  project,
  scripts,
  collapsed,
  onToggleCollapsed,
  copiedId,
  onCopy,
  onDownload,
  onDelete,
}: {
  project: string;
  scripts: ValidatedScript[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  copiedId: string | null;
  onCopy: (s: ValidatedScript) => void;
  onDownload: (s: ValidatedScript) => void;
  onDelete: (s: ValidatedScript) => void;
}) {
  const isUngrouped = project === UNGROUPED;
  return (
    <div className="rounded-3xl border border-[#1B1F35] bg-[#0A1020] overflow-hidden">
      <button
        onClick={onToggleCollapsed}
        className="
          w-full flex items-center justify-between
          px-6 py-4
          bg-gradient-to-r from-[#0B1226] to-[#0F172A]
          border-b border-[#1B1F35]
          hover:bg-[#111827]/60 transition
        "
      >
        <div className="flex items-center gap-3">
          <Folder size={18} className="text-[#A855F7]" />
          <h2 className="text-xl font-bold">
            {isUngrouped ? (
              <span className="text-gray-400 italic">Sans projet</span>
            ) : (
              <span className="text-[#F0ABFC]">{project}</span>
            )}
          </h2>
          <span className="text-sm text-gray-500">· {scripts.length} script(s)</span>
        </div>
        <span className="text-xs text-gray-500">
          {collapsed ? "▾ Déplier" : "▴ Plier"}
        </span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-[#1B1F35]">
          {scripts.map((s) => (
            <ScriptRow
              key={s.id}
              script={s}
              isCopied={copiedId === s.id}
              onCopy={() => onCopy(s)}
              onDownload={() => onDownload(s)}
              onDelete={() => onDelete(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
 * ScriptRow — UN script validé avec code repliable
 * =================================================================== */
function ScriptRow({
  script,
  isCopied,
  onCopy,
  onDownload,
  onDelete,
}: {
  script: ValidatedScript;
  isCopied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h3 className="font-semibold truncate">
              {script.test_case_title}
            </h3>
            <span
              className="
                text-[10px] px-2 py-0.5 rounded-md
                bg-emerald-500/10 text-emerald-300
                border border-emerald-500/40
              "
            >
              {SCRIPT_FRAMEWORK_LABELS[script.framework] ?? script.framework}
            </span>
            {script.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B0764] text-[#F0ABFC] border border-[#7C3AED]/40"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span>{script.code.split("\n").length} lignes</span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={11} />
              {new Date(script.created_at).toLocaleString()}
            </span>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="
                text-[#A855F7] hover:text-[#C084FC]
                transition underline-offset-2 hover:underline
              "
            >
              {expanded ? "Afficher moins" : "Afficher plus"}
            </button>
          </div>

          {expanded && (
            <pre className="
              mt-3 font-mono text-[12.5px] leading-6 text-gray-200
              bg-[#050816] border border-[#1E293B] rounded-xl
              p-4 overflow-auto max-h-[400px] whitespace-pre
            ">
              {script.code}
            </pre>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onCopy}
            title="Copier le code"
            className="
              p-2 rounded-lg
              border border-[#334155]
              hover:bg-[#111827] transition
            "
          >
            {isCopied ? (
              <Check size={16} className="text-emerald-400" />
            ) : (
              <Copy size={16} />
            )}
          </button>
          <button
            onClick={onDownload}
            title={`Télécharger ${scriptFilename(script)}`}
            className="
              p-2 rounded-lg
              bg-[#7C3AED]/10 border border-[#7C3AED]/40
              text-[#E9D5FF]
              hover:bg-[#7C3AED]/20 transition
            "
          >
            <Download size={16} />
          </button>
          <button
            onClick={onDelete}
            title="Retirer de la liste"
            className="
              p-2 rounded-lg
              border border-red-500/40 text-red-400
              hover:bg-red-500/10 transition
            "
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// scriptFilename est fourni par lib/test-cases.ts et gère désormais
// la translittération (é → e, à → a, etc.).
