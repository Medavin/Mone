export type Role = "admin" | "exec" | "ops" | "cam" | "agent" | "guest";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

export type Clinic = {
  id: number;
  code: string | null;
  name: string;
  status: string;
  go_live_date: string | null;
  notes: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator",
  exec:  "Executive",
  ops:   "Operations",
  cam:   "Account manager",
  agent: "AR agent",
  guest: "Guest",
};

/**
 * ops and exec sit ABOVE admin in this business and have full rights to
 * everything — Pravin's own words, 19 Aug 2026. The database says the same
 * thing in is_admin(); this is the app-side half, in one place so the two
 * cannot drift and so a new page cannot quietly forget one of the roles.
 */
export const MANAGEMENT_ROLES = ["admin", "ops", "exec"] as const;

export function manages(role: string | null | undefined) {
  return !!role && (MANAGEMENT_ROLES as readonly string[]).includes(role);
}


/**
 * The line under the name on the sign-in screen.
 *
 * "Accounts receivable platform" was true when the app only read A/R
 * workbooks. It now carries clinics, hours, assignments, chat, tasks and
 * portals — so the line was describing a smaller product than the one people
 * sign in to, and it undersold it to the person seeing it for the first time.
 *
 * Kept here as one constant so it can be changed in one place.
 */
export const APP_TAGLINE = "One team. One operation.";
export const APP_SUBLINE =
  "Momentum Billing's clinics, people and receivables in one place.";
