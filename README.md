# Visitor Tracker

A small self-hosted tracker with a dashboard. One deployment tracks any number of sites.
Free to run on Vercel Hobby and Neon.

## What it records

Per event: time, anonymous visitor id (random, stored in the visitor's browser), page, referrer,
country and city (from Vercel's edge headers), device, browser, and a salted hash of the IP.
Raw IPs are never stored. A visitor has a name only if they arrived through a `?ref=Name` link or
your page calls `tracker.identify('Name')`.

## Setup

1. Push this folder to its own GitHub repo and import it in Vercel.
2. In the Vercel project: **Storage → Create → Neon (Postgres)**. This sets `DATABASE_URL`.
3. Add environment variables: `ADMIN_PASSWORD` (login for the dashboard) and `HASH_SALT` (any long random string).
4. Deploy, open the project URL, sign in, click **+ Add site**.
5. Paste the snippet it shows into your site. Tables are created automatically on first use.

## Data retention

A daily Vercel Cron job (`vercel.json`, 03:00 UTC) calls `/api/cleanup`, which deletes events older than
180 days. Set `RETENTION_DAYS` to change it (minimum 30; keep at least 60 so the 30-day comparison works,
and 180 for the 90-day comparison). Add a `CRON_SECRET` environment variable in Vercel (any long random
string): Vercel sends it with each cron call, and the endpoint refuses requests without it. You can also run
a cleanup by hand while signed in, or with `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cleanup`.

## Using it

- Named link: `https://yoursite.com/?ref=Sara-Acme` shows as "Sara Acme" and is remembered on later visits.
- In code: `tracker.identify('Sara')`, `tracker.track('clicked-resume')`.
- Visitors with Do Not Track on, and bots, are ignored.
- Hits from a domain other than the one registered for the site id are dropped.

## Local dev

`npm i && npx vercel dev` (needs `vercel link` and `vercel env pull` first).

## Sign-in

The dashboard password is checked once by `/api/login`, which hands back a signed session that lasts 12 hours.
The password itself is never stored in the browser. After 5 wrong guesses from one address (or 30 from anywhere)
within 15 minutes, sign-in is paused for a while. Changing `ADMIN_PASSWORD` signs everyone out.

## Automatic click events

`t.js` logs these on its own, with no extra code: `clicked-email` (mailto links), `clicked-phone` (tel links),
`downloaded-<file>` (pdf, docx, xlsx, zip and similar, or any link with a `download` attribute) and
`outbound-<site>` (links to other websites). They show up under Custom events and in each visitor's timeline.
Skip one link with `data-track="off"`, or turn it all off with `data-auto="off"` on the script tag.

## Exports and backup

Site settings has a CSV download of one site's events and a JSON backup of every site and event.

## Campaigns

Add `utm_source`, `utm_medium` and/or `utm_campaign` to a link (for example `?utm_source=linkedin&utm_campaign=job-oct`)
and the visit, plus any downloads and clicks that follow in the same tab, are credited to it. The Campaigns card shows
visitors per tag and how many of them downloaded a file or clicked email or phone. The visitor link builder has
"Shared on" and "Campaign" fields that add the tags for you.

## Install as an app

The dashboard is installable: in Chrome or Edge use the install icon in the address bar, on Android "Add to Home screen",
on iPhone Share then "Add to Home Screen". It opens in its own window, and the page itself loads even without a
connection (data needs one, and is never cached).

### Fingerprint / Face ID

After signing in with the password, the dashboard offers to turn on fingerprint or Face ID for that device (it uses
passkeys, so the fingerprint never leaves the phone). Next time, the sign-in page opens the unlock prompt by itself, and
the password stays available as a fallback. Devices are listed, and can be removed, under a site's Settings. The same
wrong-attempt limit applies. Changing `ADMIN_PASSWORD` signs sessions out but does not remove registered devices, so
remove them in Settings if you want them gone.
