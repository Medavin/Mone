"use client";

import { useState } from "react";

/**
 * Scope for the Client & CAM Results page: period, CAM, and one client.
 *
 * Choosing a CAM narrows the client list to that CAM's clients, as
 * Michelle's spec asks ("a CAM selection displays all assigned clients and
 * permits drilldown to one client"). A plain GET form, so every view has
 * its own address and can be bookmarked or sent to someone.
 */
export default function ResultsFilters({
  months,
  from,
  to,
  cams,
  cam,
  clients,
  client,
}: {
  months: string[];
  from: string;
  to: string;
  cams: string[];
  cam: string;
  clients: { id: number; name: string; cam: string | null }[];
  client: number | null;
}) {
  const [pickedCam, setPickedCam] = useState(cam);
  const [pickedClient, setPickedClient] = useState(client ? String(client) : "");

  const visible = pickedCam ? clients.filter((c) => c.cam === pickedCam) : clients;

  const label = (m: string) =>
    new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const field = "rounded-card border border-hairline bg-surface px-3 py-1.5 text-sm shadow-card";

  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted">
        From
        <select name="from" defaultValue={from} className={`${field} mt-1 block`}>
          {months.map((m) => (
            <option key={m} value={m}>{label(m)}</option>
          ))}
        </select>
      </label>

      <label className="text-xs text-muted">
        To
        <select name="to" defaultValue={to} className={`${field} mt-1 block`}>
          {months.map((m) => (
            <option key={m} value={m}>{label(m)}</option>
          ))}
        </select>
      </label>

      <label className="text-xs text-muted">
        CAM
        <select
          name="cam"
          value={pickedCam}
          onChange={(e) => {
            setPickedCam(e.target.value);
            setPickedClient("");
          }}
          className={`${field} mt-1 block min-w-[10rem]`}
        >
          <option value="">All CAMs</option>
          {cams.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="__none">No CAM set</option>
        </select>
      </label>

      <label className="text-xs text-muted">
        Client
        <select
          name="client"
          value={pickedClient}
          onChange={(e) => setPickedClient(e.target.value)}
          className={`${field} mt-1 block min-w-[13rem]`}
        >
          <option value="">
            {pickedCam ? `All of ${pickedCam === "__none" ? "them" : pickedCam + "'s"} clients` : "All active clients"}
          </option>
          {(pickedCam === "__none" ? clients.filter((c) => !c.cam) : visible).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <button className="rounded-card bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-card hover:bg-accentDeep">
        Show
      </button>
      <a href="/results" className="pb-1.5 text-sm text-muted hover:text-ink">Reset</a>
    </form>
  );
}
