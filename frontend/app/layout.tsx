// app/layout.tsx

import "./globals.css";
import Sidebar from "@/components/Sidebar";

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

      </body>
    </html>
  );
}