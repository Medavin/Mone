# attic — not part of the app

Nothing in here is compiled, routed or shipped. `tsconfig.json` excludes it.

- `src/` — an earlier, abandoned scaffold (a different `src/app` router tree with
  its own login, clinics, CRL, projects, reports and tasks pages). Next.js
  ignores `src/app` because `app/` exists at the repo root, so none of it has
  ever been reachable in the browser — but `tsc` still type-checked it, and it
  was FAILING `npm run build` (`Cannot find module '@/lib/format'`). Moved here
  rather than deleted, in case anything in it is worth lifting later.
- `t10.ts` — a throwaway parser test harness that reads a file path which only
  existed inside a Claude sandbox.
