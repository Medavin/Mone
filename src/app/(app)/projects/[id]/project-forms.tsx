"use client";

import { useState } from "react";

import { addProjectUpdate, reassignProject } from "../actions";

type Option = { id: string; label: string };

export function ProjectForms({
  projectId,
  currentOwner,
  progress,
  people,
}: {
  projectId: number;
  currentOwner: string;
  progress: number;
  people: Option[];
}) {
  const [tab, setTab] = useState<"update" | "reassign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handler(action: (fd: FormData) => Promise<{ error: string | null }>) {
    return async (formData: FormData) => {
      setPending(true);
      setError(null);
      const result = await action(formData);
      setPending(false);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setTab(null);
    };
  }

  if (!tab) {
    return (
      <div className="form-actions spaced">
        <button type="button" onClick={() => setTab("update")}>
          Add update
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setTab("reassign")}
        >
          Reassign
        </button>
      </div>
    );
  }

  return (
    <form
      action={handler(tab === "update" ? addProjectUpdate : reassignProject)}
      className="card stack inline-form"
    >
      <input type="hidden" name="project_id" value={projectId} />

      {tab === "update" ? (
        <label className="field">
          <span>Progress (%)</span>
          <input
            type="number"
            name="progress_pct"
            min="0"
            max="100"
            step="1"
            defaultValue={progress}
          />
        </label>
      ) : (
        <label className="field">
          <span>Reassign to</span>
          <select name="assigned_to" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {people
              .filter((person) => person.id !== currentOwner)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>{tab === "update" ? "Update" : "Why is it moving?"}</span>
        <textarea name="comment" rows={3} required autoFocus />
      </label>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : tab === "update" ? "Post update" : "Reassign"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setTab(null)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
