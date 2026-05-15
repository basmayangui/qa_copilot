// frontend/app/page.tsx

"use client";

import Link from "next/link";

import {
  Sparkles,
  FileText,
  Code2,
  BarChart3,
  Bot,
} from "lucide-react";

export default function HomePage() {

  return (
    <div className="min-h-screen bg-[#050816] text-white p-10">

      {/* HERO */}

      <section
        className="
          relative
          overflow-hidden
          rounded-[40px]
          border
          border-[#1B1F35]
          bg-gradient-to-br
          from-[#0B1020]
          via-[#111827]
          to-[#0F172A]
          p-16
        "
      >

        {/* Glow */}

        <div
          className="
            absolute
            top-[-120px]
            right-[-120px]
            w-[350px]
            h-[350px]
            rounded-full
            bg-purple-600/20
            blur-3xl
          "
        />

        <div
          className="
            absolute
            bottom-[-120px]
            left-[-120px]
            w-[350px]
            h-[350px]
            rounded-full
            bg-orange-500/20
            blur-3xl
          "
        />

        {/* Content */}

        <div className="relative z-10 max-w-4xl">

          <div
            className="
              inline-flex
              items-center
              gap-3
              px-5
              py-2
              rounded-full
              border
              border-[#7C3AED]
              bg-[#7C3AED]/10
              mb-8
            "
          >
            <Sparkles size={18} />

            <span className="text-sm">
              AI Powered QA Platform
            </span>
          </div>

          <h1
            className="
              text-6xl
              font-black
              leading-tight
              mb-8
            "
          >
            <span className="text-[#8B3DFF]">
              EXPERSI
            </span>

            <br />

            <span
              className="
                bg-gradient-to-r
                from-[#A855F7]
                via-[#D946EF]
                to-[#F59E0B]
                bg-clip-text
                text-transparent
              "
            >
              QA Copilot
            </span>
          </h1>

          <p
            className="
              text-xl
              text-gray-300
              leading-9
              max-w-3xl
              mb-10
            "
          >
            Plateforme intelligente de génération
            automatique de cas de tests,
            scripts QA et analyse d’erreurs
            assistée par IA.
          </p>

          <div className="flex gap-6">

            <Link
              href="/test-cases"
              className="
                px-8
                py-4
                rounded-2xl
                font-semibold
                text-lg
                bg-gradient-to-r
                from-[#7C3AED]
                via-[#C026D3]
                to-[#F59E0B]
                hover:opacity-90
                transition
              "
            >
              Générer des cas de tests
            </Link>

            <Link
              href="/specifications"
              className="
                px-8
                py-4
                rounded-2xl
                border
                border-[#334155]
                hover:bg-[#111827]
                transition
              "
            >
              Ajouter des spécifications
            </Link>

          </div>

        </div>

      </section>

      {/* FEATURES */}

      <section className="mt-14">

        <div className="grid grid-cols-4 gap-6">

          {/* Card */}

          <div
            className="
              rounded-3xl
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
              hover:border-[#7C3AED]
              transition
            "
          >

            <div
              className="
                w-14
                h-14
                rounded-2xl
                flex
                items-center
                justify-center
                bg-gradient-to-r
                from-[#7C3AED]
                to-[#C026D3]
                mb-6
              "
            >
              <FileText size={28} />
            </div>

            <h3 className="text-2xl font-semibold mb-4">
              Cas de tests IA
            </h3>

            <p className="text-gray-400 leading-7">
              Génération automatique de scénarios
              Gherkin à partir de spécifications.
            </p>

          </div>

          {/* Card */}

          <div
            className="
              rounded-3xl
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
              hover:border-[#C026D3]
              transition
            "
          >

            <div
              className="
                w-14
                h-14
                rounded-2xl
                flex
                items-center
                justify-center
                bg-gradient-to-r
                from-[#C026D3]
                to-[#F59E0B]
                mb-6
              "
            >
              <Code2 size={28} />
            </div>

            <h3 className="text-2xl font-semibold mb-4">
              Scripts QA
            </h3>

            <p className="text-gray-400 leading-7">
              Génération Playwright, Cypress
              et Selenium automatisée.
            </p>

          </div>

          {/* Card */}

          <div
            className="
              rounded-3xl
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
              hover:border-[#F59E0B]
              transition
            "
          >

            <div
              className="
                w-14
                h-14
                rounded-2xl
                flex
                items-center
                justify-center
                bg-gradient-to-r
                from-[#F59E0B]
                to-[#FB7185]
                mb-6
              "
            >
              <BarChart3 size={28} />
            </div>

            <h3 className="text-2xl font-semibold mb-4">
              Rapports QA
            </h3>

            <p className="text-gray-400 leading-7">
              Visualisation avancée des
              campagnes et résultats de tests.
            </p>

          </div>

          {/* Card */}

          <div
            className="
              rounded-3xl
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
              hover:border-[#8B5CF6]
              transition
            "
          >

            <div
              className="
                w-14
                h-14
                rounded-2xl
                flex
                items-center
                justify-center
                bg-gradient-to-r
                from-[#8B5CF6]
                to-[#EC4899]
                mb-6
              "
            >
              <Bot size={28} />
            </div>

            <h3 className="text-2xl font-semibold mb-4">
              Analyse IA
            </h3>

            <p className="text-gray-400 leading-7">
              Détection intelligente des erreurs
              et recommandations QA automatiques.
            </p>

          </div>

        </div>

      </section>

    </div>
  );
}