# Monthly Lucky Draw — Supabase edition

One public link for viewers, one private admin page for you. **Only the admin can spin.** Visitors automatically watch the same wheel and see the winner afterwards. The design works on phones, tablets and desktops.

## Your two pages

- `/` — public wheel and winner. No sign-in and no participant-management controls.
- `/admin` — sign in, add/edit/activate/remove names, spin, copy the public link, view winner history, and change your password.

The admin uses **names only** for everyday management. One person can win once per calendar month in `Asia/Kolkata`; active names become eligible again next month. History and original winner names remain saved when names are edited or removed.

## Connect your Supabase project once

Your project URL is already saved: `https://ezscaztczotpbuqgurjc.supabase.co`.

If you run `npm start` in your own terminal before the database URI is configured correctly, local startup opens this guided setup automatically and starts the app after it succeeds. An HTTPS project URL belongs in `SUPABASE_URL`; `SUPABASE_DATABASE_URL` needs the PostgreSQL URI from the Connect panel.

1. Open your Supabase project and click **Connect → Session pooler → URI**.
2. Copy the full PostgreSQL URI. Leave `[YOUR-PASSWORD]` as shown; the connection command asks for your database password separately, with both inputs hidden. Copy the host from the dashboard rather than guessing a region.
3. Run the commands below, paste the URI when asked, then enter your Supabase database password. The command tests the connection, saves it privately in `.env.supabase`, and creates the tables and initial admin automatically. No manual table editing or recurring SQL operations are needed.

```powershell
cd D:\nodejs\monthly-lucky-draw
npm ci
npm run connect:supabase
npm start
```

- `cd` opens this project folder.
- `npm ci` installs the exact dependency versions. Skip it if dependencies are already installed.
- `npm run connect:supabase` guides you through connecting once, encodes password symbols automatically, and runs setup. Do not paste the database URI or password in chat.
- `npm run setup:supabase` can rerun setup using the saved connection. It creates the private `lucky_draw` schema, tables, indexes, and first admin, preserving existing participants, winners and admin passwords. No sample names are added.
- `npm start` starts the server. Open **http://127.0.0.1:3000/** to watch, or **http://127.0.0.1:3000/admin** to manage the draw. Press **Ctrl+C** to stop it. `npm run dev` is an alternative that restarts Node when server files change.

The generated initial username/password are in **`.local-admin.txt`**. The setup command reuses that initial login when creating the first Supabase administrator. An existing Supabase admin is never reset by running setup again. Change your password using **Admin → Change password**; enter the current password, a new password of at least 12 characters, and its confirmation. Every older admin session is signed out. The local file is only a record of the initial password and does not change afterwards.

For automated hosting setup you may supply `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` privately instead. Existing accounts still remain unchanged.

## Share it with other people

The **Copy link** button copies the public page address, without admin controls. A `127.0.0.1` address works only on your own computer. For viewers on the internet, deploy the Node app to a Node hosting service or your server and set `APP_ORIGIN` to its HTTPS address. Supabase stores the data; its project URL is not the website address.

The included `Dockerfile` and `render.yaml` prepare a Node deployment. Configure the private `SUPABASE_DATABASE_URL` on the host, `NODE_ENV=production`, `HOST=0.0.0.0`, and the correct HTTPS `APP_ORIGIN`. Run `npm run setup:supabase` once on that host, then start with `npm start`. Do not commit `.env` files or `.local-admin.txt` to a repository. Do not enable public access to the private database schema. Hosting is not deployed merely by creating these files; a confirmed HTTPS URL must be obtained from the chosen host.

## Optional TLS certificate

The PostgreSQL connection always uses verified TLS. The app includes Supabase's public root certificate in `certs/supabase-ca-2021.crt`, alongside Node's standard trusted roots, so ordinary connections need no certificate configuration. For a custom root, download the certificate from Supabase Database settings and set `SUPABASE_SSL_CA` to that local file path. The connection command automatically encodes special password characters. For manual setup, set `SUPABASE_DATABASE_URL` in `.env.supabase` to the full URI with the password percent-encoded, then run `npm run setup:supabase`. The Session pooler works on IPv4 networks and avoids direct-connection IPv6 problems. See [Supabase connection instructions](https://supabase.com/docs/guides/database/connecting-to-postgres).

## What is stored

Only this app's private `lucky_draw` schema is used: `members`, `winners`, `admins`, `sessions`, `requests`, `live_display`, and `draw_lock`. Setup enables row level security, revokes PUBLIC table/schema access, and changes no other application's tables or policies. The server connection is private. The public API exposes names needed by the wheel and the current winner; contact details, password hashes, sessions and full history stay behind administrator authorization. No Supabase service key or database password is sent to the browser.

The server picks each winner using Node `crypto.randomInt()` inside a PostgreSQL transaction. A shared row lock serializes changes across instances, and a database unique constraint independently prevents the same monthly participant from winning twice. Winner history, the public animation snapshot and the retry record commit together; failure rolls them all back. A second intentional draw is blocked while the current animation is active.

Viewers poll the reduced public snapshot every 1.5 seconds. Every device uses server timestamps and the same wheel mapping; a viewer joining mid-spin catches up to its current position. A disconnected viewer reconnects automatically. Reduced-motion preferences suppress wheel motion and confetti while keeping the same winner timing. If an admin request loses its response, **Recover draw** retrieves that interaction's saved result instead of selecting another winner.

Administrator sessions use HttpOnly cookies, CSRF protection, same-origin checks, salted scrypt hashes, request validation, rate limiting and security headers. Requests are parameterized. Names are rendered as text rather than HTML. All persisted draw timestamps are UTC; the configured timezone determines the monthly boundary. The admin history has current/all-month filters and pagination.

## Verification and local preview

```powershell
npm test
npm run check
npm audit
npm run preview:simple
```

- `npm test` checks APIs, passwords and session invalidation, PostgreSQL schema/repository behavior, monthly rules, rollback, retry protection, overlapping draws, public privacy and wheel geometry. PostgreSQL tests use an isolated embedded PostgreSQL engine; they never connect to your Supabase project. That engine has one connection, so live cloud concurrency still requires verification after your private connection is supplied.
- `npm run check` syntax-checks all JavaScript.
- `npm audit` checks dependency advisories.
- `npm run preview:simple` opens a **disposable UI test server**, using fictional names in memory at `http://127.0.0.1:3001`. Admin login: `ui-test` / `local-preview-password`. Nothing here is written to Supabase; changes disappear when this test process stops. Do not use it for real draw history.

The original MySQL files and opt-in `test:mysql` suite are retained as legacy material. **The current application does not use MySQL or Firebase.** The existing main MySQL database remains empty and untouched by this conversion.

## Files

`public/live.html` and `public/js/public-live.js` provide the public page. `public/admin.html` and `public/js/admin.js` provide the private dashboard. Shared timing is in `public/js/live-view.js`, with the Canvas wheel in `wheel.js` and tested geometry in `wheel-math.js`. `src/repositories/supabase-store.js` handles PostgreSQL operations; `database/supabase.sql` defines the isolated schema; `scripts/setup-supabase.js` performs one-time setup. Existing routes, controllers, middleware and services remain separated under `src/`.
"# monthly-lucky-draw" 
