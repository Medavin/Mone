"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Clinic } from "@/lib/types";

const KINDS = ["event", "meeting", "deadline", "visit", "training", "other"] as const;

export default function AddEventForm({
  userId,
  clinics,
  defaultDate,
}: {
  userId: string;
  clinics: Clinic[];
  defaultDate: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [startsOn, setStartsOn] = useState(defaultDate);
  const [endsOn, setEndsOn] = useState("");
  const [startTime, setStartTime] = useState("");
  const [kind, setKind] = useState<string>("event");
  const [visibility, setVisibility] = useState("shared");
  const [clinicId, setClinicId] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    if (!title.trim() || !startsOn) return;
    setBusy(true);
    setMsg(null);

    const { error } = await supabase.from("calendar_events").insert({
      title: title.trim(),
      detail: detail.trim() || null,
      starts_on: startsOn,
      ends_on: endsOn || null,
      start_time: startTime.trim() || null,
      kind,
      visibility,
      clinic_id: clinicId ? Number(clinicId) : null,
      created_by: userId,
    });

    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setTitle("");
    setDetail("");
    setStartTime("");
    setEndsOn("");
    setMsg({ ok: true, text: "Added." });
    router.refresh();
  }

  const field =
    "rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="mt-3 space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What is it?"
        className={`w-full ${field}`}
      />

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted">Starts</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={`mt-1 w-full ${field}`} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Ends (optional)</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={`mt-1 w-full ${field}`} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Time (optional)</span>
          <input
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="9:00 AM"
            className={`mt-1 w-full ${field}`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`mt-1 w-full ${field}`}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Clinic (optional)</span>
          <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} className={`mt-1 w-full ${field}`}>
            <option value="">—</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Who sees it</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={`mt-1 w-full ${field}`}>
            <option value="shared">Everyone</option>
            <option value="personal">Only me</option>
          </select>
        </label>
      </div>

      <input
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Note (optional)"
        className={`w-full ${field}`}
      />

      <button
        onClick={add}
        disabled={busy || !title.trim() || !startsOn}
        className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {busy ? "Adding…" : "Add event"}
      </button>

      {msg && (
        <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>
      )}
    </div>
  );
}
