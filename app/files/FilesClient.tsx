"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";
import { humanSize, signedUrl, uploadFile, MAX_BYTES } from "@/lib/storage";
import type { Profile } from "@/lib/types";

type SharedFile = {
  id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string;
  title: string | null;
  note: string | null;
  folder: string | null;
  clinic_id: number | null;
  uploaded_by: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  sheet: "Spreadsheet",
  doc: "Document",
  pdf: "PDF",
  image: "Image",
  video: "Video",
  text: "Text",
  archive: "Archive",
  other: "File",
};

const KIND_ICON: Record<string, string> = {
  sheet: "▦",
  doc: "▤",
  pdf: "▣",
  image: "◈",
  video: "▶",
  text: "≡",
  archive: "▧",
  other: "○",
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

export default function FilesClient({
  me,
  files,
  clinics,
  people,
}: {
  me: Profile;
  files: SharedFile[];
  clinics: { id: number; name: string }[];
  people: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [clinic, setClinic] = useState("");
  const [q, setQ] = useState("");
  const [pendingClinic, setPendingClinic] = useState("");
  const [pendingNote, setPendingNote] = useState("");

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);

    for (const file of Array.from(list)) {
      const up = await uploadFile(supabase, file, "files");
      if ("error" in up) {
        setError(up.error);
        break;
      }
      const { error: rowError } = await supabase.from("shared_files").insert({
        storage_path: up.path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        kind: up.kind,
        note: pendingNote.trim() || null,
        clinic_id: pendingClinic ? Number(pendingClinic) : null,
        uploaded_by: me.id,
      });
      if (rowError) {
        // The bytes landed but the record did not, which would leave an
        // orphan nobody can find. Remove them again rather than leave litter.
        await supabase.storage.from("mone-files").remove([up.path]);
        setError(rowError.message);
        break;
      }
    }

    setBusy(false);
    setPendingNote("");
    router.refresh();
  }

  async function open(f: SharedFile) {
    const url = await signedUrl(supabase, f.storage_path);
    if (!url) {
      setError("That file could not be opened. It may have been removed from storage.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  async function remove(f: SharedFile) {
    setBusy(true);
    // The record is marked rather than deleted, so "who removed the March
    // pack" still has an answer. The bytes do go.
    const { error: rowError } = await supabase
      .from("shared_files")
      .update({ deleted_at: new Date().toISOString(), deleted_by: me.id })
      .eq("id", f.id);
    if (!rowError) await supabase.storage.from("mone-files").remove([f.storage_path]);
    setBusy(false);
    if (rowError) setError(rowError.message);
    else router.refresh();
  }

  const shown = files.filter((f) => {
    if (kind && f.kind !== kind) return false;
    if (clinic && String(f.clinic_id ?? "") !== clinic) return false;
    if (q.trim()) {
      const hay = [f.file_name, f.note, f.folder].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const kinds = Array.from(new Set(files.map((f) => f.kind)));
  const totalBytes = shown.reduce((t, f) => t + (f.size_bytes ?? 0), 0);

  const field =
    "rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="mt-1 text-sm text-muted">
            Anything the team needs to hand each other. Up to {MAX_BYTES / 1024 / 1024} MB a file.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {/* upload */}
      <div className="mt-6 rounded-card border border-dashed border-hairline bg-surface p-5 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="eyebrow">Attach to a clinic (optional)</span>
            <select
              value={pendingClinic}
              onChange={(e) => setPendingClinic(e.target.value)}
              className={`${field} mt-1`}
            >
              <option value="">Not clinic-specific</option>
              {clinics.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="eyebrow">What is it (optional)</span>
            <input
              value={pendingNote}
              onChange={(e) => setPendingNote(e.target.value)}
              placeholder="March pack as sent to the client"
              className={`${field} mt-1 w-full`}
            />
          </label>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => onPick(e.target.files)}
            className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-accent
                       file:px-4 file:py-2 file:text-sm file:text-white"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          A file attached to a clinic is visible only to people who can see that clinic. Everything
          else is visible to everyone signed in — so nothing goes here that should not be.
        </p>
      </div>

      {/* filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or note…"
          className={`${field} w-56`}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
          <option value="">Every kind</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </select>
        <select value={clinic} onChange={(e) => setClinic(e.target.value)} className={field}>
          <option value="">Every clinic</option>
          {clinics.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <TableControls
          title="Files"
          rows={shown}
          note={humanSize(totalBytes)}
          columns={[
            { header: "File", value: (f) => f.file_name },
            { header: "Kind", value: (f) => KIND_LABEL[f.kind] ?? f.kind },
            { header: "Size", value: (f) => f.size_bytes ?? 0 },
            { header: "Clinic", value: (f) => (f.clinic_id ? clinicName.get(f.clinic_id) ?? "" : "") },
            { header: "Note", value: (f) => f.note ?? "" },
            { header: "Uploaded by", value: (f) => nameOf.get(f.uploaded_by ?? "") ?? "" },
            { header: "Uploaded", value: (f) => f.created_at },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          {files.length === 0
            ? "Nothing shared yet. This is where the packs, screenshots and letters live once they stop living in email."
            : "Nothing matches that."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-hairline/60">
          {shown.map((f) => (
            <li key={f.id} className="flex items-center gap-4 py-3">
              <span className="w-6 text-center text-lg text-muted" aria-hidden="true">
                {KIND_ICON[f.kind] ?? "○"}
              </span>
              <div className="min-w-0 flex-1">
                <button onClick={() => open(f)} className="truncate text-left hover:text-accent">
                  {f.file_name}
                </button>
                <div className="text-xs text-muted">
                  {[
                    humanSize(f.size_bytes),
                    f.clinic_id ? clinicName.get(f.clinic_id) : null,
                    nameOf.get(f.uploaded_by ?? ""),
                    when(f.created_at),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {f.note && <div className="text-xs">{f.note}</div>}
              </div>
              <button
                onClick={() => open(f)}
                className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:text-ink print:hidden"
              >
                Open
              </button>
              {(f.uploaded_by === me.id || me.role === "admin") && (
                <button
                  onClick={() => remove(f)}
                  disabled={busy}
                  className="text-xs text-bad underline print:hidden"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-muted">
        Files open through a link that expires after an hour, so a copied address cannot be forwarded
        and used later. Removing a file deletes the file itself but keeps the record of who removed
        it and when.
      </p>
    </div>
  );
}
