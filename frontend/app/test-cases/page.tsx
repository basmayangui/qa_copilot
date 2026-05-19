"use client";

import { ReactNode, useState } from "react";
import axios from "axios";
import { Copy, Check, Sparkles, AlertCircle } from "lucide-react";

export default function TestCasesPage() {
  const [specification, setSpecification] = useState("");
  const [gherkin, setGherkin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
      });

      setGherkin(response.data.gherkin);
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
                  className="
                    w-full bg-[#0F172A]
                    border border-[#1E293B]
                    rounded-xl p-4
                  "
                >
                  <option>Standard</option>
                  <option>Avancé</option>
                  <option>Expert QA</option>
                </select>
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
            {gherkin && (
              <p className="text-gray-500 text-sm mt-1">
                {gherkin.split("\n").length} lignes ·{" "}
                {countScenarios(gherkin)} scénario(s)
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
                  <Copy size={16} /> Copier
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

        {gherkin && <GherkinViewer code={gherkin} />}
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
    <div
      className="
        bg-[#050816]
        border border-[#1E293B]
        rounded-2xl
        overflow-hidden
      "
    >
      <div className="flex items-center justify-between px-5 py-2 bg-[#0B1226] border-b border-[#1E293B]">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#FB7185]" />
          <span className="w-3 h-3 rounded-full bg-[#FBBF24]" />
          <span className="w-3 h-3 rounded-full bg-[#34D399]" />
        </div>
        <span className="text-xs text-gray-500 font-mono">feature.feature</span>
      </div>

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

/* --- Petit utilitaire stats --- */
function countScenarios(code: string): number {
  return (code.match(/^\s*(Scenario(?: Outline)?|Example):/gm) ?? []).length;
}
