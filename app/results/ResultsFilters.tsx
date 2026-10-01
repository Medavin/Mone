"use client";

import { useState } from "react";

/**
 * The filter bar across the top of every Results section, laid out as in
 * Michelle's mockup: Date range · CAM · Client · Collector · View · Reset.
 *
 * Start and end are real dates. Monthly figures (A/R, visits, payments)
 * use every month the range touches; dated records (CRL, denials, tasks)
 * use the exact days. A plain GET form, so every view has its own address
 * that can be bookmarked or sent to someone.
 */
export default function ResultsFilters({
  section,
  start,
  end,
  ytd,
  cams,
  cam,
  clients,
  client,
  collectors,
  collector,
  view,
  systems,
  system,
}: {
  section: string;
  start: string;
  end: string;
  ytd: { start: string; end: string };
  cams: string[];
  cam: string;
  clients: { id: number; name: string; cam: string | null }[];
  client: number | null;
  collectors: string[];
  collector: string;
  view: string;
  systems: string[];
  system: string;
}) {
  const [pickedCam, setPickedCam] = useState(cam);
  const [pickedClient, setPickedClient] = useState(client ? String(client) : "");
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);

  const visible =
    pickedCam === "__none" ? clients.filter((c) => !c.cam) : pickedCam ? clients.filter((c) => c.cam === pickedCam) : clients;

  const box = "mt-1 block w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-brandMid focus:outline-none";
  const lab = "block text-xs font-semibold text-ink/80";

  // Quick ranges, measured from the end of the latest data month.
  const preset = (months: number) => {
    const [y, m] = ytd.end.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - months, 1)).toISOString().slice(0, 10);
    setS(first);
    setE(ytd.end);
  };

  return (
    <form className="grid grid-cols-2 gap-3 rounded-card border border-hairline bg-surface p-4 shadow-card md:grid-cols-3 xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto]">
      <input type="hidden" name="section" value={section} />

      <div className="col-span-2 md:col-span-3 xl:col-span-1">
        <span className={lab}>Date range</span>
        <div className="mt-1 flex items-center gap-1">
          <input type="date" name="start" value={s} onChange={(ev) => setS(ev.target.value)} className={box.replace("mt-1 block ", "")} aria-label="Start date" />
          <span className="text-muted">–</span>
          <input type="date" name="end" value={e} onChange={(ev) => setE(ev.target.value)} className={box.replace("mt-1 block ", "")} aria-label="End date" />
        </div>
        <div className="mt-1 flex gap-2 text-[11px]">
          <button type="button" onClick={() => { setS(ytd.start); setE(ytd.end); }} className="text-brandMid hover:underline">Year to date</button>
          <button type="button" onClick={() => preset(1)} className="text-brandMid hover:underline">Last month</button>
          <button type="button" onClick={() => preset(3)} className="text-brandMid hover:underline">Last 3 months</button>
          <button type="button" onClick={() => preset(12)} className="text-brandMid hover:underline">Last 12 months</button>
        </div>
      </div>

      <label className={lab}>
        CAM
        <select
          name="cam"
          value={pickedCam}
          onChange={(ev) => { setPickedCam(ev.target.value); setPickedClient(""); }}
          className={box}
        >
          <option value="">All CAMs</option>
          {cams.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="__none">No CAM set</option>
        </select>
        <span className="mt-1 block text-[11px] font-normal text-muted">Select a CAM to view all of their clients</span>
      </label>

      <label className={lab}>
        Client
        <select name="client" value={pickedClient} onChange={(ev) => setPickedClient(ev.target.value)} className={box}>
          <option value="">All clients</option>
          {visible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="mt-1 block text-[11px] font-normal text-muted">Or select a single client</span>
      </label>

      <label className={lab}>
        Collector
        <select name="collector" defaultValue={collector} className={box}>
          <option value="">All collectors</option>
          {collectors.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-3">
        <label className={lab}>
          View
          <select name="view" defaultValue={view} className={box}>
            <option value="client">Client level</option>
            <option value="cam">CAM level</option>
          </select>
        </label>
        {systems.length > 1 && (
          <label className={lab}>
            Billing system
            <select name="system" defaultValue={system} className={box}>
              <option value="">All systems</option>
              {systems.map((x) => (
                <option key={x} value={x}>{x === "advancedmd" ? "AdvancedMD" : x === "prompt" ? "Prompt" : "Other"}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="col-span-2 flex items-end gap-2 md:col-span-3 xl:col-span-1 xl:flex-col xl:items-stretch xl:justify-end">
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-accentDeep">
          Apply
        </button>
        <a href={`/results?section=${section}`} className="rounded-lg px-3 py-2 text-center text-sm text-brandMid hover:underline">
          ↻ Reset filters
        </a>
      </div>
    </form>
  );
}
