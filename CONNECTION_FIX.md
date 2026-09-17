# Why it wouldn't connect

Four separate faults, three of them mine. The first one alone was enough to
make the app unusable no matter how the deployment was configured.

---

## 1. The login deadlock — this is the one that broke it

`checkSchema()` in `src/lib/backend.ts` decided whether the app was
"connected" by calling an allowlisted RPC. But the new API requires a session
for every RPC, and on a cold load nobody is signed in — so the probe got a
401, reported an error, and `hydrateCore()` returned mode `"off"`.

`login()` in `store.tsx` begins with:

```js
if (mode !== "live" || !supabase) {
  return { ok: false, error: "Not connected to Supabase yet — …" };
}
```

So: you can't sign in because the app thinks it isn't connected, and it can't
become connected because signing in is blocked. A closed loop, and nothing in
the UI could tell you that was the shape of it.

This was my error. When I moved everything behind an authenticated API I
didn't account for the one thing that has to work *before* authentication —
the connectivity check itself.

**Fixed:** `checkSchema()` now calls the new unauthenticated `/api/health`,
and `hydrateCore()` treats "connected but signed out" as `live` with an empty
database, which is what the login screen actually is.

## 2. `get_app_bootstrap` was never published

`hydrateCore()` calls it on the boot path, but I only added `get_app_snapshot`
to the allowlist. Every session's first request came back 404 "Unknown
operation". Same for `notify_users` on the write path. Both are now allowlisted.

## 3. The origin check rejected everything

`originAllowed()` compared the `Origin` header against `ALLOWED_ORIGIN`. If
that variable is unset, or set to your production URL while you're on a
preview deployment, or set to the apex while the browser is on www — every
request returns 403 before authentication, with no clue why.

That was a bad design on my part. A same-origin request is, by definition, one
whose Origin matches the host the request arrived on, and the server already
knows its own host. It doesn't need to be told.

**Fixed:** the check now derives the expected origin from the request itself.
Preview URLs, custom domains, www and apex all work with no configuration.
`ALLOWED_ORIGIN` is now optional and purely additive — leave it unset.

## 4. Config drift in the uploaded copy

- `.env.example` had reverted to the `VITE_`-prefixed pair including the live
  anon key. Restored to the server-side variables. (If that key is still the
  active one, rotate it.)
- `vercel.json` had a `functions` block setting `memory`/`maxDuration` — Node
  runtime options that don't apply to Edge Functions, on a glob that also
  matched the shared modules in `api/_lib/`. Removed; each endpoint declares
  its own runtime.
- `vite.config.js` still named `@supabase/supabase-js` in `manualChunks`.
  Nothing in `src/` imports it any more, so that was dragging ~120KB of unused
  library back into the browser bundle.

---

## Check it in ten seconds

Deploy, then open **`https://your-app.vercel.app/api/health`** in a browser.

It's unauthenticated and reports booleans and key *names*, never values. It
tells you which link is broken:

| `stage` | Meaning |
|---|---|
| `ready` | Everything checks out |
| `environment` | A required variable is missing — **and redeploy after adding it**, Vercel only picks up new variables on a new build |
| `connection` | Can't reach the project — check `SUPABASE_URL` has no trailing slash, the project isn't paused, and the anon key belongs to that project |
| `migrations` | Reachable, but functions are missing — apply `0021`–`0026` |

It also shows the `origin` it saw and whether that origin would be accepted,
so a 403 has a visible cause.

If `/api/health` returns the app's HTML instead of JSON, the `api/` directory
isn't being deployed as functions at all — check it's at the repository root,
next to `package.json`.

If it says `ready` and the app still complains, open the Network tab and look
at the first failing `/api/` request; its JSON body carries a specific error
code (`unauthenticated`, `forbidden`, `not_found`, `rate_limited`).

---

## Environment variables

Only four are required. None carry a `VITE_` prefix — that prefix is what
inlines a value into the browser bundle.

```
SUPABASE_URL                 https://<ref>.supabase.co     (no trailing slash)
SUPABASE_ANON_KEY            publishable key
SUPABASE_SERVICE_ROLE_KEY    login + token refresh only
SESSION_SECRET               openssl rand -hex 32
```

`ALLOWED_ORIGIN` is now optional. `UPSTASH_REDIS_REST_URL` / `_TOKEN` are
optional but worth setting before real use — without them, rate limiting is
per serverless instance.
