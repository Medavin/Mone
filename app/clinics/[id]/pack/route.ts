import { loadClinicMonth } from "@/lib/clinicMonth";
import { buildMonthlyPack } from "@/lib/buildPack";

/**
 * Generates the monthly pack for one clinic and month.
 *
 * This is the workbook Momentum assembles by hand today — nine sheets, pulled
 * from several AdvancedMD reports, about fifteen working days a month across
 * thirty-eight clinics. Every figure is already in MBOne, so producing it is
 * a matter of writing them back out in the shape the clients expect.
 *
 * Warnings come back in a response header rather than inside the file. A note
 * written into the workbook would be sent to a client along with everything
 * else; a header is seen by the person downloading it, which is who needs it.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? undefined;

  const data = await loadClinicMonth(Number(params.id), month);
  if (!data) {
    return new Response("That clinic could not be found.", { status: 404 });
  }

  const { buffer, fileName, warnings } = buildMonthlyPack(data);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Pack-Warnings": String(warnings.length),
      "Cache-Control": "no-store",
    },
  });
}
