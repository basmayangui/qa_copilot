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

        <Link
          href="/"
          aria-label="Retour à l'accueil"
          className="
            mb-12
            block
            cursor-pointer
            rounded-xl
            transition
            hover:opacity-90
            focus:outline-none
            focus-visible:ring-2
            focus-visible:ring-[#A855F7]
            focus-visible:ring-offset-2
            focus-visible:ring-offset-[#070B1A]
          "
        >

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

        </Link>

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


    </aside>
  );
}