"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Change which CAM owns a client.
 *
 * Never an overwrite: the current assignment is CLOSED (effective_to set)
 * and a new one opened from today, so a report for an earlier month still
 * shows who owned the client then. Michelle's spec: "preserve assignment
 * history when a client changes CAM".
 */
export function CamPicker({
  clinicId,
  current,
  currentAssignmentId,
  parties,
}: {
  clinicId: number;
  current: string | null;
  currentAssignmentId: number | null;
  parties: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(partyId: string) {
    if (!partyId) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    if (currentAssignmentId) {
      // Closing on the same day it was opened would fail the date check,
      // so a same-day correction replaces the row instead.
      const { data: row } = await supabase
        .from("cam_assignments").select("effective_from").eq("id", currentAssignmentId).maybeSingle();
      const opened = (row?.effective_from as string | undefined) ?? "";
      const res = opened >= today
        ? await supabase.from("cam_assignments").delete().eq("id", currentAssignmentId)
        : await supabase.from("cam_assignments").update({ effective_to: today }).eq("id", currentAssignmentId);
      if (res.error) {
        setErr(res.error.message);
        setBusy(false);
        return;
      }
    }

    const { error } = await supabase.from("cam_assignments").insert({
      clinic_id: clinicId,
      party_id: Number(partyId),
      effective_from: today,
    });
    if (error) setErr(error.message);
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        disabled={busy}
        value=""
        onChange={(e) => change(e.target.value)}
        className="rounded border border-hairline bg-surface px-1 py-0.5 text-xs text-muted"
        title="Assign this client to another CAM. The old assignment is kept in the history."
      >
        <option value="">{current ? "change…" : "set CAM…"}</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {err && <span className="text-xs text-bad">{err}</span>}
    </span>
  );
}

/**
 * The add-on CPT list. Kept on this page, beside the card it drives, so
 * the person reading the card can see exactly which codes it counts.
 */
export function AddonEditor({ codes }: { codes: { code: string; label: string | null }[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const c = code.trim().toUpperCase();
    if (!/^[0-9A-Z]{4,6}$/.test(c)) {
      setErr("A CPT or HCPCS code is 5 characters, e.g. 97140.");
      return;
    }
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("addon_codes")
      .upsert({ code: c, label: label.trim() || null, is_active: true });
    if (error) {
      setErr(
        error.message.includes("addon_codes")
          ? "The add-on list does not exist yet — run migration 030 first."
          : error.message
      );
      return;
    }
    setCode("");
    setLabel("");
    router.refresh();
  }

  async function remove(c: string) {
    const supabase = createClient();
    await supabase.from("addon_codes").update({ is_active: false }).eq("code", c);
    router.refresh();
  }

  return (
    <div className="mt-3 rounded border border-dashed border-hairline p-3 text-xs">
      <div className="mb-2 font-medium text-ink">Add-on codes counted ({codes.length})</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {codes.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1 rounded-full bg-accentSoft px-2 py-0.5">
            <span className="tnum">{c.code}</span>
            {c.label && <span className="text-muted">{c.label}</span>}
            <button onClick={() => remove(c.code)} className="text-muted hover:text-bad" title="Stop counting this code">
              ×
            </button>
          </span>
        ))}
        {codes.length === 0 && <span className="text-muted">None yet — Momentum to approve the list.</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code, e.g. 97140"
          className="w-32 rounded border border-hairline px-2 py-1"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Description (optional)"
          className="w-48 rounded border border-hairline px-2 py-1"
        />
        <button onClick={add} className="rounded bg-accent px-3 py-1 font-medium text-white hover:bg-accentDeep">
          + Add code
        </button>
      </div>
      {err && <p className="mt-1 text-bad">{err}</p>}
    </div>
  );
}

/**
 * Assign a client to a CAM from one small form, for the Clients section.
 * Same history-keeping rule as CamPicker: close, then open.
 */
export function CamAssignForm({
  clients,
  parties,
}: {
  clients: { id: number; name: string; cam: string | null; assignmentId: number | null }[];
  parties: { id: number; name: string }[];
}) {
  const [clientId, setClientId] = useState("");
  const chosen = clients.find((c) => String(c.id) === clientId);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Change a client&apos;s CAM:</span>
      <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="rounded border border-hairline px-2 py-1 text-sm">
        <option value="">Choose a client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.cam ? ` (${c.cam})` : " (no CAM)"}</option>
        ))}
      </select>
      {chosen && (
        <CamPicker clinicId={chosen.id} current={chosen.cam} currentAssignmentId={chosen.assignmentId} parties={parties} />
      )}
      <span className="text-[11px] text-muted">The old assignment is kept in the history, so earlier months keep their CAM.</span>
    </div>
  );
}
