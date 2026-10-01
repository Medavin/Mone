/**
 * One code per Prompt insurance / payer type, shared by every Prompt
 * import so the same type always lands in the same financial class.
 *
 * Long names are NOT cut short: "Health Maintenance Organization (HMO)
 * Medicare Risk" and "… (Contracted)" share their first 40 characters,
 * and cutting both to 40 gave them one code — Postgres then refused the
 * upsert ("cannot affect row a second time", 2 Oct 2026). Names over 40
 * characters keep 30 characters plus a short fingerprint of the full name.
 */
export function promptClassCode(name: string): string {
  const slug = `PT-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  if (slug.length <= 40) return slug;
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return `${slug.slice(0, 30)}-${h.toString(36).toUpperCase()}`;
}
