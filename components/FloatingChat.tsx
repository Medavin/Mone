"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * The chat bubble that follows you across the app.
 *
 * ⚠ WHERE THIS IS RENDERED MATTERS. It is a SIBLING of <header>, not a child.
 * The header uses backdrop-blur, and an element with a backdrop-filter becomes
 * the containing block for any `position: fixed` descendant — so a bubble
 * rendered inside the header would be trapped in a 14px-tall strip and
 * clipped. Same class of trap as MedaOne's header clipping its dropdowns.
 *
 * Position and open state live in localStorage and are read in an effect
 * AFTER mount. Reading them during render would make the first client paint
 * disagree with the server's HTML.
 */

type Channel = { id: string; kind: "channel" | "dm"; name: string | null; is_general: boolean };
type Member = { channel_id: string; user_id: string };
type Message = {
  id: string;
  channel_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

const POS_KEY = "mone.chat.pos";
const OPEN_KEY = "mone.chat.open";
const PANEL = { w: 340, h: 460 };
const BUBBLE = 56;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function FloatingChat({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState<Record<string, number>>({});

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
  }, []);

  // ---- mount: restore position, default to bottom-right ------------------
  useEffect(() => {
    const savedOpen = window.localStorage.getItem(OPEN_KEY) === "1";
    const savedPos = window.localStorage.getItem(POS_KEY);
    const w = savedOpen ? PANEL.w : BUBBLE;
    const h = savedOpen ? PANEL.h : BUBBLE;

    let next = { x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 };
    if (savedPos) {
      try {
        const p = JSON.parse(savedPos) as { x: number; y: number };
        if (typeof p.x === "number" && typeof p.y === "number") next = p;
      } catch {
        /* a corrupt value just means we use the default corner */
      }
    }

    setPos(clamp(next.x, next.y, w, h));
    setOpen(savedOpen);
    setMounted(true);
  }, [clamp]);

  // A window resize can leave the bubble off-screen with no way to reach it.
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      const w = open ? PANEL.w : BUBBLE;
      const h = open ? PANEL.h : BUBBLE;
      setPos((p) => clamp(p.x, p.y, w, h));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, open, clamp]);

  // ---- conversations ------------------------------------------------------
  const load = useCallback(async () => {
    const [{ data: ch }, { data: mem }, { data: people }] = await Promise.all([
      supabase.from("collab_channels").select("id, kind, name, is_general").order("created_at"),
      supabase.from("collab_channel_members").select("channel_id, user_id"),
      supabase.from("profiles").select("id, full_name").eq("is_active", true),
    ]);

    setChannels((ch ?? []) as Channel[]);
    setMembers((mem ?? []) as Member[]);
    setNames(
      new Map(
        ((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
      )
    );

    setActiveId((cur) => {
      if (cur) return cur;
      const list = (ch ?? []) as Channel[];
      const mine = (mem ?? []) as Member[];
      const joined = list.filter((c) =>
        mine.some((m) => m.channel_id === c.id && m.user_id === userId)
      );
      return joined.find((c) => c.is_general)?.id ?? joined[0]?.id ?? null;
    });
  }, [supabase, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeId || !open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("collab_messages")
        .select("id, channel_id, author_id, body, created_at")
        .eq("channel_id", activeId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (cancelled) return;
      setMessages(((data ?? []) as Message[]).slice().reverse());
      setUnread((u) => ({ ...u, [activeId]: 0 }));
      await supabase
        .from("collab_channel_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("channel_id", activeId)
        .eq("user_id", userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, open, supabase, userId]);

  // ---- realtime -----------------------------------------------------------
  useEffect(() => {
    const sub = supabase
      .channel("floating_chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "collab_messages" },
        (payload) => {
          const m = payload.new as Message;
          if (open && m.channel_id === activeId) {
            setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
          } else if (m.author_id !== userId) {
            setUnread((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] ?? 0) + 1 }));
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(sub);
    };
  }, [supabase, activeId, open, userId]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView();
  }, [messages.length, open]);

  // ---- drag ---------------------------------------------------------------
  function startDrag(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  }
  function onDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    const w = open ? PANEL.w : BUBBLE;
    const h = open ? PANEL.h : BUBBLE;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy, w, h));
  }
  function endDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }

  function toggle(next: boolean) {
    setOpen(next);
    window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    const w = next ? PANEL.w : BUBBLE;
    const h = next ? PANEL.h : BUBBLE;
    setPos((p) => clamp(p.x, p.y, w, h));
  }

  async function send() {
    const body = draft.trim();
    if (!body || !activeId) return;
    const msg: Message = {
      id: newId(),
      channel_id: activeId,
      author_id: userId,
      body,
      created_at: new Date().toISOString(),
    };
    setDraft("");
    setMessages((prev) => [...prev, msg]);
    const { error } = await supabase
      .from("collab_messages")
      .insert({ ...msg, parent_message_id: null });
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      setDraft(body);
    }
  }

  // ---- derived ------------------------------------------------------------
  const mine = channels.filter((c) =>
    members.some((m) => m.channel_id === c.id && m.user_id === userId)
  );

  const labelOf = (c: Channel) => {
    if (c.kind === "channel") return `# ${c.name ?? "channel"}`;
    const others = members
      .filter((m) => m.channel_id === c.id && m.user_id !== userId)
      .map((m) => names.get(m.user_id) ?? "Someone");
    return others.length ? others.join(", ") : "Just you";
  };

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  // Nothing renders until after mount, so the server HTML and the first client
  // paint cannot disagree about where the bubble sits.
  if (!mounted) return null;

  if (!open) {
    return (
      <button
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onClick={() => !drag.current && toggle(true)}
        aria-label={totalUnread ? `Open chat, ${totalUnread} unread` : "Open chat"}
        className="fixed z-40 flex items-center justify-center rounded-full text-white shadow-lift transition hover:brightness-110"
        style={{
          left: pos.x,
          top: pos.y,
          width: BUBBLE,
          height: BUBBLE,
          background: "linear-gradient(140deg,#7A52C4,#5B3AA0)",
          touchAction: "none",
        }}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <path
            d="M20 13a7 7 0 0 1-9.6 6.5L5 21l1.6-4.6A7 7 0 1 1 20 13z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {totalUnread > 0 && (
          <span className="tnum absolute -right-1 -top-1 rounded-full bg-age90 px-1.5 py-0.5 text-[10px] font-medium">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    );
  }

  return (
    <section
      className="fixed z-40 flex flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-lift"
      style={{ left: pos.x, top: pos.y, width: PANEL.w, height: PANEL.h }}
      aria-label="Chat"
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        className="flex cursor-grab items-center justify-between gap-2 border-b border-hairline px-3 py-2 active:cursor-grabbing"
        style={{ background: "linear-gradient(140deg,#7A52C4,#5B3AA0)", touchAction: "none" }}
      >
        <select
          value={activeId ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          className="max-w-[190px] truncate rounded bg-white/15 px-2 py-1 text-sm text-white outline-none"
        >
          {mine.map((c) => (
            <option key={c.id} value={c.id} className="text-ink">
              {labelOf(c)}
              {unread[c.id] ? ` (${unread[c.id]})` : ""}
            </option>
          ))}
          {mine.length === 0 && <option value="">No conversations yet</option>}
        </select>

        <div className="flex items-center gap-1">
          <Link
            href="/team"
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded px-2 py-1 text-xs text-white/90 hover:bg-white/15"
          >
            Open
          </Link>
          <button
            onClick={() => toggle(false)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Minimise chat"
            className="rounded px-2 py-1 text-sm text-white/90 hover:bg-white/15"
          >
            —
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {mine.length === 0 && (
          <p className="py-8 text-center text-xs text-muted">
            You are not in any conversation yet. Open the Team page to start one.
          </p>
        )}
        {mine.length > 0 && messages.length === 0 && (
          <p className="py-8 text-center text-xs text-muted">Nothing said here yet.</p>
        )}
        {messages.map((m) => {
          const own = m.author_id === userId;
          return (
            <div key={m.id} className={own ? "text-right" : ""}>
              <div
                className={`inline-block max-w-[85%] rounded-card px-3 py-2 text-left text-sm ${
                  own ? "bg-accentSoft" : "bg-canvas"
                }`}
              >
                {!own && (
                  <div className="text-[11px] font-medium text-muted">
                    {names.get(m.author_id ?? "") ?? "Someone"}
                  </div>
                )}
                <p className="whitespace-pre-wrap leading-snug">{m.body}</p>
                <div className="mt-0.5 text-[10px] text-muted">{timeOf(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-hairline p-2">
        <div className="flex gap-2">
          <input
            value={draft}
            disabled={!activeId}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={activeId ? "Message…" : ""}
            className="flex-1 rounded border border-hairline px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={send}
            disabled={!draft.trim() || !activeId}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
