// frontend/app/specifications/page.tsx

"use client";

import { useRef, useState } from "react";

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
} from "lucide-react";

type UploadedFile = {
  id: number;
  name: string;
  type: string;
  size: string;
  date: string;
};

export default function SpecificationsPage() {

  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UploadedFile[]>([
    
  ]);

  const [uploading, setUploading] = useState(false);

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {

    const selectedFiles = event.target.files;

    if (!selectedFiles) return;

    setUploading(true);

    try {

      const uploadedFiles: UploadedFile[] = [];

      for (const file of Array.from(selectedFiles)) {

        // FRONT → BACKEND

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          "http://localhost:8000/upload-specification",
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          throw new Error("Erreur upload");
        }

        uploadedFiles.push({
          id: Date.now() + Math.random(),
          name: file.name,
          type:
            file.name.split(".").pop()?.toUpperCase() ||
            "FILE",
          size: `${(
            file.size /
            1024 /
            1024
          ).toFixed(2)} MB`,
          date: new Date().toLocaleString(),
        });
      }

      setFiles((prev) => [
        ...uploadedFiles,
        ...prev,
      ]);

      alert(
        "Documents uploadés et RAG reconstruit avec succès."
      );

    } catch (error) {

      console.error(error);

      alert(
        "Erreur lors de l’upload ou de la reconstruction du RAG."
      );

    } finally {

      setUploading(false);
    }
  }

  function removeFile(id: number) {

    setFiles((prev) =>
      prev.filter((file) => file.id !== id)
    );
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
                "
              >
                <Search size={18} />

                <input
                  placeholder="Rechercher un fichier..."
                  className="
                    bg-transparent
                    outline-none
                    w-full
                  "
                />
              </div>

            </div>

            {/* TABLE */}

            <div className="space-y-4">

              {files.map((file) => (

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

                    <button
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
                      "
                    >
                      <Eye size={20} />
                    </button>

                    <button
                      onClick={() =>
                        removeFile(file.id)
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
                    {files.length}
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

    </div>
  );
}