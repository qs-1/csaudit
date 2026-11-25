# Seat alerts

A Cloudflare Worker that tells students when a full section opens. The planner proxies `/api/*` to it (see
`vercel.json`), so the site never talks to another origin and its content security policy stays `'self'`.

- **Once a minute** it sends waiting pushes, then polls the departments someone watches, one request at a time.
  With nothing watched it makes no request to FCCU at all.
- **It backs off** on errors (1, 2, 4 … 30 minutes), stretches its gap when replies get 3x slower than usual, and
  stops for an hour if Cloudflare or the server refuses it. Admin devices get a push when that happens.
- **A watch alerts** when its section goes from full to open, and re-arms when it fills again. At most 6 alerts an
  hour per watch. Alerts expire after 10 minutes if the phone can't be reached.
- **Seat counts live in D1**, never in git. The hourly GitHub Action still commits its own snapshot as before.
- **No accounts.** A device is a random id and a secret kept in the browser. Push is optional.

Measured on the free plan: a poll of two departments uses 4–7 ms of the 10 ms CPU limit, and a push about 0.17 ms.
That's why a run polls at most 4 departments and sends at most 25 pushes.

## Files

| | |
|---|---|
| `src/empower.ts` | Session token, GetList, the seat parser |
| `src/logic.ts` | When to alert, back off, poll (no I/O, tested in `tests/seats.test.ts`) |
| `src/webpush.ts` | Web Push encryption and VAPID signing on WebCrypto |
| `src/poll.ts` | The scheduled run |
| `src/index.ts` | The API and the cron entry point |
| `schema.sql` | Database tables |

## API

| | |
|---|---|
| `GET /api/config` | VAPID public key |
| `GET /api/seats?term=2027SP` | Counts the poller saw in the last 10 minutes |
| `POST /api/devices` `{sub?}` | New device, returns `{id, secret}` |
| `PUT /api/devices/me/push` `{sub}` or `{sub: null}` | Turn push on, re-subscribe, or off |
| `POST /api/devices/me/test` | Send this device a test notification |
| `DELETE /api/devices/me` | Forget this device and its watches |
| `GET /api/watches` | This device's watches with live counts, push and poller status |
| `POST /api/watches` `{term, course, sec, avail}` | Watch a section (checked against `/sections/<term>.json`) |
| `DELETE /api/watches` `{term, course, sec}` | Stop watching |

Device calls send `Authorization: Bearer <id>.<secret>`.

## Setup (once)

```sh
cd seats
npm install
npx wrangler d1 create fccu-seats          # put the database_id in wrangler.jsonc
npm run db:remote                          # create the tables
npm run vapid                              # put VAPID_PUBLIC in wrangler.jsonc; then:
npx wrangler secret put VAPID_JWK          # paste the JSON line
npm run deploy
```

Then set the Worker's URL in `vercel.json` (the `/api/:path*` rewrite) and push the site.

To get "seat checks paused/resumed" alerts on your own phone, turn on notifications in the app, then:

```sh
npx wrangler d1 execute fccu-seats --remote --command "UPDATE devices SET admin = 1 WHERE id = '<id from the Seats tab>'"
```

## Running it locally

```sh
cp .dev.vars.example .dev.vars   # fill in from npm run vapid
npm run db:local
npm run dev                      # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"   # one scheduled run
```

`SITE` in `.dev.vars` can point at a local server for `public/` (e.g. `python -m http.server 5199` there).
The planner's dev server proxies `/api` to port 8787.

## Watching it

```sh
npx wrangler tail fccu-seats                                         # each run's report and CPU time
npx wrangler d1 execute fccu-seats --remote --command "SELECT * FROM events ORDER BY t DESC LIMIT 20"
```
