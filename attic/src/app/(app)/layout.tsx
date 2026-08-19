import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";

const NAV = [
  { href: "/clinics", label: "Clinics" },
  { href: "/crl", label: "CRL" },
  { href: "/tasks", label: "Tasks" },
  { href: "/projects", label: "Projects" },
  { href: "/reports", label: "Reports" },
];

/** Chrome shared by every signed-in page. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/clinics" className="brand">
            MOne
          </Link>
          <nav className="nav">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-user">
            <span className="muted">{user?.email}</span>
            <form action={signOut}>
              <button type="submit" className="secondary small">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
