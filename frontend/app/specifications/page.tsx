// frontend/app/specifications/page.tsx

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Upload,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Trash2,
  Eye,
  Search,
  Clock3,
  Loader2,
  AlertTriangle,
  X,
  RefreshCw,
} from "lucide-react";

/**
 * Normalise un nom de fichier pour la détection de doublons :
 * - décomposition NFD + strip des marques diacritiques (é → e)
 * - lowercase
 *
 * Sans ça, "Spec.pdf" / "spec.pdf" / "spéc.pdf" passeraient pour des
 * documents distincts côté UI alors que l'utilisateur veut le même.
 */
function normalizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Action choisie par l'utilisateur dans la modal de doublon. */
type DuplicateAction = "replace" | "cancel";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type UploadedFile = {
  id: string;
  name: string;
  type: string;
  size: string;
  date: string;
};

// --- Backend payload ---
type ServerFile = {
  name: string;
  size: number;
  uploaded_at: string;
  ui_uploaded: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function mapServerFile(f: ServerFile): UploadedFile {
  return {
    id: f.name, // le nom est unique côté disque, on s'en sert comme id stable
    name: f.name,
    type: f.name.split(".").pop()?.toUpperCase() || "FILE",
    size: formatSize(f.size),
    date: new Date(f.uploaded_at).toLocaleString(),
  };
}

export default function SpecificationsPage() {

  const inputRef = useRef<HTMLInputElement>(null);

  // ↳ l'historique est désormais hydraté depuis le backend, pas conservé
  //   uniquement dans le state React. Donc il survit aux hot reloads.
  const [files, setFiles] = useState<UploadedFile[]>([]);

  // Compteur RAG réel — tous fichiers indexés, peu importe leur origine
  // (UI ou ajout manuel dans uploaded_docs/). Sert au panneau "Base
  // documentaire IA" à droite, indépendamment du filtrage de la liste.
  const [totalIndexed, setTotalIndexed] = useState(0);

  const [uploading, setUploading] = useState(false);

  // Modal de doublon : quand l'utilisateur tente d'uploader un fichier
  // dont le nom (normalisé NFD + lowercase) matche un fichier déjà
  // indexé. La promise est résolue par l'un des 3 boutons du modal et
  // débloque la suite de la boucle d'upload dans handleUpload.
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    incomingName: string;
    existingName: string;
    resolve: (action: DuplicateAction) => void;
  } | null>(null);

  function askUserAboutDuplicate(
    incomingName: string,
    existingName: string,
  ): Promise<DuplicateAction> {
    return new Promise((resolve) => {
      setDuplicatePrompt({ incomingName, existingName, resolve });
    });
  }

  function answerDuplicate(action: DuplicateAction) {
    if (!duplicatePrompt) return;
    duplicatePrompt.resolve(action);
    setDuplicatePrompt(null);
  }

  // --- Recherche dans l'historique ---
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredFiles = normalizedQuery
    ? files.filter((f) => f.name.toLowerCase().includes(normalizedQuery))
    : files;

  // --- URL d'ouverture du fichier brut (bouton œil) ---
  const fileUrl = (name: string) =>
    `${API_BASE}/specifications/${encodeURIComponent(name)}/raw`;

  // --- Chargement initial + helper réutilisable ---
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/specifications`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServerFile[] = await res.json();
      // Total RAG = tous les fichiers indexés (UI + ajouts manuels).
      setTotalIndexed(data.length);
      // L'historique n'affiche QUE les fichiers ajoutés via l'UI.
      // Les fichiers déposés à la main dans uploaded_docs/ sont bien
      // indexés dans le RAG, mais volontairement masqués ici.
      const uiOnly = data.filter((f) => f.ui_uploaded);
      // tri du plus récent au plus ancien
      uiOnly.sort(
        (a, b) =>
          new Date(b.uploaded_at).getTime() -
          new Date(a.uploaded_at).getTime(),
      );
      setFiles(uiOnly.map(mapServerFile));
    } catch (err) {
      console.error("Impossible de charger l'historique :", err);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // --- Polling automatique de l'historique ---
  // Le backend détecte les ajouts/suppressions manuels dans uploaded_docs/
  // toutes les 30s (RAG_WATCH_INTERVAL_SEC). On rafraîchit ici toutes les
  // 10s tant que l'onglet est visible. Tab caché → on suspend pour ne pas
  // taper l'API pour rien.
  useEffect(() => {
    const POLL_INTERVAL_MS = 10_000;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(fetchHistory, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Refresh immédiat au retour de focus, puis on relance le polling
        fetchHistory();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchHistory]);

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {

    const selectedFiles = event.target.files;

    if (!selectedFiles) return;

    setUploading(true);

    let processedCount = 0;
    let skippedCount = 0;

    try {

      // Snapshot des noms déjà indexés au début du flow. Comme on
      // n'attend pas un re-fetch entre chaque fichier, on capture
      // une fois et on compare contre cette liste pour TOUTE la
      // boucle (suffit pour détecter les doublons au moment où
      // l'utilisateur a sélectionné le batch).
      const existingByNormName = new Map(
        files.map((f) => [normalizeFileName(f.name), f.name]),
      );

      for (const file of Array.from(selectedFiles)) {

        // Détection de doublon par nom normalisé (NFD + lowercase).
        const existingName = existingByNormName.get(
          normalizeFileName(file.name),
        );

        let action: DuplicateAction = "replace";
        if (existingName) {
          action = await askUserAboutDuplicate(file.name, existingName);
        }

        if (action === "cancel") {
          skippedCount++;
          continue;
        }

        // FRONT → BACKEND
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `${API_BASE}/upload-specification`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error("Erreur upload");
        }

        processedCount++;
      }

      // Source de vérité = le backend. On recharge l'historique
      // au lieu d'ajouter en local (qui se perd au hot reload).
      await fetchHistory();

      const parts: string[] = [];
      if (processedCount > 0) {
        parts.push(`${processedCount} indexé(s)`);
      }
      if (skippedCount > 0) {
        parts.push(`${skippedCount} ignoré(s)`);
      }
      alert(
        parts.length > 0
          ? `Upload terminé — ${parts.join(", ")}.`
          : "Upload terminé.",
      );

    } catch (error) {

      console.error(error);

      alert(
        "Erreur lors de l’upload ou de la reconstruction du RAG."
      );

    } finally {

      setUploading(false);

      // reset l'input pour pouvoir re-sélectionner le même fichier ensuite
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeFile(filename: string) {
    if (!confirm(`Supprimer "${filename}" ? Le RAG sera reconstruit.`)) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/specifications/${encodeURIComponent(filename)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchHistory();
    } catch (err) {
      console.error(err);
      alert("Suppression impossible.");
    }
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white p-10">

      {/* HEADER */}

      <div className="mb-10">

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
            mb-6
          "
        >
          <Upload size={18} />

          <span className="text-sm">
            Gestion documentaire QA
          </span>
        </div>

        <h1 className="text-5xl font-black mb-4">
          Ajouter des spécifications
        </h1>

        <p className="text-xl text-gray-400 max-w-3xl leading-8">
          Importez vos spécifications fonctionnelles,
          cahiers des charges, user stories et documents
          métiers afin d’alimenter le moteur IA RAG.
        </p>

      </div>

      {/* TOP GRID */}

      <div className="grid grid-cols-3 gap-8">

        {/* LEFT */}

        <div className="col-span-2">

          {/* UPLOAD ZONE */}

          <div
            className="
              relative
              overflow-hidden
              rounded-[35px]
              border
              border-dashed
              border-[#7C3AED]
              bg-gradient-to-br
              from-[#0B1020]
              to-[#111827]
              p-12
              mb-8
            "
          >

            <div
              className="
                absolute
                top-[-120px]
                right-[-120px]
                w-[250px]
                h-[250px]
                rounded-full
                bg-purple-500/20
                blur-3xl
              "
            />

            <div className="relative z-10 text-center">

              <div
                className="
                  mx-auto
                  w-24
                  h-24
                  rounded-full
                  flex
                  items-center
                  justify-center
                  bg-gradient-to-r
                  from-[#7C3AED]
                  via-[#C026D3]
                  to-[#F59E0B]
                  mb-8
                "
              >
                <Upload size={42} />
              </div>

              <h2 className="text-3xl font-bold mb-4">
                Déposez vos documents QA
              </h2>

              <p className="text-gray-400 text-lg mb-8">
                PDF, DOCX, TXT, XLSX, User Stories,
                Cahiers des charges...
              </p>

              <button
                disabled={uploading}
                onClick={() =>
                  inputRef.current?.click()
                }
                className="
                  px-8
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
                  flex
                  items-center
                  gap-3
                  mx-auto
                "
              >
                {uploading ? (
                  <>
                    <Loader2
                      size={22}
                      className="animate-spin"
                    />
                    Reconstruction du RAG...
                  </>
                ) : (
                  <>
                    <Upload size={22} />
                    Ajouter des fichiers
                  </>
                )}
              </button>

              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={handleUpload}
              />

            </div>

          </div>

          {/* HISTORY */}

          <div
            className="
              rounded-[35px]
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
            "
          >

            <div className="flex justify-between mb-8">

              <div>

                <h2 className="text-3xl font-bold mb-2">
                  Historique des fichiers
                </h2>

                <p className="text-gray-400">
                  Documents importés dans la base IA
                </p>

              </div>

              <div
                className="
                  flex
                  items-center
                  gap-3
                  bg-[#111827]
                  border
                  border-[#1E293B]
                  rounded-2xl
                  px-5
                  py-3
                  w-[300px]
                  h-fit
                  focus-within:border-[#7C3AED]
                  transition
                "
              >
                <Search
                  size={18}
                  className={
                    normalizedQuery
                      ? "text-[#A855F7]"
                      : "text-gray-400"
                  }
                />

                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un fichier..."
                  className="
                    bg-transparent
                    outline-none
                    w-full
                    placeholder:text-gray-500
                  "
                />

                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    aria-label="Effacer la recherche"
                    className="
                      text-gray-400
                      hover:text-white
                      transition
                    "
                  >
                    ×
                  </button>
                )}
              </div>

            </div>

            {/* RÉSULTATS DE RECHERCHE — compteur */}

            {normalizedQuery && (
              <p className="text-sm text-gray-400 mb-4">
                {filteredFiles.length} résultat
                {filteredFiles.length > 1 ? "s" : ""} pour{" "}
                <span className="text-[#A855F7]">
                  « {searchQuery} »
                </span>
              </p>
            )}

            {/* TABLE */}

            <div className="space-y-4">

              {filteredFiles.length === 0 && (
                <div
                  className="
                    rounded-2xl
                    border
                    border-dashed
                    border-[#1E293B]
                    bg-[#0F172A]/40
                    py-10
                    text-center
                    text-gray-500
                  "
                >
                  {files.length === 0
                    ? "Aucun document indexé pour le moment."
                    : `Aucun fichier ne correspond à « ${searchQuery} ».`}
                </div>
              )}

              {filteredFiles.map((file) => (

                <div
                  key={file.id}
                  className="
                    flex
                    items-center
                    justify-between
                    rounded-2xl
                    border
                    border-[#1E293B]
                    bg-[#0F172A]
                    p-5
                    hover:border-[#7C3AED]
                    transition
                  "
                >

                  {/* LEFT */}

                  <div className="flex items-center gap-5">

                    <div
                      className="
                        w-16
                        h-16
                        rounded-2xl
                        flex
                        items-center
                        justify-center
                        bg-gradient-to-r
                        from-[#7C3AED]
                        to-[#C026D3]
                      "
                    >

                      {file.type === "PDF" ? (
                        <FileText size={30} />
                      ) : (
                        <FileSpreadsheet size={30} />
                      )}

                    </div>

                    <div>

                      <h3 className="text-lg font-semibold">
                        {file.name}
                      </h3>

                      <div className="flex gap-5 mt-2">

                        <span className="text-gray-400">
                          {file.type}
                        </span>

                        <span className="text-gray-400">
                          {file.size}
                        </span>

                        <span
                          className="
                            flex
                            items-center
                            gap-2
                            text-gray-400
                          "
                        >
                          <Clock3 size={14} />
                          {file.date}
                        </span>

                      </div>

                    </div>

                  </div>

                  {/* ACTIONS */}

                  <div className="flex gap-3">

                    <a
                      href={fileUrl(file.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Ouvrir ${file.name} dans un nouvel onglet`}
                      aria-label={`Ouvrir ${file.name} dans un nouvel onglet`}
                      className="
                        w-12
                        h-12
                        rounded-xl
                        border
                        border-[#334155]
                        flex
                        items-center
                        justify-center
                        hover:bg-[#111827]
                        hover:border-[#7C3AED]
                        transition
                      "
                    >
                      <Eye size={20} />
                    </a>

                    <button
                      onClick={() =>
                        removeFile(file.name)
                      }
                      className="
                        w-12
                        h-12
                        rounded-xl
                        border
                        border-red-500/40
                        text-red-400
                        flex
                        items-center
                        justify-center
                        hover:bg-red-500/10
                      "
                    >
                      <Trash2 size={20} />
                    </button>

                  </div>

                </div>

              ))}

            </div>

          </div>

        </div>

        {/* RIGHT PANEL */}

        <div className="space-y-8">

          {/* RAG STATUS */}

          <div
            className="
              rounded-[35px]
              border
              border-[#1B1F35]
              bg-[#0B1020]
              p-8
            "
          >

            <h2 className="text-2xl font-bold mb-6">
              Base documentaire IA
            </h2>

            <div className="space-y-6">

              <div>

                <div className="flex justify-between mb-2">

                  <span className="text-gray-400">
                    Documents indexés
                  </span>

                  <span className="font-semibold">
                    {totalIndexed}
                  </span>

                </div>

                <div
                  className="
                    h-3
                    rounded-full
                    bg-[#111827]
                    overflow-hidden
                  "
                >
                  <div
                    className="
                      h-full
                      w-full
                      bg-gradient-to-r
                      from-[#7C3AED]
                      to-[#F59E0B]
                    "
                  />
                </div>

              </div>

              <div
                className="
                  rounded-2xl
                  border
                  border-[#1E293B]
                  bg-[#111827]
                  p-5
                "
              >
                <div className="flex items-center gap-4">

                  <div
                    className="
                      w-12
                      h-12
                      rounded-xl
                      bg-green-500/20
                      flex
                      items-center
                      justify-center
                    "
                  >
                    <FileArchive size={22} />
                  </div>

                  <div>

                    <h3 className="font-semibold">
                      Vector Store
                    </h3>

                    <p className="text-green-400 text-sm">
                      Chroma opérationnel
                    </p>

                  </div>

                </div>

              </div>

            </div>

          </div>

          {/* AI INFO */}

          <div
            className="
              rounded-[35px]
              border
              border-[#7C3AED]
              bg-gradient-to-br
              from-[#111827]
              to-[#0B1020]
              p-8
            "
          >

            <h2 className="text-2xl font-bold mb-5">
              IA RAG
            </h2>

            <p className="text-gray-300 leading-8">
              Les documents importés seront automatiquement :
            </p>

            <ul className="mt-6 space-y-4 text-gray-400">

              <li>
                • analysés par IA
              </li>

              <li>
                • chunkés automatiquement
              </li>

              <li>
                • vectorisés dans Chroma
              </li>

              <li>
                • utilisés pour générer les cas QA
              </li>

              <li>
                • réindexés après chaque upload
              </li>

            </ul>

          </div>

        </div>

      </div>

      {/* MODAL DOUBLON — apparaît quand l'utilisateur tente d'uploader
          un fichier dont le nom matche un fichier déjà indexé.
          Bloque la boucle handleUpload jusqu'à la décision. */}
      {duplicatePrompt && (
        <div
          className="
            fixed inset-0 z-50
            flex items-center justify-center
            bg-black/70 backdrop-blur-sm
          "
          onClick={() => answerDuplicate("cancel")}
        >
          <div
            className="
              relative max-w-xl w-full mx-6
              rounded-3xl border border-[#7C3AED]/50
              bg-[#0B1020] shadow-[0_0_40px_-12px_rgba(168,85,247,0.5)]
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bouton fermer (X) */}
            <button
              onClick={() => answerDuplicate("cancel")}
              aria-label="Fermer"
              className="
                absolute top-4 right-4
                w-9 h-9 rounded-xl
                border border-[#1E293B]
                flex items-center justify-center
                text-gray-400 hover:text-white hover:bg-[#111827]
                transition
              "
            >
              <X size={18} />
            </button>

            <div className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div
                  className="
                    w-12 h-12 rounded-2xl flex-shrink-0
                    flex items-center justify-center
                    bg-amber-500/15 border border-amber-500/40
                  "
                >
                  <AlertTriangle size={24} className="text-amber-300" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-1">
                    Ce fichier existe déjà
                  </h3>
                  <p className="text-sm text-gray-400">
                    Un document avec un nom équivalent est déjà indexé dans
                    la base RAG.
                  </p>
                </div>
              </div>

              <div
                className="
                  rounded-2xl border border-[#1E293B]
                  bg-[#050816] p-4 mb-6 text-sm
                "
              >
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">Fichier sélectionné :</span>
                  <span className="text-gray-200 font-mono break-all text-right ml-2">
                    {duplicatePrompt.incomingName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Déjà indexé :</span>
                  <span className="text-gray-200 font-mono break-all text-right ml-2">
                    {duplicatePrompt.existingName}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-400 mb-6">
                Que souhaites-tu faire ?
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => answerDuplicate("replace")}
                  className="
                    w-full px-5 py-3 rounded-2xl
                    bg-gradient-to-r from-[#7C3AED] to-[#C026D3]
                    hover:brightness-110 transition
                    flex items-center gap-3 text-left
                  "
                >
                  <RefreshCw size={20} className="flex-shrink-0" />
                  <div>
                    <div className="font-semibold">Remplacer et ré-indexer</div>
                    <div className="text-xs text-white/80">
                      Écrase le fichier disque et reconstruit ses chunks dans
                      Chroma.
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => answerDuplicate("cancel")}
                  className="
                    w-full px-5 py-3 rounded-2xl
                    border border-[#1E293B]
                    hover:bg-[#0F172A] hover:border-red-500/40
                    transition text-gray-300
                    flex items-center gap-3 text-left
                  "
                >
                  <X size={20} className="flex-shrink-0" />
                  <div>
                    <div className="font-semibold">Annuler cet upload</div>
                    <div className="text-xs text-gray-400">
                      Ne fait rien pour ce fichier. Les autres fichiers du
                      batch continueront d'être traités.
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}