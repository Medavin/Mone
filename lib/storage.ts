import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Uploading, in one place, because Files and chat must agree.
 *
 * If each rolled its own, the two would drift on the path scheme, the size
 * limit and the kind detection — and a file uploaded by one would be listed
 * wrongly, or not at all, by the other.
 */

export const BUCKET = "mone-files";

/** 50 MB. Large enough for a workbook or a scan, small enough that a stray
 *  video does not fill the free tier in one afternoon. */
export const MAX_BYTES = 50 * 1024 * 1024;

const BY_EXT: [RegExp, string][] = [
  [/\.(xlsx?|xlsm|csv|tsv)$/i, "sheet"],
  [/\.(docx?|rtf|odt|pages)$/i, "doc"],
  [/\.pdf$/i, "pdf"],
  [/\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i, "image"],
  [/\.(mp4|mov|m4v|webm|avi)$/i, "video"],
  [/\.(txt|md|log|json|xml|html?)$/i, "text"],
  [/\.(zip|rar|7z|tar|gz)$/i, "archive"],
];

/** Broad kind from the file name. The extension is what people recognise,
 *  and it is also what survives a browser reporting a vague mime type. */
export function kindFor(name: string) {
  for (const [re, kind] of BY_EXT) if (re.test(name)) return kind;
  return "other";
}

/**
 * A storage path that cannot collide and cannot be guessed.
 *
 * The original name is kept in the database, not in the path: a path built
 * from a user-supplied name invites slashes, spaces and non-Latin characters
 * that some storage clients mangle, and two people uploading "report.xlsx"
 * would fight over one object.
 */
export function pathFor(prefix: string, name: string) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}/${rand}${ext.replace(/[^a-z0-9.]/g, "")}`;
}

export async function uploadFile(
  supabase: SupabaseClient,
  file: File,
  prefix: string
): Promise<{ path: string; kind: string } | { error: string }> {
  if (file.size > MAX_BYTES) {
    return {
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        MAX_BYTES / 1024 / 1024
      } MB — send larger files another way and record the link here instead.`,
    };
  }

  const path = pathFor(prefix, file.name);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    return {
      error: error.message.toLowerCase().includes("bucket")
        ? `The "${BUCKET}" storage bucket does not exist yet. It has to be created by hand in Supabase → Storage.`
        : error.message,
    };
  }

  return { path, kind: kindFor(file.name) };
}

/**
 * A link that works for an hour and then stops.
 *
 * Never a public URL: the bucket holds clinic material, and a public link is
 * forever and forwardable.
 */
export async function signedUrl(supabase: SupabaseClient, path: string, seconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export function humanSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
