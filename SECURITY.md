# Security

## Reporting a problem

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repo.
Please don't open a public issue for something that could be abused. I'll reply as soon as I can.

## How the app protects data

- **Dashboard sign-in** is a password checked once by `/api/login`, which returns an HMAC-signed session (12 hours, or 30 days with "keep me signed in"). The password is never stored in the browser. Changing `ADMIN_PASSWORD` signs everyone out.
- **Brute force:** five wrong guesses from one address, or 30 from anywhere, within 15 minutes pause sign-in. Fingerprint sign-in shares the same limit.
- **Passkeys (WebAuthn)** keep the biometric on the device. The server stores only the public key.
- **Visitor data:** raw IPs are never stored, only a salted hash. Visitor ids are random and live in the visitor's browser. Do Not Track is honoured.
- **Tracking endpoint:** `/api/collect` drops bots, drops hits from any domain other than the one registered for the site id, and caps writes per address and per visitor id each minute.
- **Demo mode** (`DEMO_MODE=1`) is read-only, serves generated data only and never reads the database. Its sessions are signed separately and can't act as admin.
- **CSV exports** prefix cells that start with `=`, `+`, `-` or `@` so spreadsheets don't run them as formulas.

## Running your own

Set `ADMIN_PASSWORD`, `HASH_SALT` and `CRON_SECRET` to long random values, keep `DATABASE_URL` out of the repo, and leave `DEMO_MODE` off unless you want a public demo.
