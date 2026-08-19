"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { humanSize, signedUrl, uploadFile } from "@/lib/storage";
import type { Profile } from "@/lib/types";

type Person = { id: string; full_name: string; role: string };

type Channel = {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  topic: string | null;
  is_general: boolean;
  created_by: string | null;
};

type Member = { channel_id: string; user_id: string; last_read_at: string };

type Message = {
  id: string;
  channel_id: string;
  author_id: string | null;
  body: string;
  parent_message_id: string | null;
  created_at: string;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_kind?: string | null;
};

/** Client-generated ids mean an insert never needs .select(), so a write can
 *  never be blocked by a read policy. */
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

export default function TeamChat({ me, people }: { me: Profile; people: Person[] }) {
  const supabase = useMemo(() => createClient(), []);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<"channel" | "dm" | null>(null);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);

  // ---- loading the sidebar ------------------------------------------------
  const loadChannels = useCallback(async () => {
    const [{ data: ch, error: chErr }, { data: mem }] = await Promise.all([
      supabase.from("collab_channels").select("*").order("created_at"),
      supabase.from("collab_channel_members").select("channel_id, user_id, last_read_at"),
    ]);

    if (chErr) {
      setError(chErr.message);
      setLoading(false);
      return;
    }

    const list = (ch ?? []) as Channel[];
    const mine = (mem ?? []) as Member[];
    setChannels(list);
    setMembers(mine);

    // Join #general the first time somebody opens this page. Everyone can
    // SEE it (the policy allows is_general) but membership is what makes
    // messages readable, so it has to be a real row.
    const general = list.find((c) => c.is_general);
    const inGeneral = mine.some((m) => m.channel_id === general?.id && m.user_id === me.id);
    if (general && !inGeneral) {
      await supabase
        .from("collab_channel_members")
        .insert({ channel_id: general.id, user_id: me.id });
      const { data: mem2 } = await supabase
        .from("collab_channel_members")
        .select("channel_id, user_id, last_read_at");
      setMembers((mem2 ?? []) as Member[]);
    }

    setLoading(false);
    setActiveId((cur) => cur ?? general?.id ?? list[0]?.id ?? null);
  }, [supabase, me.id]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  // ---- messages for the open conversation --------------------------------
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    (async () => {
      const { data, error: msgErr } = await supabase
        .from("collab_messages")
        .select("*")
        .eq("channel_id", activeId)
        .order("created_at");
      if (cancelled) return;
      if (msgErr) setError(msgErr.message);
      else setMessages((data ?? []) as Message[]);

      // Opening a conversation is what marks it read.
      await supabase
        .from("collab_channel_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("channel_id", activeId)
        .eq("user_id", me.id);
      setUnread((u) => ({ ...u, [activeId]: 0 }));
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, supabase, me.id]);

  // ---- realtime ----------------------------------------------------------
  useEffect(() => {
    const sub = supabase
      .channel("collab_messages_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "collab_messages" },
        (payload) => {
          const m = payload.new as Message;
          if (m.channel_id === activeId) {
            // The sender has already appended optimistically, so dedupe by id.
            setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
          } else if (m.author_id !== me.id) {
            setUnread((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] ?? 0) + 1 }));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(sub);
    };
  }, [supabase, activeId, me.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeId]);

  // ---- actions -----------------------------------------------------------
  /** Attach a file to the open conversation. */
  async function attach(file: File | null | undefined) {
    if (!file || !activeId) return;
    setAttaching(true);
    setError(null);

    const up = await uploadFile(supabase, file, `chat/${activeId}`);
    if ("error" in up) {
      setAttaching(false);
      setError(up.error);
      return;
    }

    // `body` is NOT NULL, and an empty message would be possible if that
    // were loosened. So a file-only message carries its own name as the body.
    const msg: Message = {
      id: newId(),
      channel_id: activeId,
      author_id: me.id,
      body: draft.trim() || file.name,
      parent_message_id: null,
      created_at: new Date().toISOString(),
      file_path: up.path,
      file_name: file.name,
      file_size: file.size,
      file_kind: up.kind,
    };

    setDraft("");
    setMessages((prev) => [...prev, msg]);

    const { error: sendErr } = await supabase.from("collab_messages").insert(msg);
    setAttaching(false);
    if (sendErr) {
      setError(`File not sent: ${sendErr.message}`);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      await supabase.storage.from("mone-files").remove([up.path]);
    }
  }

  async function openAttachment(path: string) {
    const url = await signedUrl(supabase, path);
    if (url) window.open(url, "_blank", "noopener");
    else setError("That attachment could not be opened.");
  }

  async function send() {
    const body = draft.trim();
    if (!body || !activeId) return;

    const msg: Message = {
      id: newId(),
      channel_id: activeId,
      author_id: me.id,
      body,
      parent_message_id: replyTo?.id ?? null,
      created_at: new Date().toISOString(),
    };

    setDraft("");
    setReplyTo(null);
    setMessages((prev) => [...prev, msg]);

    const { error: sendErr } = await supabase.from("collab_messages").insert(msg);
    if (sendErr) {
      setError(`Message not sent: ${sendErr.message}`);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      setDraft(body);
    }
  }

  async function createChannel() {
    const name = newName.trim();
    if (!name) return;

    const id = newId();
    const { error: chErr } = await supabase
      .from("collab_channels")
      .insert({ id, kind: "channel", name, created_by: me.id });
    if (chErr) return setError(`Could not create the channel: ${chErr.message}`);

    const rows = Array.from(new Set([me.id, ...newMembers])).map((user_id) => ({
      channel_id: id,
      user_id,
    }));
    const { error: memErr } = await supabase.from("collab_channel_members").insert(rows);
    if (memErr) setError(`Channel created, but adding people failed: ${memErr.message}`);

    setComposing(null);
    setNewName("");
    setNewMembers([]);
    await loadChannels();
    setActiveId(id);
  }

  async function startDm(otherId: string) {
    // An existing DM is one whose membership is exactly the two of us.
    const existing = channels.find((c) => {
      if (c.kind !== "dm") return false;
      const ids = members.filter((m) => m.channel_id === c.id).map((m) => m.user_id);
      return ids.length === 2 && ids.includes(me.id) && ids.includes(otherId);
    });
    if (existing) {
      setComposing(null);
      setActiveId(existing.id);
      return;
    }

    const id = newId();
    const { error: chErr } = await supabase
      .from("collab_channels")
      .insert({ id, kind: "dm", created_by: me.id });
    if (chErr) return setError(`Could not start that conversation: ${chErr.message}`);

    const { error: memErr } = await supabase.from("collab_channel_members").insert([
      { channel_id: id, user_id: me.id },
      { channel_id: id, user_id: otherId },
    ]);
    if (memErr) setError(`Conversation started, but adding the other person failed: ${memErr.message}`);

    setComposing(null);
    await loadChannels();
    setActiveId(id);
  }

  // ---- derived -----------------------------------------------------------
  const myChannelIds = new Set(
    members.filter((m) => m.user_id === me.id).map((m) => m.channel_id)
  );

  const visible = channels.filter((c) => myChannelIds.has(c.id) || c.is_general);
  const rooms = visible.filter((c) => c.kind === "channel");
  const dms = visible.filter((c) => c.kind === "dm");

  const dmLabel = (c: Channel) => {
    const others = members
      .filter((m) => m.channel_id === c.id && m.user_id !== me.id)
      .map((m) => nameOf.get(m.user_id) ?? "Someone");
    return others.length ? others.join(", ") : "Just you";
  };

  const active = channels.find((c) => c.id === activeId) ?? null;
  const activeLabel = active
    ? active.kind === "dm"
      ? dmLabel(active)
      : `#${active.name ?? "channel"}`
    : "";

  const top = messages.filter((m) => !m.parent_message_id);
  const repliesOf = (id: string) => messages.filter((m) => m.parent_message_id === id);

  const sideItem = (id: string, label: string, sub?: string) => (
    <button
      key={id}
      onClick={() => setActiveId(id)}
      className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm ${
        activeId === id ? "bg-accent/10 font-medium text-ink" : "text-muted hover:bg-canvas"
      }`}
    >
      <span className="truncate">
        {label}
        {sub && <span className="ml-2 text-xs text-muted">{sub}</span>}
      </span>
      {(unread[id] ?? 0) > 0 && activeId !== id && (
        <span className="tnum rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">
          {unread[id]}
        </span>
      )}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted">
            Channels for the work, direct messages for the rest. Replies thread under the
            message they answer.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setComposing(composing === "channel" ? null : "channel")}
            className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white"
          >
            New channel
          </button>
          <button
            onClick={() => setComposing(composing === "dm" ? null : "dm")}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white"
          >
            New message
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {composing === "channel" && (
        <div className="mt-4 rounded-card border border-hairline bg-surface shadow-card p-5">
          <h2 className="text-sm font-medium">New channel</h2>
          <input
            className="mt-3 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="collections, month-end, rapid-rehab…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted">
            Who is in it
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {people
              .filter((p) => p.id !== me.id)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newMembers.includes(p.id)}
                    onChange={(e) =>
                      setNewMembers(
                        e.target.checked
                          ? [...newMembers, p.id]
                          : newMembers.filter((x) => x !== p.id)
                      )
                    }
                  />
                  {p.full_name}
                </label>
              ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Members are set here. There is no way to add someone to a channel afterwards yet —
            if that matters, say so and I will build it.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={createChannel}
              disabled={!newName.trim()}
              className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Create
            </button>
            <button onClick={() => setComposing(null)} className="text-sm text-muted underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {composing === "dm" && (
        <div className="mt-4 rounded-card border border-hairline bg-surface shadow-card p-5">
          <h2 className="text-sm font-medium">Message someone</h2>
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {people
              .filter((p) => p.id !== me.id)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => startDm(p.id)}
                  className="rounded px-3 py-2 text-left text-sm hover:bg-canvas"
                >
                  {p.full_name}
                  <span className="ml-2 text-xs text-muted">{p.role}</span>
                </button>
              ))}
          </div>
          {people.length <= 1 && (
            <p className="mt-3 text-sm text-muted">
              Nobody else has a login yet. Add people under Settings → Employees and link them
              to a login.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]">
        {/* sidebar */}
        <aside className="space-y-5">
          <div>
            <p className="px-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              Channels
            </p>
            <div className="mt-1 space-y-0.5">
              {rooms.map((c) => sideItem(c.id, `# ${c.name ?? "channel"}`))}
              {rooms.length === 0 && !loading && (
                <p className="px-3 py-2 text-sm text-muted">None yet.</p>
              )}
            </div>
          </div>

          <div>
            <p className="px-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              Direct
            </p>
            <div className="mt-1 space-y-0.5">
              {dms.map((c) => sideItem(c.id, dmLabel(c)))}
              {dms.length === 0 && !loading && (
                <p className="px-3 py-2 text-sm text-muted">No conversations yet.</p>
              )}
            </div>
          </div>
        </aside>

        {/* conversation */}
        <section className="flex min-h-[28rem] flex-col rounded-card border border-hairline bg-surface shadow-card">
          <div className="border-b border-hairline px-5 py-3">
            <div className="text-sm font-medium">{activeLabel || "—"}</div>
            {active?.topic && <div className="text-xs text-muted">{active.topic}</div>}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {loading && <p className="text-sm text-muted">Loading…</p>}

            {!loading && top.length === 0 && (
              <p className="py-10 text-center text-sm text-muted">
                Nothing here yet. Whatever gets said in this conversation stays with it — this
                is the record, not a chat window that scrolls away.
              </p>
            )}

            {top.map((m, i) => {
              const prev = top[i - 1];
              const newDay =
                !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              const replies = repliesOf(m.id);
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-3 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
                      {dayOf(m.created_at)}
                    </div>
                  )}
                  <div className="group">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {m.author_id === me.id ? "You" : nameOf.get(m.author_id ?? "") ?? "Someone"}
                      </span>
                      <span className="text-xs text-muted">{timeOf(m.created_at)}</span>
                      <button
                        onClick={() => setReplyTo(m)}
                        className="text-xs text-muted underline opacity-0 transition group-hover:opacity-100"
                      >
                        reply
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                    {m.file_path && (
                      <button
                        onClick={() => openAttachment(m.file_path as string)}
                        className="mt-1 inline-flex items-center gap-2 rounded border border-hairline px-2 py-1 text-xs text-accent hover:bg-canvas"
                      >
                        <span aria-hidden="true">📎</span>
                        {m.file_name}
                        {m.file_size ? (
                          <span className="text-muted">{humanSize(m.file_size)}</span>
                        ) : null}
                      </button>
                    )}
                  </div>

                  {replies.length > 0 && (
                    <div className="mt-2 space-y-2 border-l-2 border-hairline pl-4">
                      {replies.map((r) => (
                        <div key={r.id}>
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">
                              {r.author_id === me.id
                                ? "You"
                                : nameOf.get(r.author_id ?? "") ?? "Someone"}
                            </span>
                            <span className="text-xs text-muted">{timeOf(r.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-hairline px-5 py-3">
            {replyTo && (
              <div className="mb-2 flex items-center justify-between rounded bg-canvas px-3 py-2 text-xs">
                <span className="truncate text-muted">
                  Replying to {replyTo.author_id === me.id ? "yourself" : nameOf.get(replyTo.author_id ?? "")}
                  : {replyTo.body.slice(0, 60)}
                  {replyTo.body.length > 60 ? "…" : ""}
                </span>
                <button onClick={() => setReplyTo(null)} className="ml-3 text-muted underline">
                  cancel
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={draft}
                disabled={!activeId}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={activeId ? "Write a message — Enter to send, Shift+Enter for a new line" : ""}
                className="flex-1 resize-none rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <label
                className={`self-end rounded border border-hairline px-3 py-2 text-sm ${
                  activeId ? "cursor-pointer text-muted hover:text-ink" : "text-muted opacity-40"
                }`}
                title="Attach a file"
              >
                {attaching ? "…" : "📎"}
                <input
                  type="file"
                  className="hidden"
                  disabled={!activeId || attaching}
                  onChange={(e) => {
                    attach(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={send}
                disabled={!draft.trim() || !activeId}
                className="self-end rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
