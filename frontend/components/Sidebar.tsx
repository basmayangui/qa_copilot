"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

import {
  FileText,
  Code2,
  Upload,
  ClipboardList,
  PlayCircle,
  BarChart3,
  Sparkles,
  Bot,
} from "lucide-react";

const menu = [
  {
    title: "Générer des cas de tests",
    href: "/test-cases",
    icon: FileText,
  },
  {
    title: "Générer des scripts de tests",
    href: "/test-scripts",
    icon: Code2,
  },
  {
    title: "Ajouter des spécifications",
    href: "/specifications",
    icon: Upload,
  },
  {
    title: "Gérer les campagnes de test",
    href: "/campaigns",
    icon: ClipboardList,
  },
  {
    title: "Exécuter des scripts de test",
    href: "/executions",
    icon: PlayCircle,
  },
  {
    title: "Visualiser les rapports",
    href: "/reports",
    icon: BarChart3,
  },
  {
    title: "Analyser les erreurs par IA",
    href: "/ai-analysis",
    icon: Sparkles,
  },
];

export default function Sidebar() {

  const pathname = usePathname();

  return (
    <aside
      className="
        w-80
        h-screen
        bg-[#070B1A]
        border-r
        border-[#1B1F35]
        flex
        flex-col
        justify-between
        p-6
      "
    >

      {/* TOP */}

      <div>

        {/* LOGO */}

        <div className="mb-12">

          <h1
            className="
              text-4xl
              font-black
              tracking-tight
            "
          >

            <span className="text-[#8B3DFF]">
              Ex
            </span>

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
              persi QA Copilot
            </span>

          </h1>

        </div>

        {/* MENU */}

        <nav className="flex flex-col gap-3">

          {menu.map((item) => {

            const Icon = item.icon;

            const active =
              pathname === item.href;

            return (

              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex
                  items-center
                  gap-4
                  px-5
                  py-4
                  rounded-2xl
                  transition-all
                  duration-300

                  ${
                    active
                      ? `
                        bg-gradient-to-r
                        from-[#7C3AED]
                        via-[#C026D3]
                        to-[#F59E0B]
                        text-white
                        shadow-lg
                        scale-[1.02]
                      `
                      : `
                        text-gray-300
                        hover:bg-[#12182B]
                        hover:text-white
                      `
                  }
                `}
              >

                <Icon size={22} />

                <span className="text-[15px] font-medium">
                  {item.title}
                </span>

              </Link>

            );
          })}

        </nav>

      </div>

      {/* AI ASSISTANT */}

      <div
        className="
          mt-10
          rounded-3xl
          border
          border-[#7C3AED]
          bg-gradient-to-br
          from-[#12182B]
          to-[#0B1020]
          p-6
        "
      >

        <div className="flex items-center gap-4 mb-4">

          <div
            className="
              w-14
              h-14
              rounded-full
              flex
              items-center
              justify-center
              bg-gradient-to-r
              from-[#7C3AED]
              to-[#F59E0B]
            "
          >
            <Bot size={28} />
          </div>

          <div>

            <h3 className="font-semibold text-lg">
              IA Assistant
            </h3>

            <p className="text-gray-400 text-sm">
              Posez vos questions à l’IA
            </p>

          </div>

        </div>

        <button
          className="
            w-full
            py-3
            rounded-xl
            border
            border-[#7C3AED]
            hover:bg-[#161E35]
            transition
          "
        >
          Ouvrir le chat
        </button>

      </div>

    </aside>
  );
}