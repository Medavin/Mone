/**
 * Shown when a page's table doesn't exist yet.
 *
 * The alternative — collapsing the page to a single error line — hides the
 * feature entirely, so there's no way to see what it does before deciding to
 * create the tables. This keeps the page visible and says precisely what is
 * missing.
 */
export function SchemaNotice({
  feature,
  tables,
  message,
}: {
  feature: string;
  tables: string[];
  message?: string;
}) {
  const missing = message?.includes("does not exist") ?? true;

  if (!missing) {
    return (
      <p className="error" role="alert">
        Could not load {feature}: {message}
      </p>
    );
  }

  return (
    <div className="notice">
      <strong>Not connected yet.</strong>
      <p>
        This is the {feature} screen. It needs{" "}
        {tables.map((t, i) => (
          <span key={t}>
            {i > 0 ? ", " : ""}
            <code>{t}</code>
          </span>
        ))}
        , which {tables.length === 1 ? "does" : "do"} not exist in the database
        yet. Everything below is the real interface — it will work as soon as
        the tables are created.
      </p>
      <p className="muted">
        No data import is involved: the tables start empty and you fill them by
        using the app. Create them with{" "}
        <code>npx supabase db push</code>.
      </p>
    </div>
  );
}
