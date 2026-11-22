# Deploying Easel

[简体中文](../zh-CN/deploy.md) · [Repository](../../README.md)

Easel runs as one Node.js process that serves the web app and the API, and stores accounts and synced drawings in one SQLite file.

## Docker

Build the image from the repository root:

```sh
docker build -t niltavi-easel:local .
```

Run it with a volume for the database:

```sh
docker run -d --name easel -p 8787:8787 \
  -v easel-data:/app/data \
  -e EASEL_SELF_HOSTED=1 \
  niltavi-easel:local
```

Open `http://localhost:8787`. The container runs as the `node` user and listens on port 8787. The database is `/app/data/easel.db`; back up the volume to back up every account and synced drawing.

An image built on an Apple Silicon Mac is `arm64`. For an x86 server, build with `docker buildx build --platform linux/amd64 -t niltavi-easel:local .`.

## Without Docker

Use Node.js 24 or later and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm server
```

`pnpm server` reads settings from `.env` in the repository root. Copy `.env.example` to start.

## Sign-in modes

Drawing, managing drawings, and importing or exporting files work without an account. An account is needed for cloud sync and AI.

| | Default | Self-hosted |
| --- | --- | --- |
| Setting | `EASEL_SELF_HOSTED` unset | `EASEL_SELF_HOSTED=1` |
| Sign in with | A 6-digit code emailed to the address | Email and password |
| Creating an account | Verifying the first code | The **Create an account** form in the sign-in dialog |
| Needs a mail service | Yes, `EASEL_SMTP_URL` | No. No email is sent |
| Email address | Verified | Recorded as unverified |

Choose self-hosted mode for a local or private deployment that has no mail service. Keep the default for a public service.

In self-hosted mode:

- A password has 8 to 128 characters. It is stored as a salted scrypt hash.
- Anyone who can reach the server can create an account. Put it behind your own network or access control if that is not what you want.
- There is no password reset, because the server sends no email. To reset one, delete the user's row from the `users` table and let them register again; their synced drawings are tied to the old account.
- The emailed-code endpoints are turned off.
- Five wrong passwords for one address lock sign-in for that address for 15 minutes.

Production email-code sign-in requires `EASEL_SMTP_URL`. A development server without SMTP prints codes to its log.

Switching an existing deployment from self-hosted to the default mode keeps the accounts. Their addresses stay unverified until the owner signs in with an emailed code, and their passwords are no longer accepted.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `EASEL_DB` | `data/easel.db` (`/app/data/easel.db` in the image) | SQLite database file |
| `EASEL_SELF_HOSTED` | unset | `1` turns on email and password sign-in without email |
| `EASEL_SMTP_URL` | unset | SMTP server for sign-in codes in the default mode, for example `smtps://user:pass@smtp.example.com:465` |
| `EASEL_MAIL_FROM` | `Easel <no-reply@localhost>` | Sender of sign-in emails |
| `ANTHROPIC_API_KEY` | unset | Enables AI. Without it, AI is unavailable and everything else works |
| `EASEL_AI_MODEL`, `EASEL_AI_EFFORT` | see `.env.example` | Model and effort for AI edits |
| `EASEL_AI_DAILY_QUOTA` | `5` | AI previews per account per day |
| `EASEL_AI_MOCK` | unset | `1` returns a fixed sample edit without calling a model, for demos |
