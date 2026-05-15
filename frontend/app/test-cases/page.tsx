"use client";

import { useState } from "react";
import axios from "axios";

export default function TestCasesPage() {

  const [specification, setSpecification] = useState("");

  const [gherkin, setGherkin] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  async function generateGherkin() {

    if (!specification.trim()) {
      setError("Veuillez saisir une spécification.");
      return;
    }

    try {

      setLoading(true);

      setError("");

      setGherkin("");

      const response = await axios.post(
        "http://localhost:8000/generate",
        {
          text: specification,
        }
      );

      setGherkin(response.data.gherkin);

    } catch (err) {

      console.error(err);

      setError(
        "Erreur lors de la génération des scénarios."
      );

    } finally {

      setLoading(false);

    }
  }

  return (
    <div className="p-10">

      {/* Header */}

      <div className="mb-10">

        <h1 className="text-5xl font-bold mb-4">
          Générer des cas de tests
        </h1>

        <p className="text-gray-400 text-lg">
          Générez automatiquement des scénarios Gherkin
          à partir de vos spécifications fonctionnelles.
        </p>

      </div>

      {/* Main Card */}

      <div
        className="
          border
          border-[#1B1F35]
          rounded-3xl
          bg-[#0A1020]
          p-8
        "
      >

        <div className="grid grid-cols-2 gap-10">

          {/* LEFT */}

          <div>

            <h2 className="text-2xl font-semibold mb-6">
              Spécification fonctionnelle
            </h2>

            <textarea
              value={specification}
              onChange={(e) =>
                setSpecification(e.target.value)
              }
              placeholder="Collez votre spécification fonctionnelle ici..."
              className="
                w-full
                h-[350px]
                bg-[#0F172A]
                border
                border-[#1E293B]
                rounded-2xl
                p-5
                text-white
                resize-none
                outline-none
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

                <label className="block mb-2 text-gray-400">
                  Langue
                </label>

                <select
                  className="
                    w-full
                    bg-[#0F172A]
                    border
                    border-[#1E293B]
                    rounded-xl
                    p-4
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
                    w-full
                    bg-[#0F172A]
                    border
                    border-[#1E293B]
                    rounded-xl
                    p-4
                  "
                >
                  <option>Standard</option>
                  <option>Avancé</option>
                  <option>Expert QA</option>
                </select>

              </div>

              {/* Error */}

              {error && (
                <div
                  className="
                    bg-red-500/10
                    border
                    border-red-500
                    text-red-400
                    rounded-xl
                    p-4
                  "
                >
                  {error}
                </div>
              )}

              {/* Button */}

              <button
                onClick={generateGherkin}
                disabled={loading}
                className="
                  w-full
                  mt-8
                  py-4
                  rounded-2xl
                  text-lg
                  font-semibold
                  bg-gradient-to-r
                  from-[#7C3AED]
                  via-[#C026D3]
                  to-[#F59E0B]
                  hover:opacity-90
                  transition
                  disabled:opacity-50
                "
              >

                {loading
                  ? "Génération en cours..."
                  : "Générer les scénarios"}

              </button>

            </div>

          </div>

        </div>

      </div>

      {/* RESULT */}

      <div
        className="
          mt-10
          border
          border-[#1B1F35]
          rounded-3xl
          bg-[#0A1020]
          p-8
        "
      >

        <div className="flex justify-between mb-6">

          <h2 className="text-3xl font-semibold">
            Cas de tests générés
          </h2>

          {gherkin && (

            <button
              onClick={() => {
                navigator.clipboard.writeText(gherkin);
              }}
              className="
                px-5
                py-3
                rounded-xl
                border
                border-[#334155]
                hover:bg-[#111827]
              "
            >
              Copier
            </button>

          )}

        </div>

        {/* Empty State */}

        {!gherkin && !loading && (

          <div
            className="
              flex
              items-center
              justify-center
              h-[250px]
              text-gray-500
              text-xl
            "
          >
            Vos scénarios Gherkin apparaîtront ici
          </div>

        )}

        {/* Loading */}

        {loading && (

          <div
            className="
              flex
              items-center
              justify-center
              h-[250px]
              text-[#C026D3]
              text-2xl
            "
          >
            Génération IA en cours...
          </div>

        )}

        {/* Results */}

        {gherkin && (

          <pre
            className="
              whitespace-pre-wrap
              bg-[#050816]
              border
              border-[#1E293B]
              rounded-2xl
              p-6
              overflow-auto
              text-sm
              leading-7
              text-green-400
            "
          >
            {gherkin}
          </pre>

        )}

      </div>

    </div>
  );
}