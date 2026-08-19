"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";
import type { Profile } from "@/lib/types";

type Item = {
  id: number;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_no: string | null;
  asset_tag: string | null;
  is_consumable: boolean;
  quantity: number;
  reorder_at: number | null;
  status: string;
  condition: string | null;
  location: string | null;
  purchased_on: string | null;
  cost: number | null;
  warranty_until: string | null;
  supplier: string | null;
  note: string | null;
};

type Assignment = {
  id: number;
  item_id: number;
  profile_id: string | null;
  employee_id: number | null;
  holder_name: string | null;
  quantity: number;
  issued_on: string;
  returned_on: string | null;
  note: string | null;
};

const CATEGORIES = [
  "laptop", "desktop", "monitor", "headset", "phone",
  "network", "furniture", "licence", "stationery", "other",
] as const;

const STATUSES = ["in_stock", "assigned", "repair", "retired", "lost"] as const;

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In stock",
  assigned: "With someone",
  repair: "In repair",
  retired: "Retired",
  lost: "Lost",
};

const blank = {
  name: "",
  category: "laptop",
  brand: "",
  model: "",
  serial_no: "",
  asset_tag: "",
  is_consumable: "",
  quantity: "1",
  reorder_at: "",
  condition: "good",
  location: "",
  purchased_on: "",
  cost: "",
  warranty_until: "",
  supplier: "",
  note: "",
};

