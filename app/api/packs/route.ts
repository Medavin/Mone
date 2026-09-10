import JSZip from "jszip";
import { loadClinicPeriod, periodLabel } from "@/lib/clinicPeriod";
import { buildMonthlyPack } from "@/lib/buildPack";

/**
 * Generates monthly packs for any set of clinics over any period.
 *
 * One clinic comes back as a workbook. Several come back as a zip, because a
 * browser will not accept thirty-eight downloads in a row and nobody wants to
 * click thirty-eight times.
 *
 * ⚠ A CLINIC WITH NO FIGURES IS SKIPPED AND NAMED, never written as an empty
 * workbook. An empty pack sent to a client says "your month was zero", which
 * is a claim; "we have nothing for this clinic" is a fact, and a different one.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { clinicIds?: number[]; from?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Expected JSON.", { status: 400 });
  }

  const ids = (body.clinicIds ?? []).filter((v) => Number.isFinite(v));
  const from = body.from ?? "";
  const to = body.to ?? from;

  if (ids.length === 0) return new Response("No clinics chosen.", { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return new Response("Give a period as YYYY-MM.", { status: 400 });
  }
  if (from > to) return new Response("The period starts after it ends.", { status: 400 });

  const built: { name: string; buffer: ArrayBuffer }[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const id of ids) {
    const data = await loadClinicPeriod(id, from, to);
    if (!data) {
      skipped.push(`Clinic ${id} could not be found`);
      continue;
    }
    if (!data.summaryRow) {
      skipped.push(`${data.clinic.name}: nothing imported for this period`);
      continue;
    }

    const pack = buildMonthlyPack(data);
    built.push({ name: pack.fileName, buffer: pack.buffer });
    for (const w of pack.warnings) {
      if (w.sheet !== "Monthly Activity Graph") warnings.push(`${data.clinic.name} — ${w.message}`);
    }
  }

  if (built.length === 0) {
    return new Response(
      `No packs could be produced.\n\n${skipped.join("\n")}`,
      { status: 404, headers: { "Content-Type": "text/plain" } }
    );
  }

  const header = {
    // Encoded because a clinic name can carry a character a header cannot.
    "X-Pack-Built": String(built.length),
    "X-Pack-Skipped": encodeURIComponent(skipped.join(" | ")),
    "X-Pack-Warnings": encodeURIComponent(warnings.slice(0, 20).join(" | ")),
    "Cache-Control": "no-store",
  };

  if (built.length === 1) {
    return new Response(built[0].buffer, {
      headers: {
        ...header,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${built[0].name}"`,
      },
    });
  }

  const zip = new JSZip();
  for (const f of built) zip.file(f.name, f.buffer);
  const blob = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

  const label = periodLabel(from, to).replace(/\s+/g, "_");
  return new Response(blob, {
    headers: {
      ...header,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Monthly_packs_${label}.zip"`,
    },
  });
}
