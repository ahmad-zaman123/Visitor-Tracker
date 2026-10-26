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

## Using it

- Named link: `https://yoursite.com/?ref=Sara-Acme` shows as "Sara Acme" and is remembered on later visits.
- In code: `tracker.identify('Sara')`, `tracker.track('clicked-resume')`.
- Visitors with Do Not Track on, and bots, are ignored.
- Hits from a domain other than the one registered for the site id are dropped.

## Local dev

`npm i && npx vercel dev` (needs `vercel link` and `vercel env pull` first).
