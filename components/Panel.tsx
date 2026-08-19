"use client";

import { useEffect, useState } from "react";

/**
 * A dashboard panel that can be collapsed, remembering its state per person.
 *
 * The state is read in an effect AFTER mount rather than during render: the
 * server has no access to localStorage, so reading it during render makes the
 * first client paint disagree with the server's HTML and React complains.
 *
 * Children stay mounted when collapsed so reopening is instant.
 */
export default function Panel({
  id,
  title,
  subtitle,
  right,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const saved = window.localStorage.getItem(`mone.panel.${id}`);
    if (saved !== null) setOpen(saved === "1");
  }, [id]);

  function toggle() {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem(`mone.panel.${id}`, next ? "1" : "0");
  }

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center justify-between gap-4 border-b border-hairline bg-canvas/40 px-4 py-3">
        <button onClick={toggle} className="flex items-center gap-2.5 text-left" aria-expanded={open}>
          <span
            className="text-[10px] text-accent transition"
            style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}
            aria-hidden="true"
          >
            ▶
          </span>
          <span>
            <span className="font-medium">{title}</span>
            {subtitle && <span className="ml-2 text-sm text-muted">{subtitle}</span>}
          </span>
        </button>
        {right}
      </div>
      <div className={open ? "p-4" : "hidden"}>{children}</div>
    </section>
  );
}
