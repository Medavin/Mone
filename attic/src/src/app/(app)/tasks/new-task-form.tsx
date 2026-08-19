"use client";

import { useState } from "react";

import { createTask } from "./actions";

type Option = { id: string | number; label: string };

export function NewTaskForm({
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
    const result = await createTask(formData);
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
        New task
      </button>
    );
  }

  return (
    <form action={onSubmit} className="card stack inline-form">
      <label className="field">
        <span>Title</span>
        <input name="title" required autoFocus />
      </label>

      <div className="form-row">
        <label className="field">
          <span>Assign to</span>
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

        <label className="field">
          <span>Due</span>
          <input type="date" name="due_date" />
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
          {pending ? "Saving…" : "Create task"}
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
