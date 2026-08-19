"use client";

import { useState } from "react";

import { createCrlEntry } from "./actions";

type Clinic = { id: number; name: string };

export function NewEntryForm({ clinics }: { clinics: Clinic[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createCrlEntry(formData);
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
        New request
      </button>
    );
  }

  return (
    <form action={onSubmit} className="card stack inline-form">
      <div className="form-row">
        <label className="field">
          <span>Clinic</span>
          <select name="clinic_id" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Request from</span>
          <select name="requested_from" required defaultValue="clinic">
            <option value="clinic">Clinic</option>
            <option value="patient">Patient</option>
          </select>
        </label>

        <label className="field">
          <span>Type</span>
          <input
            name="request_type"
            placeholder="e.g. authorisation, demographics"
          />
        </label>
      </div>

      <label className="field">
        <span>What&rsquo;s needed</span>
        <textarea name="detail" rows={3} required />
      </label>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create request"}
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
