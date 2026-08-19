"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { KIND_META } from "@/lib/notify";

type Note = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  actor_name: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * The bell.
 *
 * ⚠ THE PANEL IS `absolute`, NOT `fixed` — the header uses backdrop-blur,
 * and a backdrop-filter makes that element the containing block for a fixed
 * descendant, which would trap the panel inside the header strip. Third time
 * this trap has come up in this app; it is written down each time.
 *
 * Refreshes on a realtime insert AND when the window regains focus. Realtime
 * alone is not enough: a laptop that has been asleep reconnects without
 * replaying what it missed, so the first thing somebody does after opening
 * the lid would show a stale count.
 */
const ago = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function NotificationBell({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, link_url, actor_name, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setNotes((data ?? []) as Note[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sub = supabase
      .channel("notifications_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => void load()
      )
      .subscribe();

    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);

    return () => {
      void supabase.removeChannel(sub);
      window.removeEventListener("focus", onFocus);
    };
  }, [supabase, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = notes.filter((n) => !n.read_at).length;

  async function markRead(id: number) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  async function markAll() {
    const stamp = new Date().toISOString();
    const ids = notes.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    setNotes((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    await supabase.from("notifications").update({ read_at: stamp }).in("id", ids);
  }

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        className="relative rounded-full px-2 py-1.5 text-muted transition hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
          <path
            d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9zM10 18.5a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="tnum absolute -right-0.5 -top-0.5 rounded-full bg-age90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-card border border-hairline bg-surface shadow-lift">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-accent underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                Nothing yet. Tasks, flags and announcements land here.
              </p>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {notes.map((n) => {
                  const meta = KIND_META[n.kind] ?? { icon: "•", label: n.kind };
                  const inner = (
                    <div className="flex gap-3">
                      <span
                        className={`mt-0.5 w-4 text-center text-sm ${
                          n.read_at ? "text-muted" : "text-accent"
                        }`}
                        aria-hidden="true"
                      >
                        {meta.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${n.read_at ? "text-muted" : "font-medium"}`}>
                          {n.title}
                        </div>
                        {n.body && <div className="truncate text-xs text-muted">{n.body}</div>}
                        <div className="text-[11px] text-muted">
                          {[n.actor_name, ago(n.created_at)].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  );

                  return (
                    <li key={n.id} className={n.read_at ? "" : "bg-accentSoft/40"}>
                      {n.link_url ? (
                        <Link
                          href={n.link_url}
                          onClick={() => {
                            void markRead(n.id);
                            setOpen(false);
                          }}
                          className="block px-4 py-3 hover:bg-canvas"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          onClick={() => void markRead(n.id)}
                          className="block w-full px-4 py-3 text-left hover:bg-canvas"
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
