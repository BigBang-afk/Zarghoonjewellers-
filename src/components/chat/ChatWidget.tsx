"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ChatDebugInfo, ChatMessageView, ChatStateView, ChatTurnView } from "@zarghoon/core/website";
import ChatProductCards from "@/components/chat/ChatProductCards";

/**
 * Zarghoon AI website chat. All answers come from /api/chat (the Sales Agent
 * over the core business services); this component only renders them.
 */

const WELCOME = "Assalamualaikum! Welcome to Zarghoon Jewellers. How may I help you today?";
const SUGGESTIONS = ["Show bridal jewelry", "Show 22K bangles", "Help me choose a gift", "I want to speak to someone"];
const MAX_LENGTH = 1000;
const ARABIC_SCRIPT = /[؀-ۿ]/;
const HEADERS = { "Content-Type": "application/json", "X-Zarghoon-Chat": "1" };

type Mode = ChatStateView["mode"];
type Model = ChatStateView["model"];

interface ApiError {
  error?: { code?: string; message?: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("We couldn't reach Zarghoon AI. Please check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(data.error?.message ?? "Something went wrong. Please try again.");
  return data;
}

function Icon({ name, className = "h-5 w-5" }: { name: "gem" | "close" | "send" | "reset" | "team" | "info"; className?: string }) {
  const paths: Record<string, string> = {
    gem: "M7 4h10l4 5-9 11L3 9z M3 9h18 M9 4 7 9l5 11 5-11-2-5",
    close: "M6 6l12 12M18 6 6 18",
    send: "M4 12h13M12 5l7 7-7 7",
    reset: "M4 4v6h6M20 20v-6h-6M5.6 15a7 7 0 0 0 12.5 1.5M18.4 9A7 7 0 0 0 5.9 7.5",
    team: "M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3 3 0 0 0-2-2.8M16.5 5.2a3 3 0 0 1 0 5.6",
    info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function Bubble({ m, onAsk, linkTarget }: { m: ChatMessageView; onAsk: (sku: string) => void; linkTarget: "_blank" | "_top" }) {
  const urdu = ARABIC_SCRIPT.test(m.text);
  const textClass = `whitespace-pre-line break-words ${urdu ? "font-urdu text-[15px] leading-loose" : "text-sm leading-relaxed"}`;

  if (m.role === "notice") {
    return (
      <div className="flex justify-center" data-testid="handoff-notice">
        <p className="flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-medium text-gold-dark">
          <Icon name="team" className="h-4 w-4" />
          {m.text}
        </p>
      </div>
    );
  }
  if (m.role === "customer") {
    return (
      <div className="flex justify-end" data-testid="msg-customer">
        <div dir="auto" className={`max-w-[85%] rounded-2xl rounded-br-md bg-charcoal px-4 py-2.5 text-cream ${textClass}`}>{m.text}</div>
      </div>
    );
  }
  const team = m.role === "team";
  return (
    <div className="flex flex-col items-start" data-testid={team ? "msg-team" : "msg-assistant"}>
      <span className="mb-1 ml-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-dark">
        {team ? "Zarghoon team" : "Zarghoon AI"}
      </span>
      <div
        dir="auto"
        className={`max-w-[92%] rounded-2xl rounded-tl-md border px-4 py-2.5 text-charcoal shadow-sm ${team ? "border-maroon/20 bg-maroon/5" : "border-gold/20 bg-white"} ${textClass}`}
      >
        {m.text}
      </div>
      <div className="w-full">
        <ChatProductCards products={m.products} onAsk={onAsk} linkTarget={linkTarget} />
      </div>
    </div>
  );
}

function ContactForm({ onDone }: { onDone: (message: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries({ fullName, phone, email }).filter(([, v]) => v.trim()));
      const res = await api<{ message: string }>("/api/chat/contact", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
      onDone(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20";
  return (
    <form onSubmit={submit} className="space-y-2 border-t border-gold/15 bg-cream px-4 py-3" aria-label="Share contact details">
      <p className="text-xs text-charcoal/60">Optional — share your details so our team can reach you. Nothing is sent to you automatically.</p>
      <input className={field} placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} autoComplete="name" />
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder="Phone / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={25} />
        <input className={field} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" maxLength={120} />
      </div>
      {error && <p className="text-xs text-maroon">{error}</p>}
      <button disabled={busy || !(fullName.trim() || phone.trim() || email.trim())} className="w-full rounded-full bg-charcoal py-2 text-xs font-semibold text-cream transition hover:bg-charcoal-light disabled:opacity-40">
        {busy ? "Saving…" : "Save my details"}
      </button>
    </form>
  );
}

/** Message the embedding page (public/zarghoon-ai.js) — UI events only, never data. */
function notifyParent(type: "zarghoon-ai:close") {
  if (window.parent !== window) window.parent.postMessage({ type }, "*");
}

/**
 * @param embedded rendered inside an iframe on an existing website (/embed/chat):
 *   always open, no launcher, closing is handled by the host page's loader.
 */
export default function ChatWidget({ mode, model, embedded = false }: { mode: Mode; model: Model; embedded?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(embedded);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [takeover, setTakeover] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; retry?: string } | null>(null);
  const [debug, setDebug] = useState<ChatDebugInfo | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const state = await api<ChatStateView>("/api/chat");
      setAvailable(state.available);
      setMessages(state.messages);
      setTakeover(state.humanTakeoverActive);
      setLoaded(true);
    } catch (err) {
      setError({ text: (err as Error).message });
    }
  }, []);

  // Embedded: the chat is open from the start, so load history once on mount.
  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    api<ChatStateView>("/api/chat").then(
      (state) => {
        if (cancelled) return;
        setAvailable(state.available);
        setMessages(state.messages);
        setTakeover(state.humanTakeoverActive);
        setLoaded(true);
      },
      (err: Error) => !cancelled && setError({ text: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [embedded]);

  const close = useCallback(() => (embedded ? notifyParent("zarghoon-ai:close") : setOpen(false)), [embedded]);

  function openChat() {
    setOpen(true);
    if (!loaded) void load();
  }

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    if (message.length > MAX_LENGTH) {
      setError({ text: `Please keep messages under ${MAX_LENGTH} characters.` });
      return;
    }
    setError(null);
    setInfo(null);
    setInput("");
    const pending: ChatMessageView = { id: `pending-${Date.now()}`, role: "customer", text: message, language: null, createdAt: new Date().toISOString(), products: [] };
    setMessages((prev) => [...prev.filter((m) => m.role !== "notice"), pending]);
    setSending(true);
    try {
      const turn = await api<ChatTurnView>("/api/chat", { method: "POST", headers: HEADERS, body: JSON.stringify({ message }) });
      setMessages((prev) => [...prev.filter((m) => m.id !== pending.id), ...turn.messages]);
      setTakeover(turn.humanTakeoverActive);
      setDebug(turn.debug ?? null);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== pending.id));
      setError({ text: (err as Error).message, retry: message });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function reset(scope: "conversation" | "demo") {
    setError(null);
    try {
      await api("/api/chat/reset", { method: "POST", headers: HEADERS, body: JSON.stringify({ scope }) });
      setMessages([]);
      setTakeover(false);
      setDebug(null);
      setInfo(scope === "demo" ? "Demo data has been reset." : null);
    } catch (err) {
      setError({ text: (err as Error).message });
    }
  }

  if (mode === "off" || pathname?.startsWith("/admin") || (!embedded && pathname?.startsWith("/embed"))) return null;
  const linkTarget = embedded ? "_top" : "_blank";

  const customerSpoke = messages.some((m) => m.role === "customer");
  const welcome: ChatMessageView = { id: "welcome", role: "assistant", text: WELCOME, language: "english", createdAt: "", products: [] };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openChat}
          aria-label="Open Zarghoon AI chat"
          data-testid="chat-launcher"
          className="group fixed bottom-5 right-5 z-[60] flex h-16 w-16 items-center justify-center rounded-full bg-charcoal text-gold shadow-[0_10px_30px_-5px_rgba(28,23,18,0.45)] ring-1 ring-gold/40 transition hover:scale-105 hover:ring-gold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 sm:bottom-6 sm:right-6"
        >
          <span className="absolute inset-1 rounded-full border border-gold/20" />
          <Icon name="gem" className="h-7 w-7" />
          <span className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-full bg-charcoal px-3 py-1.5 text-xs font-medium text-cream opacity-0 shadow-lg transition group-hover:opacity-100 sm:block">
            Ask Zarghoon AI
          </span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Zarghoon AI chat"
          data-testid="chat-panel"
          className={
            embedded
              ? "fixed inset-0 z-[60] flex flex-col overflow-hidden bg-cream"
              : "fixed inset-0 z-[60] flex flex-col overflow-hidden bg-cream shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-gold/25"
          }
        >
          <header className="relative bg-charcoal px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-cream">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 text-gold">
                  <Icon name="gem" className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-serif text-xl leading-tight text-gold">
                    Zarghoon AI
                    {mode === "demo" && (
                      <span data-testid="demo-badge" className="ml-2 rounded-full border border-gold/50 px-2 py-0.5 align-middle font-sans text-[9px] font-semibold uppercase tracking-widest text-gold">
                        Demo
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-cream/70">{takeover ? "A team member is assisting you" : "Your Personal Jewelry Assistant"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void reset("conversation")} aria-label="Start a new conversation" title="New conversation" className="rounded-full p-2 text-cream/70 transition hover:bg-white/10 hover:text-gold">
                  <Icon name="reset" className="h-4 w-4" />
                </button>
                <button type="button" onClick={close} aria-label="Close chat" className="rounded-full p-2 text-cream/70 transition hover:bg-white/10 hover:text-gold">
                  <Icon name="close" className="h-5 w-5" />
                </button>
              </div>
            </div>
          </header>

          {mode === "demo" && (
            <div className="flex items-center justify-between gap-2 border-b border-gold/15 bg-gold/10 px-4 py-1.5 text-[11px] text-charcoal/70" data-testid="demo-banner">
              <span>
                Demo mode — sample DEMO products, not real stock or prices
                {model === "offline_demo" && " · offline demo model (not AI)"}
              </span>
              <button type="button" onClick={() => void reset("demo")} className="shrink-0 font-medium text-gold-dark underline-offset-2 hover:underline">
                Reset demo
              </button>
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite" data-testid="chat-messages">
            <Bubble m={welcome} onAsk={(sku) => void send(`Tell me more about ${sku}`)} linkTarget={linkTarget} />
            {messages.map((m) => (
              <Bubble key={m.id} m={m} onAsk={(sku) => void send(`Tell me more about ${sku}`)} linkTarget={linkTarget} />
            ))}
            {!customerSpoke && !sending && available && (
              <div className="flex flex-wrap gap-2 pt-1" data-testid="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-gold/40 bg-white px-3.5 py-1.5 text-xs text-charcoal transition hover:border-gold hover:bg-gold/10">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-charcoal/50" data-testid="typing-indicator" aria-label="Zarghoon AI is typing">
                <span className="flex gap-1 rounded-2xl rounded-tl-md border border-gold/20 bg-white px-4 py-3">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
              </div>
            )}
            {!available && loaded && (
              <p className="rounded-xl bg-cream-dark px-4 py-3 text-sm text-charcoal/70">Our assistant is unavailable right now. Please visit us or try again later.</p>
            )}
          </div>

          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 border-t border-maroon/20 bg-maroon/5 px-4 py-2 text-xs text-maroon" data-testid="chat-error">
              <span>{error.text}</span>
              {error.retry && (
                <button type="button" onClick={() => void send(error.retry!)} className="shrink-0 font-semibold underline">
                  Retry
                </button>
              )}
            </div>
          )}
          {info && <p className="border-t border-gold/15 bg-cream px-4 py-2 text-xs text-charcoal/70">{info}</p>}
          {debug && (
            <details className="border-t border-dashed border-charcoal/20 bg-white/70 px-4 py-1.5 text-[10px] text-charcoal/60" data-testid="chat-debug">
              <summary className="cursor-pointer">Internal debug (not shown to customers)</summary>
              <p>lead score: {debug.leadScore ?? "—"} ({debug.leadClassification ?? "—"}) · intent: {debug.intent} · lang: {debug.language}</p>
              <p>status: {debug.status} · tools: {debug.toolsUsed.join(", ") || "—"} · model calls: {debug.modelCalls} · handoff: {debug.handoffReason ?? "—"}</p>
            </details>
          )}
          {contactOpen && (
            <ContactForm
              onDone={(message) => {
                setContactOpen(false);
                setInfo(message);
              }}
            />
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-gold/20 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                dir="auto"
                rows={1}
                maxLength={MAX_LENGTH}
                disabled={!available}
                placeholder="Ask in English, اردو or Roman Urdu…"
                aria-label="Your message"
                data-testid="chat-input"
                className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-charcoal/15 bg-cream/50 px-4 py-2.5 text-sm outline-none transition focus:border-gold focus:bg-white focus:ring-2 focus:ring-gold/20 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending || !available}
                aria-label="Send message"
                data-testid="chat-send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-charcoal transition hover:bg-gold-light disabled:opacity-40"
              >
                <Icon name="send" className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-charcoal/40">
              <button type="button" onClick={() => setContactOpen((v) => !v)} className="hover:text-gold-dark">
                {contactOpen ? "Hide contact form" : "Share contact details"}
              </button>
              <span>{input.length > MAX_LENGTH - 100 ? `${input.length}/${MAX_LENGTH}` : "AI can make mistakes; our team confirms every order."}</span>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
