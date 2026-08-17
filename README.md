# MOne

Next.js 14 (app router, TypeScript) front end for the MOne Supabase backend.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase URL and anon key
npm run dev
```

The app runs at http://localhost:3000.

## What's here

| Path | Purpose |
| --- | --- |
| `src/middleware.ts` | Refreshes the Supabase session on every request and redirects signed-out users to `/login` |
| `src/lib/supabase/client.ts` | Supabase client for client components |
| `src/lib/supabase/server.ts` | Supabase client for server components, route handlers and server actions |
| `src/lib/supabase/middleware.ts` | Session refresh + route protection used by the middleware |
| `src/app/login` | Email/password sign-in |
| `src/app/clinics` | Lists rows from the `clinics` table |

## Auth and data access

Auth uses Supabase's cookie-based SSR flow (`@supabase/ssr`), so server components
read the signed-in user directly and queries run under that user's row-level
security policies. Only the anon key is used — there is no service-role key in
this app, and none should be added to `NEXT_PUBLIC_*` variables.

Every route except `/login` and `/auth/*` requires a session; adjust
`PUBLIC_ROUTES` in `src/lib/supabase/middleware.ts` to change that.

The clinics page does `select('*')` and derives its table columns from the rows
it gets back, since the `clinics` schema isn't mirrored in this repo yet. Once
the columns are settled, replace that with an explicit column list and generated
Supabase types.
