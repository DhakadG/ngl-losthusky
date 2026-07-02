# losthusky inbox

A personal message-inbox web app (ngl-style UX) on Cloudflare Workers + D1.
Senders get a clean message page; the owner gets a password-protected dashboard
with an inbox, per-sender analytics, link creation, push notifications, and
share-to-Instagram-story.

> **Consent by design.** The send page shows a clear notice that messages are
> **not anonymous** and that the recipient can see approximate location, device,
> and network. Collection is IP/header-level only (same class of data Google
> uses for localized results) — no GPS prompt, no covert device access.

## What gets captured (per view + message)

- IP address + Cloudflare geo: country, region, city, approx lat/long, timezone, postal
- ISP / carrier name + ASN (from the IP)
- Browser + version, OS + version
- Device model (Android only — Apple hides the exact iPhone model)
- "Opened from": Instagram / Snapchat / TikTok / etc. in-app browser vs a real browser
- Language, screen size, referrer
- Repeat-sender grouping via a first-party `visitorId` cookie (+ server fingerprint fallback)
- Optional self-declared `@handle` field on the send form

**Not possible from a web link (won't pretend otherwise):** a visitor's real
Instagram username, or their WiFi network name. Both require phishing or an
installed app. Use the optional `@handle` field or an OAuth login for identity.

## Stack

- Cloudflare Worker (`src/index.js`) — router + capture + admin API
- D1 (SQLite) — `links`, `visitors`, `events`, `messages`
- Static assets in `public/` — send page + admin dashboard
- Auth — PBKDF2 password hash + HMAC-signed session cookie (both are secrets)

## Setup

```bash
npm install

# 1. Create the D1 database, then paste its id into wrangler.jsonc
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 create losthusky_inbox
#   -> copy "database_id" into wrangler.jsonc

# 2. Create the schema
npm run db:init

# 3. Generate + set secrets (never commit these)
npm run hash-password -- "your-strong-password"      # copy the pbkdf2$... line
npx wrangler secret put ADMIN_PASSWORD_HASH          # paste it
npm run gen-secret                                   # copy the random string
npx wrangler secret put SESSION_SECRET               # paste it

# 4. Deploy to ngl.losthusky.qzz.io
npm run deploy
```

## Push notifications (new message + every view)

`NOTIFY_ON_VIEW` is already `"true"`, so you get pinged on views too. Pick one:

### Telegram (recommended, free, instant)
1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Message your new bot once (say "hi"), then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy the
   `"chat":{"id": ...}` number — that's your **chat id**.
3. Set both secrets and redeploy:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN   # paste the token
   npx wrangler secret put TELEGRAM_CHAT_ID     # paste the chat id
   npm run deploy
   ```

### Or a Discord/Slack webhook
```bash
npx wrangler secret put NOTIFY_WEBHOOK_URL      # paste the webhook URL
npm run deploy
```

> I can't set these for you — the token comes from your own Telegram account.

## Upgrading an existing database

If the DB was created before the device-signal columns were added:
```bash
npx wrangler d1 execute losthusky_inbox --file=./scripts/migrate-001.sql --remote
```

For local dev, copy `.dev.vars.example` to `.dev.vars`, fill it, and run `npm run dev`.

## Security / repo hygiene

- `wrangler.jsonc`, `.dev.vars`, and all secrets are **gitignored**.
- Only `wrangler.example.jsonc` (with placeholders) is committed.
- Admin password + session secret live in Cloudflare Secrets, never in code.
- The admin HTML shell is public but useless without the password; all data
  endpoints require a valid session.
- Rate limiting + max message length guard the public send endpoint.

## Usage

- Owner page: `https://ngl.losthusky.qzz.io/`
- Extra links: dashboard → **+ New link** → `https://ngl.losthusky.qzz.io/<slug>`
- Dashboard: `https://ngl.losthusky.qzz.io/admin`
