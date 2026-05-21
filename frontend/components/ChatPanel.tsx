"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import {
  Bot,
  X,
  Send,
  Sparkles,
  Loader2,
  Trash2,
} from "lucide-react";

/**
 * EXPERSI QA Copilot — Chat IA
 *
 * Panneau flottant en bas à droite. S'ouvre via :
 *   window.dispatchEvent(new Event("open-chat"))
 * (déclenché par le bouton "Ouvrir le chat" de la Sidebar).
 *
 * Backend attendu : POST http://localhost:8000/chat
 *   body  : { messages: [{role, content}], use_rag: boolean }
 *   reply : { reply: string, used_rag: boolean }
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const STORAGE_KEY = "expersi.chat.history.v1";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  ts: number;
};

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Bonjour, je suis l'assistant IA d'EXPERSI QA Copilot. Pose-moi une question sur tes spécifications, demande-moi de générer des idées de tests, ou explique-moi un comportement métier — je m'appuie sur tes documents indexés pour répondre.",
  ts: Date.now(),
};

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ----- Ouverture via event global -----
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("open-chat", onOpen);
    return () => window.removeEventListener("open-chat", onOpen);
  }, []);

  // ----- Persistance de l'historique (localStorage) -----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // ----- Autoscroll quand un message arrive ou pendant l'envoi -----
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  // ----- Focus input à l'ouverture -----
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ----- Envoi -----
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setError(null);

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      ts: Date.now(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory
            // on n'envoie pas le message de bienvenue, c'est cosmétique
            .filter((m) => m.id !== "welcome")
            .map((m) => ({ role: m.role, content: m.content })),
          use_rag: true,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: { reply: string; used_rag?: boolean } = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply || "(réponse vide)",
          ts: Date.now(),
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setError(`Connexion impossible (${msg})`);
    } finally {
      setSending(false);
    }
  }, [input, messages, sending]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearHistory = () => {
    if (!confirm("Effacer la conversation ?")) return;
    setMessages([WELCOME]);
    setError(null);
  };

  return (
    <>
      {/* Floating button (toujours visible si fermé) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le chat IA"
          className="
            fixed bottom-6 right-6 z-40
            w-14 h-14 rounded-full
            bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F59E0B]
            shadow-lg shadow-purple-900/40
            flex items-center justify-center
            hover:opacity-90 transition
          "
        >
          <Bot size={26} />
        </button>
      )}

      {/* Panel */}
      <div
        className={`
          fixed bottom-6 right-6 z-50
          w-[400px] max-w-[calc(100vw-2rem)]
          h-[600px] max-h-[calc(100vh-3rem)]
          rounded-3xl
          border border-[#1B1F35]
          bg-[#070B1A]
          shadow-2xl shadow-purple-900/40
          flex flex-col overflow-hidden
          transition-all duration-200
          ${open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"}
        `}
      >
        {/* Header */}
        <div
          className="
            px-5 py-4
            border-b border-[#1B1F35]
            bg-gradient-to-r from-[#0B1226] to-[#0F172A]
            flex items-center justify-between
          "
        >
          <div className="flex items-center gap-3">
            <div
              className="
                w-10 h-10 rounded-full
                bg-gradient-to-r from-[#7C3AED] to-[#F59E0B]
                flex items-center justify-center
              "
            >
              <Bot size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-base leading-tight">
                IA Assistant
              </h3>
              <p className="text-xs text-gray-400">
                Connecté à votre base RAG
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={clearHistory}
              title="Effacer"
              className="p-2 rounded-lg hover:bg-[#12182B] text-gray-400 hover:text-red-400 transition"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={() => setOpen(false)}
              title="Fermer"
              className="p-2 rounded-lg hover:bg-[#12182B] text-gray-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-gray-400 text-sm px-2">
              <Loader2 size={14} className="animate-spin" />
              L'IA réfléchit…
            </div>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[#1B1F35] p-3 bg-[#080D1C]">
          <div
            className="
              flex items-end gap-2
              rounded-2xl
              border border-[#1E293B]
              bg-[#0F172A]
              px-3 py-2
              focus-within:border-[#7C3AED]
              transition
            "
          >
            <Sparkles size={18} className="text-gray-500 mt-2" />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Posez votre question…  (Entrée pour envoyer, Maj+Entrée pour saut de ligne)"
              rows={1}
              className="
                flex-1 bg-transparent outline-none resize-none
                text-sm leading-6 placeholder:text-gray-500
                max-h-32
              "
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="
                p-2 rounded-xl
                bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F59E0B]
                hover:opacity-90 transition
                disabled:opacity-40 disabled:cursor-not-allowed
              "
              aria-label="Envoyer"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6
          whitespace-pre-wrap
          ${
            isUser
              ? "bg-gradient-to-r from-[#7C3AED] to-[#C026D3] text-white"
              : "bg-[#0F172A] border border-[#1E293B] text-gray-100"
          }
        `}
      >
        {message.content}
      </div>
    </div>
  );
}
