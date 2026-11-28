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

## Accounts and sign-in

Drawing, managing drawings, and importing or exporting files work without an account. An account is needed for cloud sync and AI.

The first account created on a server becomes its administrator. Create it right after the first start, at `/register` or with `POST /api/auth/register`. The administrator manages the instance at `/admin`:

- **Sign-in** turns email and password sign-in on or off and connects Niltavi Identity. Email and password sign-in stays on until another method works.
- **Accounts** lists accounts and grants or removes the administrator role. A server always keeps at least one administrator.
- **General** sets the public address and the daily AI preview limit.

With email and password sign-in:

- A password has 8 to 128 characters. It is stored as a salted scrypt hash.
- Anyone who can reach the server can create an account. Put it behind your own network or access control if that is not what you want.
- There is no password reset page yet. Keep the administrator password in a password manager.
- Five wrong passwords for one address lock sign-in for that address for 15 minutes.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `EASEL_DB` | `data/easel.db` (`/app/data/easel.db` in the image) | SQLite database file |
| `EASEL_ORIGIN` | unset | Public address of this server, used for Niltavi Identity redirects. The console can override it |
| `IDENTITY_ISSUER`, `IDENTITY_APP_ID`, `IDENTITY_APP_SECRET` | unset | Niltavi Identity credentials. The console can override them |
| `ANTHROPIC_API_KEY` | unset | Enables AI. Without it, AI is unavailable and everything else works |
| `EASEL_AI_MODEL`, `EASEL_AI_EFFORT` | see `.env.example` | Model and effort for AI edits |
| `EASEL_AI_DAILY_QUOTA` | `5` | AI previews per account per day. The console can override it |
| `EASEL_AI_MOCK` | unset | `1` returns a fixed sample edit without calling a model, for demos |
