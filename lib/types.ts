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
