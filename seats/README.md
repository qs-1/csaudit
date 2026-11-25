# Seat alerts

A Cloudflare Worker that polls FCCU's course catalog for watched departments once a minute and sends a web push
when a full section opens. The site proxies `/api/*` to it (`middleware.ts`), adding a key the Worker requires.

| file | |
|---|---|
| `src/empower.ts` | Session token, GetList, seat parser |
| `src/logic.ts` | Alert, backoff and polling rules (tested in `tests/seats.test.ts`) |
| `src/webpush.ts` | Web Push encryption and VAPID |
| `src/poll.ts` | The scheduled run |
| `src/index.ts` | API and cron entry |
| `schema.sql` | Tables |

## Setup

```sh
cd seats
npm install
npx wrangler d1 create fccu-seats          # database_id goes in wrangler.jsonc
npm run db:remote
npm run vapid                              # VAPID_PUBLIC goes in wrangler.jsonc
npx wrangler secret put VAPID_JWK          # paste the JSON line
npx wrangler queues create fccu-pushes     # pushes fan out through it, 25 to a message
npx wrangler secret put PROXY_KEY          # same value as SEATS_PROXY_KEY in the Vercel project
npm run deploy
```

Admin device (gets "checks paused" pushes):

```sh
npx wrangler d1 execute fccu-seats --remote --command "UPDATE devices SET admin = 1 WHERE id = '<id>'"
```

Locally:

```sh
cp .dev.vars.example .dev.vars             # fill in from npm run vapid
npm run db:local
npm run dev                                # http://127.0.0.1:8787, the site's dev server proxies /api here
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

## API

Device calls send `Authorization: Bearer <id>.<secret>`.

| | |
|---|---|
| `GET /api/config` | VAPID public key |
| `GET /api/seats?term=2027SP` | Counts checked in the last 10 minutes |
| `POST /api/devices` `{sub?}` | New device: `{id, secret}` |
| `PUT /api/devices/me/push` `{sub}` / `{sub: null}` | Push on or off |
| `POST /api/devices/me/test` | Test push |
| `DELETE /api/devices/me` | Forget device and watches |
| `GET /api/watches` | Watches with counts, push and poller state |
| `POST /api/watches` `{term, course, sec, avail}` | Watch |
| `DELETE /api/watches` `{term, course, sec}` | Unwatch |
| `POST /api/admin/probe?term=2027SP` | Admin: one whole-term fetch, for CPU time |

## Watching it

```sh
npx wrangler tail fccu-seats
npx wrangler d1 execute fccu-seats --remote --command "SELECT * FROM events ORDER BY t DESC LIMIT 20"
```
