"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code2,
  Search,
  CheckCircle2,
  Sparkles,
  Tag as TagIcon,
  Clock3,
} from "lucide-react";
import {
  fetchValidatedTestCases,
  DETAIL_LEVEL_LABELS,
  type ValidatedTestCase,
} from "@/lib/test-cases";

const POLL_INTERVAL_MS = 10_000;

export default function TestScriptsPage() {
  const [cases, setCases] = useState<ValidatedTestCase[]>([]);
  const [loadingError, setLoadingError] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
              placeholder="Rechercher un cas..."
              className="bg-transparent outline-none w-full placeholder:text-gray-500"
            />
          </div>

          <button
            disabled={selected.size === 0}
            onClick={() =>
              alert(
                "La génération de scripts n'est pas encore branchée. Cas sélectionnés : " +
                  Array.from(selected).join(", "),
              )
            }
            className="
              px-5 py-3 rounded-2xl
              bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F59E0B]
              hover:opacity-90 transition
              disabled:opacity-40 disabled:cursor-not-allowed
              flex items-center gap-2 font-semibold
            "
          >
            <Sparkles size={18} /> Générer les scripts
          </button>
        </div>
      </div>

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

      <div className="space-y-4">
        {filtered.map((tc) => (
          <TestCaseRow
            key={tc.id}
            tc={tc}
            selected={selected.has(tc.id)}
            onToggle={() => toggleSelect(tc.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ===================================================================
 * Ligne / carte d'un cas validé — sélectionnable
 * =================================================================== */
function TestCaseRow({
  tc,
  selected,
  onToggle,
}: {
  tc: ValidatedTestCase;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`
        cursor-pointer transition
        rounded-2xl p-5 border
        ${
          selected
            ? "border-[#7C3AED] bg-[#1E0B3A]/40 shadow-lg shadow-purple-900/20"
            : "border-[#1E293B] bg-[#0F172A] hover:border-[#7C3AED]/40"
        }
      `}
    >
      <div className="flex items-start gap-4">
        <div
          className={`
            mt-1 w-5 h-5 rounded-md border-2 flex-shrink-0
            flex items-center justify-center transition
            ${
              selected
                ? "bg-[#7C3AED] border-[#7C3AED]"
                : "border-gray-600"
            }
          `}
        >
          {selected && <CheckCircle2 size={14} className="text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h3 className="text-lg font-semibold truncate">{tc.title}</h3>
            {tc.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B0764] text-[#F0ABFC] border border-[#7C3AED]/40"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3 flex-wrap">
            {tc.feature && (
              <span className="flex items-center gap-1.5">
                <TagIcon size={12} /> {tc.feature}
              </span>
            )}
            <span>
              Niveau :{" "}
              <span className="text-gray-300">
                {DETAIL_LEVEL_LABELS[tc.detail_level] ?? tc.detail_level}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={12} />
              {new Date(tc.created_at).toLocaleString()}
            </span>
          </div>

          <pre className="font-mono text-[12.5px] leading-6 text-gray-300 bg-[#050816] border border-[#1E293B] rounded-xl p-4 overflow-auto max-h-[200px]">
            {tc.gherkin}
          </pre>
        </div>
      </div>
    </div>
  );
}
