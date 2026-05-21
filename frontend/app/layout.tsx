// app/layout.tsx

import "./globals.css";
import Sidebar from "@/components/Sidebar";
import ChatPanel from "@/components/ChatPanel";

export const metadata = {
  title: "EXPERSI QA Copilot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-[#050816] text-white">

        <div className="flex h-screen overflow-hidden">

          <Sidebar />

          <main className="flex-1 overflow-auto">
            {children}
          </main>

        </div>

        {/* Chat IA flottant — accessible depuis toutes les pages */}
        <ChatPanel />

      </body>
    </html>
  );
}