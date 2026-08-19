"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { businessToday, duration, localTime } from "@/lib/businessDate";

type Shift = {
  id: number;
  business_date: string;
  punched_in_at: string;
  punched_out_at: string | null;
  work_location: "office" | "home";
};

type Event = {
  id: number;
  // Two kinds of break, because they are not the same thing to whoever is
  // billing: "break" is the employee's own, "outage" is a network or system
  // failure they did not choose. Meetings count as production.
  kind: "break" | "outage" | "meeting";
  started_at: string;
  ended_at: string | null;
  note: string | null;
};

type Span = { id: number; clinic_id: number; started_at: string; ended_at: string | null };

export default function ShiftClock({
  userId,
  clinics = [],
}: {
  userId: string;
  clinics?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [shift, setShift] = useState<Shift | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [pickClinic, setPickClinic] = useState(false);
  // Which event is having its note written, and the text so far.
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const today = businessToday();

  // Re-render once a minute so the elapsed time is not stale.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase
        .from("work_shifts")
        .select("id, business_date, punched_in_at, punched_out_at, work_location")
        .eq("user_id", userId)
        .eq("business_date", today)
        .maybeSingle();

      if (cancelled) return;
      setShift((s as Shift) ?? null);

      if (s) {
        const [{ data: e }, { data: sp }] = await Promise.all([
          supabase
            .from("shift_events")
            .select("id, kind, started_at, ended_at, note")
            .eq("shift_id", (s as Shift).id)
            .order("started_at"),
          supabase
            .from("shift_clinic_spans")
            .select("id, clinic_id, started_at, ended_at")
            .eq("shift_id", (s as Shift).id)
            .order("started_at"),
        ]);
        if (!cancelled) {
          setEvents((e as Event[]) ?? []);
          setSpans((sp as Span[]) ?? []);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, today]);

  const openEvent = events.find((e) => !e.ended_at) ?? null;
  const openSpan = spans.find((s) => !s.ended_at) ?? null;
  const onShift = !!shift && !shift.punched_out_at;

  async function act(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setError(`${label}: ${error.message}`);
      return false;
    }
    router.refresh();
    return true;
  }

  async function punchIn(location: "office" | "home") {
    const { data, error } = await supabase
      .from("work_shifts")
      .insert({ user_id: userId, business_date: today, work_location: location })
      .select("id, business_date, punched_in_at, punched_out_at, work_location")
      .single();

    if (error) {
      setError(`Punch in: ${error.message}`);
      return;
    }
    setShift(data as Shift);
    setEvents([]);
    router.refresh();
  }

  async function punchOut() {
    if (!shift) return;
    // Close anything still running, or the day's break total is wrong.
    const stamp = new Date().toISOString();
    if (openEvent) {
      await supabase.from("shift_events").update({ ended_at: stamp }).eq("id", openEvent.id);
    }
    // The clinic span too, or its minutes keep running after the person goes home.
    const openSpan = spans.find((s) => !s.ended_at);
    if (openSpan) {
      await supabase.from("shift_clinic_spans").update({ ended_at: stamp }).eq("id", openSpan.id);
    }
    const ok = await act("Punch out", () =>
      supabase.from("work_shifts").update({ punched_out_at: new Date().toISOString() }).eq("id", shift.id)
    );
    if (ok) setShift({ ...shift, punched_out_at: new Date().toISOString() });
  }

  /** Close any open clinic span, then open one on the chosen clinic. */
  async function switchClinic(clinicId: number) {
    if (!shift) return;
    setPickClinic(false);
    const stamp = new Date().toISOString();
    const open = spans.find((s) => !s.ended_at);

    if (open) {
      if (open.clinic_id === clinicId) return;
      await supabase.from("shift_clinic_spans").update({ ended_at: stamp }).eq("id", open.id);
    }

    const { data, error } = await supabase
      .from("shift_clinic_spans")
      .insert({ shift_id: shift.id, clinic_id: clinicId })
      .select("id, clinic_id, started_at, ended_at")
      .single();

    if (error) {
      setError(`Switch clinic: ${error.message}`);
      return;
    }
    setSpans([
      ...spans.map((s) => (s.id === open?.id ? { ...s, ended_at: stamp } : s)),
      data as Span,
    ]);
    router.refresh();
  }

  async function endClinic() {
    if (!openSpan) return;
    setPickClinic(false);
    const stamp = new Date().toISOString();
    const ok = await act("Stop clinic", () =>
      supabase.from("shift_clinic_spans").update({ ended_at: stamp }).eq("id", openSpan.id)
    );
    if (ok) setSpans(spans.map((s) => (s.id === openSpan.id ? { ...s, ended_at: stamp } : s)));
  }

  async function startEvent(kind: "break" | "outage" | "meeting") {
    if (!shift) return;
    const { data, error } = await supabase
      .from("shift_events")
      .insert({ shift_id: shift.id, kind })
      .select("id, kind, started_at, ended_at, note")
      .single();
    if (error) {
      setError(`Start ${kind}: ${error.message}`);
      return;
    }
    setEvents([...events, data as Event]);

    // THE TIMER STARTS FIRST, THEN THE NOTE IS ASKED FOR. Making somebody
    // type before the clock starts would under-record every outage by however
    // long they spent describing it — and an outage is exactly when typing is
    // hardest. A meeting or an outage without a note is still valid; the note
    // just makes it defensible later.
    if (kind === "outage" || kind === "meeting") {
      setNoteFor((data as Event).id);
      setNoteText("");
    }
  }

  async function saveNote(eventId: number) {
    const text = noteText.trim();
    setNoteFor(null);
    if (!text) return;
    const { error } = await supabase
      .from("shift_events")
      .update({ note: text })
      .eq("id", eventId);
    if (error) {
      setError(`Saving note: ${error.message}`);
      return;
    }
    setEvents(events.map((e) => (e.id === eventId ? { ...e, note: text } : e)));
    router.refresh();
  }

  async function endEvent() {
    if (!openEvent) return;
    const stamp = new Date().toISOString();
    const ok = await act("Resume", () =>
      supabase.from("shift_events").update({ ended_at: stamp }).eq("id", openEvent.id)
    );
    if (ok) setEvents(events.map((e) => (e.id === openEvent.id ? { ...e, ended_at: stamp } : e)));
  }

  async function switchLocation() {
    if (!shift) return;
    const next = shift.work_location === "office" ? "home" : "office";
    const ok = await act("Change location", () =>
      supabase.from("work_shifts").update({ work_location: next }).eq("id", shift.id)
    );
    if (ok) setShift({ ...shift, work_location: next });
  }

  const btn =
    "rounded border border-hairline px-2.5 py-1 text-xs transition hover:border-ink hover:bg-canvas disabled:opacity-40";

  if (!shift) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden text-xs text-muted sm:inline">Punch in:</span>
        <button onClick={() => punchIn("office")} disabled={busy} className={btn} title="Working from the office">
          🏢 Office
        </button>
        <button onClick={() => punchIn("home")} disabled={busy} className={btn} title="Working from home">
          🏠 Home
        </button>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    );
  }

  if (!onShift) {
    return (
      <span className="text-xs text-muted">
        Out at {localTime(shift.punched_out_at!)} · {duration(shift.punched_in_at, shift.punched_out_at)}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={switchLocation}
        disabled={busy}
        className="rounded bg-canvas px-2 py-1 text-xs text-muted hover:text-ink"
        title="Switch between office and home"
      >
        {shift.work_location === "office" ? "🏢 Office" : "🏠 Home"}
      </button>

      <span className="tnum text-xs text-muted" title={`In at ${localTime(shift.punched_in_at)}`}>
        {duration(shift.punched_in_at)}
        {tick < 0 ? "" : ""}
      </span>

      {/* Which clinic this time belongs to. Start one, switch during the day. */}
      {clinics.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setPickClinic((v) => !v)}
            disabled={busy}
            className={openSpan ? `${btn} border-accent text-accent` : btn}
            title="Which clinic are you working on?"
          >
            {openSpan
              ? clinics.find((c) => c.id === openSpan.clinic_id)?.name ?? "Clinic"
              : "+ Clinic"}
          </button>
          {pickClinic && (
            <div className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-card border border-hairline bg-surface p-1 shadow-lift">
              {openSpan && (
                <button
                  onClick={endClinic}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-muted hover:bg-canvas"
                >
                  Stop tracking a clinic
                </button>
              )}
              {clinics.map((c) => (
                <button
                  key={c.id}
                  onClick={() => switchClinic(c.id)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-canvas ${
                    openSpan?.clinic_id === c.id ? "font-medium text-accent" : ""
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The note box, shown after the event has already started. */}
      {noteFor !== null && (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveNote(noteFor);
              if (e.key === "Escape") setNoteFor(null);
            }}
            onBlur={() => saveNote(noteFor)}
            placeholder={
              events.find((e) => e.id === noteFor)?.kind === "outage"
                ? "What went down?"
                : "What is the meeting?"
            }
            className="w-52 rounded border border-warn bg-surface px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => saveNote(noteFor)}
            className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Save
          </button>
        </span>
      )}

      {openEvent ? (
        <button
          onClick={endEvent}
          disabled={busy}
          className={`${btn} border-warn text-warn`}
          title={openEvent.note ?? undefined}
        >
          {openEvent.kind === "meeting" ? "👥" : openEvent.kind === "outage" ? "⚡" : "☕"} Resume ·{" "}
          {duration(openEvent.started_at)}
        </button>
      ) : (
        <>
          <button
            onClick={() => startEvent("break")}
            disabled={busy}
            className={btn}
            title="Personal break — not billable by default"
          >
            ☕
          </button>
          <button
            onClick={() => startEvent("outage")}
            disabled={busy}
            className={btn}
            title="Unavoidable — network outage or system failure. Recorded separately from a personal break."
          >
            ⚡
          </button>
          <button
            onClick={() => startEvent("meeting")}
            disabled={busy}
            className={btn}
            title="In a meeting — counts as production"
          >
            👥
          </button>
        </>
      )}

      {openEvent && openEvent.kind !== "break" && noteFor === null && (
        <button
          onClick={() => {
            setNoteFor(openEvent.id);
            setNoteText(openEvent.note ?? "");
          }}
          className="rounded px-1.5 py-1 text-xs text-muted hover:text-ink"
          title={openEvent.note ? `Note: ${openEvent.note}` : "Add a note"}
        >
          {openEvent.note ? "✎" : "+ note"}
        </button>
      )}

      <button onClick={punchOut} disabled={busy} className={btn}>
        Punch out
      </button>

      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
