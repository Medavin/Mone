/**
 * Read every row of a query, a page at a time.
 *
 * WHY THIS EXISTS
 * Supabase caps a REST response at a fixed number of rows — 1,000 by
 * default (Project Settings -> API -> Max rows). Past that the request does
 * NOT fail. It quietly returns a truncated set, so a page that sums the
 * rows shows a number that is simply too small, with nothing on screen to
 * say so. That is the worst kind of bug in this app: plausible and wrong.
 *
 * MOne is already past that line — one clinic's activity_monthly is 1,214
 * rows, and that is with a single clinic loaded out of 38.
 *
 * Pass a builder that takes a row range and returns the query. The loop
 * keeps asking for the next page until a page comes back empty, so it is
 * correct whatever the cap is set to.
 *
 * Always give the query a stable .order(...) — without one, Postgres may
 * return rows in a different order for each page and a row can be missed
 * or read twice.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  let offset = 0;

  // A guard against an endless loop if a query ever returns the same page
  // forever. 200 pages is 100,000 rows, far more than any screen needs.
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build(offset, offset + pageSize - 1);
    if (error) return { rows, error };

    const batch = data ?? [];
    rows.push(...batch);

    if (batch.length === 0) break;
    offset += batch.length;
  }

  return { rows, error: null };
}
