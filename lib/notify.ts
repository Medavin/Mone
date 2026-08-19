import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Telling somebody something happened.
 *
 * ⚠ EVERY FUNCTION HERE SWALLOWS ITS ERRORS ON PURPOSE. Raising a
 * notification must never break the thing that triggered it: if the bell
 * fails, a task should still be created. The alternative — an assignment
 * that fails because the recipient's notification row was rejected — is a
 * far worse bug than a missing notification, and much harder to diagnose.
 */

export type NotifyKind =
  | "task_assigned"
  | "task_completed"
  | "flag_raised"
  | "announcement_published"
  | "assignment_set"
  | "mentioned"
  | "import_undone";

/** What each kind looks like in the list. */
export const KIND_META: Record<string, { icon: string; label: string }> = {
  task_assigned: { icon: "✓", label: "Task" },
  task_completed: { icon: "✓", label: "Task done" },
  flag_raised: { icon: "⚑", label: "Flag" },
  announcement_published: { icon: "▤", label: "Announcement" },
  assignment_set: { icon: "▦", label: "Assignment" },
  mentioned: { icon: "@", label: "Mention" },
  import_undone: { icon: "↺", label: "Import" },
};

export async function notifyUser(
  supabase: SupabaseClient,
  args: {
    to: string;
    kind: NotifyKind;
    title: string;
    body?: string;
    link?: string;
    /** Give one when the same event could fire repeatedly. */
    dedupeKey?: string;
    actorId?: string;
    actorName?: string;
  }
) {
  try {
    await supabase.from("notifications").insert({
      recipient_id: args.to,
      kind: args.kind,
      title: args.title,
      body: args.body ?? null,
      link_url: args.link ?? null,
      dedupe_key: args.dedupeKey ?? null,
      actor_id: args.actorId ?? null,
      actor_name: args.actorName ?? null,
    });
  } catch {
    /* see the note at the top of this file */
  }
}

/** For an alert with no particular owner — whoever manages the place sees it. */
export async function notifyManagement(
  supabase: SupabaseClient,
  args: { kind: NotifyKind; title: string; body?: string; link?: string; dedupeKey?: string }
) {
  try {
    await supabase.from("notifications").insert({
      recipient_id: null,
      kind: args.kind,
      title: args.title,
      body: args.body ?? null,
      link_url: args.link ?? null,
      dedupe_key: args.dedupeKey ?? null,
    });
  } catch {
    /* deliberately silent */
  }
}

/** Several people, one event. Sent as one insert so it is one round trip. */
export async function notifyMany(
  supabase: SupabaseClient,
  recipients: string[],
  args: { kind: NotifyKind; title: string; body?: string; link?: string; actorName?: string }
) {
  const unique = Array.from(new Set(recipients)).filter(Boolean);
  if (unique.length === 0) return;
  try {
    await supabase.from("notifications").insert(
      unique.map((to) => ({
        recipient_id: to,
        kind: args.kind,
        title: args.title,
        body: args.body ?? null,
        link_url: args.link ?? null,
        actor_name: args.actorName ?? null,
      }))
    );
  } catch {
    /* deliberately silent */
  }
}
