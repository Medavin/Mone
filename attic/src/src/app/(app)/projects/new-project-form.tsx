"use client";

import { useState } from "react";

import { createProject } from "./actions";

type Option = { id: string | number; label: string };

export function NewProjectForm({
  people,
  clinics,
}: {
  people: Option[];
  clinics: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createProject(formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        New project
      </button>
    );
  }

  return (
    <form action={onSubmit} className="card stack inline-form">
      <label className="field">
        <span>Name</span>
        <input name="name" required autoFocus />
      </label>

      <div className="form-row">
        <label className="field">
          <span>Owner</span>
          <select name="assigned_to" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Clinic (optional)</span>
          <select name="clinic_id" defaultValue="">
            <option value="">None</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Amount ($)</span>
          <input type="number" name="amount" min="0" step="0.01" />
        </label>
        <label className="field">
          <span>Claims</span>
          <input type="number" name="claim_count" min="0" step="1" />
        </label>
        <label className="field">
          <span>TAT (days)</span>
          <input type="number" name="tat_days" min="1" step="1" />
        </label>
        <label className="field">
          <span>Start</span>
          <input type="date" name="started_on" />
        </label>
      </div>

      <label className="field">
        <span>Detail</span>
        <textarea name="detail" rows={3} />
      </label>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create project"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
