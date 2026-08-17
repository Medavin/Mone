# MOne

AR platform for Momentum. Next.js 14 + Supabase.

**Read `CLAUDE.md` first** — it holds the project's standing decisions and the reasons
behind them. `docs/Momentum_App_Structure_Spec.md` is the full specification.

## Setup

```bash
npm install
cp .env.local.example .env.local     # then paste your own values in
npm run dev
```

Both values come from the Supabase dashboard, Project Settings -> API.
`.env.local` is git-ignored and must never be committed.

## Database

Migrations are in `supabase/migrations/`, run in order in the Supabase SQL Editor.
001-004 are applied. **Run `supabase/VERIFY.sql` after every migration** — the SQL
Editor reporting success does not prove the objects were created.

## What exists

- Login against Supabase Auth, with session refresh in `middleware.ts`
- Route protection: anything outside `/login` redirects when signed out
- `/clinics` — lists clinics, filtered by the database's own policies

## Data rules

- **No real patient data** until the project is transferred to Momentum's accounts.
- Access is enforced in the database, never in the interface.
