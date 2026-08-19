"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyMany } from "@/lib/notify";

export type Announcement = {
  id: number;
  title: string;
  body: string;
  category: string;
  status: string;
  pinned: boolean;
  audience: string[];
  author_id: string | null;
  published_at: string | null;
  created_at: string;
};

const CATEGORIES = ["news", "policy", "alert", "celebration"] as const;

const TONE: Record<string, string> = {
  news: "border-l-accent",
  policy: "border-l-muted",
  alert: "border-l-bad",
  celebration: "border-l-good",
};

const LABEL: Record<string, string> = {
  news: "News",
  policy: "Policy",
  alert: "Alert",
  celebration: "Celebration",
};

export default function NewsClient({
  me,
  isAdmin,
  items,
  readIds,
  people,
}: {
  me: string;
  isAdmin: boolean;
  items: Announcement[];
  readIds: number[];
  people: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "news", pinned: false });

  const nameOf = new Map(people.map((p) => [p.id, p.full_name]));
  const read = new Set(readIds);

  async function markRead(id: number) {
    if (read.has(id)) return;
    await supabase.from("announcement_reads").insert({ announcement_id: id, user_id: me });
    router.refresh();
  }

  async function publish(status: "draft" | "published") {
    if (!form.title.trim() || !form.body.trim()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("announcements").insert({
      title: form.title.trim(),
      body: form.body.trim(),
      category: form.category,
      pinned: form.pinned,
      status,
      author_id: me,
      published_at: status === "published" ? new Date().toISOString() : null,
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    // Everyone but the author. Publishing a policy nobody is told about is
    // the exact failure this module was built to fix.
    if (status === "published") {
      await notifyMany(
        supabase,
        people.map((p) => p.id).filter((id) => id !== me),
        {
          kind: "announcement_published",
          title: form.title.trim(),
          body: form.category === "policy" ? "New policy" : undefined,
          link: "/news",
          actorName: people.find((p) => p.id === me)?.full_name,
        }
      );
    }

    setForm({ title: "", body: "", category: "news", pinned: false });
    setComposing(false);
    router.refresh();
  }

  async function setStatus(id: number, status: string) {
    setBusy(true);
    await supabase
      .from("announcements")
      .update({
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusy(false);
    router.refresh();
  }

  const field =
    "rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";
  const thL = "font-mono text-[11px] uppercase tracking-wider text-muted";

  const shown = items.filter((i) => filter === "all" || i.category === filter);
  const pinned = shown.filter((i) => i.pinned && i.status === "published");
  const rest = shown.filter((i) => !i.pinned || i.status !== "published");
  const unreadCount = items.filter((i) => i.status === "published" && !read.has(i.id)).length;

  const card = (a: Announcement) => (
    <article
      key={a.id}
      onMouseEnter={() => a.status === "published" && markRead(a.id)}
      className={`rounded border border-hairline border-l-[3px] bg-white p-4 ${TONE[a.category]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={thL}>{LABEL[a.category]}</span>
            {a.pinned && <span className="text-xs text-warn">pinned</span>}
            {a.status !== "published" && (
              <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">{a.status}</span>
            )}
            {a.status === "published" && !read.has(a.id) && (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">new</span>
            )}
          </div>
          <h3 className="mt-1 font-medium">{a.title}</h3>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {a.status !== "published" && (
              <button onClick={() => setStatus(a.id, "published")} disabled={busy} className="text-xs text-accent hover:underline">
                publish
              </button>
            )}
            {a.status === "published" && (
              <button onClick={() => setStatus(a.id, "withdrawn")} disabled={busy} className="text-xs text-muted hover:text-bad hover:underline">
                withdraw
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>

      <div className="mt-3 text-xs text-muted">
        {nameOf.get(a.author_id ?? "") ?? "Someone"} ·{" "}
        {(a.published_at ?? a.created_at).slice(0, 10)}
      </div>
    </article>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {["all", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded px-2.5 py-1 text-xs ${
                filter === c ? "bg-accent text-white" : "border border-hairline text-muted hover:text-ink"
              }`}
            >
              {c === "all" ? "All" : LABEL[c]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && <span className="text-xs text-accent">{unreadCount} unread</span>}
          {isAdmin && (
            <button
              onClick={() => setComposing(!composing)}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white"
            >
              {composing ? "Cancel" : "Post something"}
            </button>
          )}
        </div>
      </div>

      {composing && isAdmin && (
        <section className="mt-6 rounded-card border border-hairline bg-surface shadow-card p-4">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Headline"
            className={`w-full ${field}`}
          />
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="What do people need to know?"
            rows={5}
            className={`mt-3 w-full ${field}`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={field}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {LABEL[c]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              />
              Pin to the top
            </label>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => publish("draft")}
                disabled={busy || !form.title.trim() || !form.body.trim()}
                className="rounded border border-hairline px-3 py-2 text-sm disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                onClick={() => publish("published")}
                disabled={busy || !form.title.trim() || !form.body.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>
          {msg && <p className="mt-2 text-sm text-bad">{msg}</p>}
          <p className="mt-2 text-xs text-muted">
            Policies are the ones people come back to months later; news is read once. Choosing the
            right category is what makes them findable.
          </p>
        </section>
      )}

      <div className="mt-6 space-y-3">
        {pinned.map(card)}
        {pinned.length > 0 && rest.length > 0 && <div className="h-2" />}
        {rest.map(card)}
        {shown.length === 0 && (
          <p className="rounded border border-dashed border-hairline px-4 py-10 text-center text-sm text-muted">
            Nothing posted yet.
          </p>
        )}
      </div>
    </div>
  );
}