export default function InventoryClient({
  me,
  canEdit,
  items,
  assignments,
  people,
  employees,
}: {
  me: Profile;
  canEdit: boolean;
  items: Item[];
  assignments: Assignment[];
  people: { id: string; full_name: string }[];
  employees: { id: number; full_name: string; status: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [openItem, setOpenItem] = useState<number | null>(null);
  const [issueTo, setIssueTo] = useState<Record<number, string>>({});
  const [issueQty, setIssueQty] = useState<Record<number, string>>({});
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.full_name])), [employees]);

  const open = useMemo(() => assignments.filter((a) => !a.returned_on), [assignments]);

  const holderOf = (a: Assignment) =>
    (a.profile_id && nameOf.get(a.profile_id)) ||
    (a.employee_id && empName.get(a.employee_id)) ||
    a.holder_name ||
    "someone";

  /** How many of a consumable are out with people right now. */
  const issuedCount = (itemId: number) =>
    open.filter((a) => a.item_id === itemId).reduce((t, a) => t + a.quantity, 0);

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function addItem() {
    if (!form.name.trim()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("inventory_items").insert({
      name: form.name.trim(),
      category: form.category,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      serial_no: form.serial_no.trim() || null,
      asset_tag: form.asset_tag.trim() || null,
      is_consumable: form.is_consumable === "yes",
      quantity: Number(form.quantity || 1),
      reorder_at: form.reorder_at ? Number(form.reorder_at) : null,
      condition: form.condition || null,
      location: form.location.trim() || null,
      purchased_on: form.purchased_on || null,
      cost: form.cost ? Number(form.cost) : null,
      warranty_until: form.warranty_until || null,
      supplier: form.supplier.trim() || null,
      note: form.note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMsg({
        ok: false,
        text: error.message.includes("inventory_asset_tag")
          ? "Something already carries that asset tag. Two items with one tag would make every later question unanswerable."
          : error.message,
      });
      return;
    }
    setForm({ ...blank });
    setAdding(false);
    router.refresh();
  }

  async function issue(item: Item) {
    const to = issueTo[item.id];
    if (!to) return;
    const qty = Number(issueQty[item.id] || 1);
    setBusy(true);
    setMsg(null);

    const { error } = await supabase.from("inventory_assignments").insert({
      item_id: item.id,
      profile_id: to,
      quantity: qty,
      issued_by: me.id,
    });

    if (!error && !item.is_consumable) {
      await supabase.from("inventory_items").update({ status: "assigned" }).eq("id", item.id);
    }

    setBusy(false);
    if (error) {
      setMsg({
        ok: false,
        text: error.message.includes("inv_assign_one_open")
          ? "That item is already with somebody. Take it back first — one thing cannot be in two places."
          : error.message,
      });
      return;
    }
    setIssueTo({ ...issueTo, [item.id]: "" });
    router.refresh();
  }

  async function takeBack(a: Assignment, item: Item) {
    setBusy(true);
    const { error } = await supabase
      .from("inventory_assignments")
      .update({ returned_on: new Date().toISOString().slice(0, 10) })
      .eq("id", a.id);

    if (!error && !item.is_consumable) {
      await supabase.from("inventory_items").update({ status: "in_stock" }).eq("id", item.id);
    }
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else router.refresh();
  }

  async function setStatusOf(id: number, value: string) {
    setBusy(true);
    const { error } = await supabase.from("inventory_items").update({ status: value }).eq("id", id);
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else router.refresh();
  }

  const shown = items.filter((i) => {
    if (category && i.category !== category) return false;
    if (status && i.status !== status) return false;
    if (q.trim()) {
      const hay = [i.name, i.brand, i.model, i.serial_no, i.asset_tag, i.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const low = items.filter(
    (i) => i.is_consumable && i.reorder_at !== null && i.quantity - issuedCount(i.id) <= i.reorder_at
  );

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-muted">
            Equipment and stock, and who is holding it.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white print:hidden"
          >
            {adding ? "Cancel" : "+ Add item"}
          </button>
        )}
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-card border px-4 py-3 text-sm ${
            msg.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
          }`}
        >
          {msg.text}
        </p>
      )}

      {low.length > 0 && (
        <p className="mt-4 rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          {low.map((i) => i.name).join(", ")} {low.length === 1 ? "is" : "are"} at or below the
          reorder level.
        </p>
      )}

      {adding && canEdit && (
        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="eyebrow">What is it</span>
              <input value={form.name} onChange={(e) => set("name", e.target.value)}
                     placeholder="Dell Latitude 5440" className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Category</span>
              <select value={form.category} onChange={(e) => set("category", e.target.value)} className={`${field} mt-1`}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="eyebrow">Counted, not tracked individually</span>
              <select value={form.is_consumable} onChange={(e) => set("is_consumable", e.target.value)} className={`${field} mt-1`}>
                <option value="">No — one object, has a serial</option>
                <option value="yes">Yes — a quantity, like headsets</option>
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">{form.is_consumable === "yes" ? "How many" : "Quantity"}</span>
              <input type="number" min="0" value={form.quantity}
                     onChange={(e) => set("quantity", e.target.value)} className={`${field} mt-1`} />
            </label>
            {form.is_consumable === "yes" && (
              <label className="block">
                <span className="eyebrow">Warn me at</span>
                <input type="number" min="0" value={form.reorder_at}
                       onChange={(e) => set("reorder_at", e.target.value)} placeholder="5" className={`${field} mt-1`} />
              </label>
            )}

            {form.is_consumable !== "yes" &&
              ([
                ["brand", "Brand"],
                ["model", "Model"],
                ["serial_no", "Serial number"],
                ["asset_tag", "Asset tag"],
              ] as const).map(([k, label]) => (
                <label key={k} className="block">
                  <span className="eyebrow">{label}</span>
                  <input value={(form as Record<string, string>)[k]}
                         onChange={(e) => set(k, e.target.value)} className={`${field} mt-1`} />
                </label>
              ))}

            <label className="block">
              <span className="eyebrow">Where it is</span>
              <input value={form.location} onChange={(e) => set("location", e.target.value)}
                     placeholder="Dehradun office" className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Bought on</span>
              <input type="date" value={form.purchased_on}
                     onChange={(e) => set("purchased_on", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Cost</span>
              <input type="number" step="0.01" value={form.cost}
                     onChange={(e) => set("cost", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Warranty until</span>
              <input type="date" value={form.warranty_until}
                     onChange={(e) => set("warranty_until", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block sm:col-span-3">
              <span className="eyebrow">Note</span>
              <input value={form.note} onChange={(e) => set("note", e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          <button onClick={addItem} disabled={busy || !form.name.trim()}
                  className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Add item"}
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <input value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search name, serial, tag…" className={`${field} w-56`} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          <option value="">Every category</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
          <option value="">Every status</option>
          {STATUSES.map((sv) => <option key={sv} value={sv}>{STATUS_LABEL[sv]}</option>)}
        </select>
        <span className="flex-1" />
        <TableControls
          title="Inventory"
          rows={shown}
          columns={[
            { header: "Item", value: (i) => i.name },
            { header: "Category", value: (i) => i.category },
            { header: "Brand", value: (i) => i.brand ?? "" },
            { header: "Model", value: (i) => i.model ?? "" },
            { header: "Serial", value: (i) => i.serial_no ?? "" },
            { header: "Asset tag", value: (i) => i.asset_tag ?? "" },
            { header: "Counted", value: (i) => (i.is_consumable ? "yes" : "") },
            { header: "Quantity", value: (i) => i.quantity },
            { header: "Out with people", value: (i) => issuedCount(i.id) },
            { header: "Status", value: (i) => STATUS_LABEL[i.status] ?? i.status },
            { header: "Where", value: (i) => i.location ?? "" },
            { header: "Bought", value: (i) => i.purchased_on ?? "" },
            { header: "Cost", value: (i) => i.cost ?? "" },
            { header: "Warranty until", value: (i) => i.warranty_until ?? "" },
            {
              header: "With",
              value: (i) => open.filter((a) => a.item_id === i.id).map(holderOf).join("; "),
            },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          {items.length === 0
            ? "Nothing recorded yet. This answers two questions that otherwise need a walk around the office: who has the good laptop, and how many headsets are left."
            : "Nothing matches that."}
        </p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thL}>Item</th>
              <th className={thL}>Where / with</th>
              <th className={thL}>Status</th>
              <th className={thL} />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const mine = open.filter((a) => a.item_id === i.id);
              const isOpen = openItem === i.id;
              const history = assignments.filter((a) => a.item_id === i.id);
              const available = i.is_consumable ? i.quantity - issuedCount(i.id) : null;
              return (
                <Fragment key={i.id}>
                  <tr className="border-b border-hairline/60">
                    <td className="py-2">
                      <button onClick={() => setOpenItem(isOpen ? null : i.id)} className="text-left hover:text-accent">
                        {i.name}
                      </button>
                      <div className="text-xs text-muted">
                        {[i.brand, i.model, i.asset_tag ? `tag ${i.asset_tag}` : null, i.serial_no]
                          .filter(Boolean)
                          .join(" · ") || i.category}
                      </div>
                    </td>
                    <td className="py-2 text-xs">
                      {i.is_consumable ? (
                        <span className={available !== null && available <= 0 ? "text-warn" : ""}>
                          {available} of {i.quantity} free
                        </span>
                      ) : mine.length ? (
                        <span>{mine.map(holderOf).join(", ")}</span>
                      ) : (
                        <span className="text-muted">{i.location ?? "—"}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {canEdit ? (
                        <select
                          value={i.status}
                          onChange={(e) => setStatusOf(i.id, e.target.value)}
                          className="rounded border border-hairline px-1.5 py-1 text-xs"
                        >
                          {STATUSES.map((sv) => (
                            <option key={sv} value={sv}>{STATUS_LABEL[sv]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs">{STATUS_LABEL[i.status]}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setOpenItem(isOpen ? null : i.id)}
                        className="text-xs text-muted underline"
                      >
                        {isOpen ? "Close" : "History"}
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-hairline/60 bg-canvas">
                      <td colSpan={4} className="p-4">
                        {canEdit && (
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="block">
                              <span className="eyebrow">Issue to</span>
                              <select
                                value={issueTo[i.id] ?? ""}
                                onChange={(e) => setIssueTo({ ...issueTo, [i.id]: e.target.value })}
                                className={`${field} mt-1 min-w-[12rem]`}
                              >
                                <option value="">Choose somebody</option>
                                {people.map((p) => (
                                  <option key={p.id} value={p.id}>{p.full_name}</option>
                                ))}
                              </select>
                            </label>
                            {i.is_consumable && (
                              <label className="block">
                                <span className="eyebrow">How many</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={issueQty[i.id] ?? "1"}
                                  onChange={(e) => setIssueQty({ ...issueQty, [i.id]: e.target.value })}
                                  className={`${field} mt-1 w-24`}
                                />
                              </label>
                            )}
                            <button
                              onClick={() => issue(i)}
                              disabled={busy || !issueTo[i.id]}
                              className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                            >
                              Issue
                            </button>
                          </div>
                        )}

                        <h3 className="eyebrow mt-4">Who has had it</h3>
                        {history.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">Never issued.</p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-sm">
                            {history.map((a) => (
                              <li key={a.id} className="flex flex-wrap items-center gap-2">
                                <span className={a.returned_on ? "text-muted" : "font-medium"}>
                                  {holderOf(a)}
                                </span>
                                <span className="text-xs text-muted">
                                  {a.quantity > 1 ? `${a.quantity} × · ` : ""}
                                  from {a.issued_on}
                                  {a.returned_on ? ` to ${a.returned_on}` : " — still out"}
                                </span>
                                {!a.returned_on && canEdit && (
                                  <button
                                    onClick={() => takeBack(a, i)}
                                    disabled={busy}
                                    className="text-xs text-accent underline"
                                  >
                                    Take back
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        <p className="mt-3 text-xs text-muted">
                          Returns are recorded rather than erased, so the question asked when
                          something goes missing — who had it in March — still has an answer.
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
