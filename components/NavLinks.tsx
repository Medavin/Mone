"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The nav, grouped.
 *
 * It had grown to fifteen items on one line, which is past the point where
 * anybody reads it — they hunt instead. Four groups plus the front page is a
 * number you can hold in your head, and the grouping is by what somebody is
 * DOING rather than by which table the data sits in.
 *
 * ⚠ THE PANEL IS `absolute`, NEVER `fixed`. The header uses backdrop-blur,
 * and an element with a backdrop-filter becomes the containing block for any
 * fixed-position descendant — a fixed panel would be trapped inside the
 * header strip. Same trap the chat bubble had to be moved out of.
 *
 * ⚠ AND THIS ROW MUST NOT HAVE `overflow-x-auto`. It used to, to scroll
 * fifteen items; with a dropdown open that overflow CLIPS the panel and the
 * menu looks like it does nothing. Five things fit, so it wraps instead.
 */

type Item = { href: string; label: string; hint?: string };
type Group = { key: string; label: string; colour: string; icon: JSX.Element; items: Item[] };

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONS = {
  portfolio: <path d="M3 13h3.5l2-5 3 9 2.5-6H21" {...s} />,
  clinics: (
    <>
      <path d="M4 20V9l8-5 8 5v11" {...s} />
      <path d="M12 8.5v5M9.5 11h5" {...s} />
    </>
  ),
  team: <path d="M20 13a7 7 0 0 1-9.6 6.5L5 21l1.6-4.6A7 7 0 1 1 20 13z" {...s} />,
  work: (
    <>
      <path d="M4 7.5l2 2 3.5-3.5M4 16.5l2 2 3.5-3.5" {...s} />
      <path d="M13 8h7M13 17h7" {...s} />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" {...s} />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
        {...s}
      />
    </>
  ),
};

const GROUPS: Group[] = [
  {
    key: "clinics",
    label: "Clinics",
    colour: "#3D5AB5",
    icon: ICONS.clinics,
    items: [
      { href: "/clinics", label: "Clinics", hint: "A/R, aging and the month's figures" },
      { href: "/assignments", label: "Assignments", hint: "Who owns which work, per clinic" },
      { href: "/actions", label: "Collector actions", hint: "What was worked, and by whom" },
      { href: "/portals", label: "Insurance portals", hint: "Which portal, whose login" },
    ],
  },
  {
    key: "team",
    label: "Team",
    colour: "#7A52C4",
    icon: ICONS.team,
    items: [
      { href: "/team", label: "Chat", hint: "Channels and direct messages" },
      { href: "/people", label: "Attendance", hint: "Who is working today" },
      { href: "/hours", label: "Hours", hint: "Time worked, and what is billable" },
      { href: "/calendar", label: "Calendar", hint: "Events, holidays and leave" },
      { href: "/news", label: "News & policy", hint: "Announcements worth keeping" },
    ],
  },
  {
    key: "work",
    label: "Work",
    colour: "#CB6B22",
    icon: ICONS.work,
    items: [
      { href: "/tasks", label: "Tasks & flags", hint: "What is owed, and by whom" },
      { href: "/notes", label: "Meeting notes", hint: "What was said, and agreed" },
      { href: "/files", label: "Files", hint: "Shared documents" },
      { href: "/inventory", label: "Inventory", hint: "Equipment and stock, and who has it" },
    ],
  },
];

const ADMIN_GROUP: Group = {
  key: "admin",
  label: "Settings",
  colour: "#5C6B75",
  icon: ICONS.settings,
  items: [
    { href: "/import", label: "Import a pack", hint: "The monthly AdvancedMD workbook" },
    { href: "/import/actions", label: "Import actions", hint: "The collection action report" },
    { href: "/admin", label: "Settings", hint: "Employees, clinics, mappings, billing rules" },
    { href: "/activity", label: "Activity & undo", hint: "What changed, and reversing an import" },
  ],
};

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);

  const groups = isAdmin ? [...GROUPS, ADMIN_GROUP] : GROUPS;

  // Clicking elsewhere closes it, and so does Escape. A menu that only closes
  // by pressing the same button again feels stuck.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Moving to another page should not leave a menu hanging open.
  useEffect(() => setOpen(null), [pathname]);

  const onPortfolio = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const inGroup = (g: Group) =>
    g.items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  return (
    <div ref={wrap} className="-mx-1 flex flex-wrap items-center gap-0.5 pb-1 text-sm">
      <Link
        href="/dashboard"
        aria-current={onPortfolio ? "page" : undefined}
        className="group flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition"
        style={
          onPortfolio
            ? { background: "#0095D815", color: "#0095D8", fontWeight: 500 }
            : { color: "#5C6B75" }
        }
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[17px] w-[17px] shrink-0"
          style={{ color: onPortfolio ? "#0095D8" : "#0095D8B0" }}
          aria-hidden="true"
        >
          {ICONS.portfolio}
        </svg>
        <span className={onPortfolio ? "" : "transition group-hover:text-ink"}>Portfolio</span>
      </Link>

      {groups.map((g) => {
        const active = inGroup(g);
        const isOpen = open === g.key;
        return (
          <div key={g.key} className="relative shrink-0">
            <button
              onClick={() => setOpen(isOpen ? null : g.key)}
              aria-expanded={isOpen}
              className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 transition"
              style={
                active || isOpen
                  ? { background: `${g.colour}15`, color: g.colour, fontWeight: 500 }
                  : { color: "#5C6B75" }
              }
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[17px] w-[17px] shrink-0"
                style={{ color: active || isOpen ? g.colour : `${g.colour}B0` }}
                aria-hidden="true"
              >
                {g.icon}
              </svg>
              <span className={active || isOpen ? "" : "transition group-hover:text-ink"}>
                {g.label}
              </span>
              <span className="text-[9px] opacity-60" aria-hidden="true">
                &#9662;
              </span>
            </button>

            {isOpen && (
              <div
                className="absolute left-0 z-40 mt-1 w-72 rounded-card border border-hairline bg-surface p-1.5 shadow-lift"
                role="menu"
              >
                {g.items.map((it) => {
                  const here = pathname === it.href || pathname.startsWith(`${it.href}/`);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      role="menuitem"
                      className="block rounded px-3 py-2 transition hover:bg-canvas"
                      style={here ? { background: `${g.colour}12` } : undefined}
                    >
                      <div
                        className="text-sm"
                        style={here ? { color: g.colour, fontWeight: 500 } : undefined}
                      >
                        {it.label}
                      </div>
                      {it.hint && <div className="text-xs text-muted">{it.hint}</div>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
