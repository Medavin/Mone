import Link from "next/link";

/**
 * Presentational pieces for the Results pages, drawn to match Michelle's
 * mockup: white cards with a small blue icon and a bold title, a status
 * word with a percentage box on the health cards, coloured column heads on
 * the snapshot table. Server components — no state, nothing to hydrate.
 */

export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n < 0
      ? `(${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})`
      : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const plain = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US");
export const pct1 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
export const pct0 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n)}%`);
export const monthLabel = (m: string | null | undefined) =>
  m ? new Date(`${m.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";
export const dateLabel = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** The column-head colours from the mockup, cycled across clients. */
export const COLUMN_COLOURS = ["#0095D8", "#7B4FC9", "#2F9E5B", "#E08A1E", "#0E8C9C", "#D9466F", "#004A80", "#9C7B12"];

export const ICON: Record<string, JSX.Element> = {
  dashboard: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  client: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" /></>,
  cam: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.8-3.8 3.6-5.6 7-5.6s6.2 1.8 7 5.6" /></>,
  collector: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  clients: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></>,
  ar: <path d="M4 19h16M7 15v-4M12 15V6M17 15v-7" />,
  denials: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  crl: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM8.5 12l2.5 2.5L16 10" /></>,
  camtasks: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9h16M9 3v4M15 3v4M8 14l2.5 2.5L16 12" /></>,
  collectortasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>,
  utilization: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  reports: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  health: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 19c.7-3 3-4.6 6-4.6s5.3 1.6 6 4.6" /><path d="M16 5.5a3 3 0 0 1 0 5.4M18 14.6c1.6.6 2.6 2 3 4.4" /></>,
  doc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name] ?? ICON.doc}
    </svg>
  );
}

export function Card({
  title, icon, sub, right, children, footer, className = "",
}: {
  title: string; icon?: string; sub?: string; right?: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-card border border-hairline bg-surface shadow-card ${className}`}>
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink">
          {icon && <span className="text-brandMid"><Icon name={icon} /></span>}
          {title}
          {sub && <span className="text-xs font-normal text-muted">{sub}</span>}
        </h3>
        {right}
      </header>
      <div className="flex-1 px-4 py-3">{children}</div>
      {footer && <footer className="border-t border-hairline px-4 py-2 text-[11px] leading-relaxed text-muted">{footer}</footer>}
    </section>
  );
}

export function ViewLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap text-xs font-semibold text-brandMid underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

const TONES = {
  good: { text: "text-good", box: "bg-good/10 text-good", dot: "bg-good", mark: "✓" },
  warn: { text: "text-warn", box: "bg-warn/10 text-warn", dot: "bg-warn", mark: "!" },
  bad: { text: "text-bad", box: "bg-bad/10 text-bad", dot: "bg-bad", mark: "✕" },
  muted: { text: "text-muted", box: "bg-canvas text-muted", dot: "bg-muted", mark: "–" },
} as const;
export type Tone = keyof typeof TONES;

/** Status from a percentage: the same three bands on every health card. */
export function toneFor(pct: number | null): { tone: Tone; word: string } {
  if (pct === null) return { tone: "muted", word: "No data yet" };
  if (pct >= 80) return { tone: "good", word: "On track" };
  if (pct >= 60) return { tone: "warn", word: "Watch closely" };
  return { tone: "bad", word: "Needs attention" };
}

export function HealthCard({
  title, icon, pct, pctLabel, text, href,
}: { title: string; icon: string; pct: number | null; pctLabel: string; text: string; href: string }) {
  const { tone, word } = toneFor(pct);
  const t = TONES[tone];
  return (
    <Link href={href} className="group flex items-stretch gap-3 rounded-card border border-hairline bg-surface p-4 shadow-card transition hover:shadow-lift">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <span className="text-brandMid"><Icon name={icon} /></span>
          {title}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t.dot}`}>{t.mark}</span>
          <span className={`text-xl font-bold ${t.text}`}>{word}</span>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted">{text}</p>
      </div>
      <div className={`flex w-[5.5rem] shrink-0 flex-col items-center justify-center self-center rounded-lg px-1 py-3 ${t.box}`}>
        <span className="tnum text-2xl font-bold">{pct0(pct)}</span>
        <span className="text-center text-[10px] font-medium leading-tight">{pctLabel}</span>
      </div>
    </Link>
  );
}

/** "▲ +12% vs last period". `upIsGood` decides the colour, not the arrow. */
export function Delta({ now, prev, upIsGood, unit = "%" }: { now: number | null; prev: number | null; upIsGood: boolean; unit?: "%" | "abs" }) {
  if (now === null || prev === null) return <span className="text-[11px] text-muted">vs. last period: —</span>;
  const diff = unit === "%" ? (prev === 0 ? null : ((now - prev) / prev) * 100) : now - prev;
  if (diff === null) return <span className="text-[11px] text-muted">vs. last period: new</span>;
  const up = diff > 0;
  const good = diff === 0 ? null : up === upIsGood;
  const cls = good === null ? "text-muted" : good ? "text-good" : "text-bad";
  return (
    <span className={`tnum text-[11px] font-semibold ${cls}`}>
      {diff === 0 ? "■ 0" : `${up ? "▲ +" : "▼ "}${unit === "%" ? `${Math.round(diff)}%` : diff.toFixed(1)}`}
      <span className="block font-normal text-muted">vs. last period</span>
    </span>
  );
}

export function Donut({ part, total, label }: { part: number | null; total: number | null; label: string }) {
  const r = 46, c = 2 * Math.PI * r;
  const share = part !== null && total ? part / total : null;
  return (
    <svg viewBox="0 0 120 120" className="h-36 w-36">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#E4F3FB" strokeWidth="14" />
      {share !== null && (
        <circle cx="60" cy="60" r={r} fill="none" stroke="#0095D8" strokeWidth="14"
          strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 60 60)" strokeLinecap="butt" />
      )}
      <text x="60" y="58" textAnchor="middle" className="fill-ink" style={{ fontSize: 18, fontWeight: 700 }}>
        {share === null ? "—" : `${(share * 100).toFixed(1)}%`}
      </text>
      <text x="60" y="76" textAnchor="middle" className="fill-muted" style={{ fontSize: 9 }}>{label}</text>
    </svg>
  );
}

export function Spark({ values, limit }: { values: (number | null)[]; limit?: number }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="text-xs text-muted">—</span>;
  const w = 90, h = 24;
  const max = Math.max(...known, limit ?? 0) * 1.1 || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${i > 0 && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      {limit !== undefined && <line x1={0} x2={w} y1={y(limit)} y2={y(limit)} stroke="#DCE4E8" strokeDasharray="2 2" />}
      <path d={d} fill="none" stroke="#0095D8" strokeWidth={1.5} />
    </svg>
  );
}
