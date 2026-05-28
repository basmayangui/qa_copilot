"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Search,
  Tag as TagIcon,
  Clock3,
  Plus,
} from "lucide-react";
import {
  fetchValidatedTestCases,
  DETAIL_LEVEL_LABELS,
  type ValidatedTestCase,
} from "@/lib/test-cases";

const POLL_INTERVAL_MS = 10_000;

const UNTAGGED = "__untagged__";

export default function CampaignsPage() {
  const [cases, setCases] = useState<ValidatedTestCase[]>([]);
  const [loadingError, setLoadingError] = useState<string>("");
  const [search, setSearch] = useState("");

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

  // Filtre par recherche (titre, feature, tags)
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

  // Groupement par tag — chaque cas peut apparaître sous plusieurs tags
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
          <ClipboardList size={18} />
          <span className="text-sm">Organisation des tests</span>
        </div>

        <h1 className="text-5xl font-black mb-4">
          Gérer les campagnes de test
        </h1>

        <p className="text-xl text-gray-400 max-w-3xl leading-8">
          Les cas validés sont regroupés ici par tag Gherkin (
          <span className="text-[#A855F7]">@smoke</span>,{" "}
          <span className="text-[#A855F7]">@regression</span>,{" "}
          <span className="text-[#A855F7]">@security</span>…).
          Vous pouvez piocher dans ces groupes pour construire des
          campagnes thématiques.
        </p>
      </div>

      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-6">
          <div>
            <span className="font-semibold text-2xl">{cases.length}</span>{" "}
            <span className="text-gray-500">cas validés</span>
          </div>
          <div>
            <span className="font-semibold text-2xl">
              {groupedByTag.length}
            </span>{" "}
            <span className="text-gray-500">groupe(s)</span>
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
              placeholder="Rechercher un cas, un tag, une feature..."
              className="bg-transparent outline-none w-full placeholder:text-gray-500"
            />
          </div>

          <button
            disabled={cases.length === 0}
            onClick={() =>
              alert(
                "La création de campagnes n'est pas encore opérationnelle. Vous pourrez bientôt regrouper les cas en campagnes nommées.",
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
            <Plus size={18} /> Nouvelle campagne
          </button>
        </div>
      </div>

      {loadingError && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 mb-6">
          {loadingError}
        </div>
      )}

      {/* EMPTY STATE */}
      {cases.length === 0 && !loadingError && (
        <div
          className="
            rounded-3xl border border-dashed border-[#1E293B]
            bg-[#0B1020]/40 py-16 text-center text-gray-500
          "
        >
          Aucun cas de test validé pour le moment.
          <br />
          Allez sur la page « Générer des cas de tests », validez vos
          scénarios, ils apparaîtront ici regroupés par tag.
        </div>
      )}

      {cases.length > 0 && filtered.length === 0 && (
        <div className="text-center text-gray-500 italic py-12">
          Aucun cas ne correspond à « {search} ».
        </div>
      )}

      {/* GROUPES PAR TAG */}
      <div className="space-y-8">
        {groupedByTag.map(([tag, group]) => (
          <TagGroup key={tag} tag={tag} cases={group} />
        ))}
      </div>
    </div>
  );
}

/* ===================================================================
 * Groupe par tag
 * =================================================================== */
function TagGroup({
  tag,
  cases,
}: {
  tag: string;
  cases: ValidatedTestCase[];
}) {
  const isUntagged = tag === UNTAGGED;
  return (
    <div className="rounded-3xl border border-[#1B1F35] bg-[#0A1020] overflow-hidden">
      <div
        className="
          flex items-center justify-between
          px-6 py-4
          bg-gradient-to-r from-[#0B1226] to-[#0F172A]
          border-b border-[#1B1F35]
        "
      >
        <div className="flex items-center gap-3">
          <TagIcon size={18} className="text-[#A855F7]" />
          <h2 className="text-xl font-bold">
            {isUntagged ? (
              <span className="text-gray-400 italic">Sans tag</span>
            ) : (
              <span className="text-[#F0ABFC]">{tag}</span>
            )}
          </h2>
        </div>
        <span className="text-sm text-gray-500">
          {cases.length} cas
        </span>
      </div>

      <div className="divide-y divide-[#1B1F35]">
        {cases.map((tc) => (
          <CompactCase key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  );
}

function CompactCase({ tc }: { tc: ValidatedTestCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6 py-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-center justify-between gap-4 hover:bg-[#111827]/40 -mx-3 px-3 py-2 rounded-lg transition"
      >
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold truncate">{tc.title}</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
            {tc.feature && <span>{tc.feature}</span>}
            <span>
              Niveau :{" "}
              <span className="text-gray-300">
                {DETAIL_LEVEL_LABELS[tc.detail_level] ?? tc.detail_level}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Clock3 size={11} />
              {new Date(tc.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">
          {open ? "Replier" : "Voir le Gherkin"}
        </span>
      </button>

      {open && (
        <pre className="mt-3 font-mono text-[12.5px] leading-6 text-gray-300 bg-[#050816] border border-[#1E293B] rounded-xl p-4 overflow-auto max-h-[300px]">
          {tc.gherkin}
        </pre>
      )}
    </div>
  );
}
