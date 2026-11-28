# Install Easel

Easel is an offline-first whiteboard. One Node.js process serves the web app and the API, and keeps accounts and synced drawings in one SQLite file.

Agree with the operator on the host, the address people will use, and who may reach it. Ask for the email address and password of the first account. If the operator prefers, generate a strong password and hand it over privately, never in a shared log. Without a public HTTPS address, publish the port on loopback only.

## Deploy with Docker

1. Clone `https://github.com/niltavi/easel` and check out the release or commit supplied by the operator. Use `main` when none is given.
2. Build the image and start the container. The named volume holds every account and synced drawing. Retain it on upgrades.

```sh
docker build -t niltavi-easel:local .
docker run -d --name easel --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v easel-data:/app/data \
  niltavi-easel:local
```

Add `-e EASEL_ORIGIN=https://easel.example.com` when the instance has a public address, and `-e ANTHROPIC_API_KEY=…` when the operator supplies a key for AI. See [Settings](#settings). An image built on an Apple Silicon Mac is `arm64`. For an x86 server, build with `docker buildx build --platform linux/amd64 -t niltavi-easel:local .`.

3. Set `EASEL_URL` to the address the operator will open, for example `http://127.0.0.1:8787`, and wait until the API answers:

```sh
curl --fail --silent --show-error "$EASEL_URL/api/auth/config"
```

## Initialize the instance

The first completed registration becomes the instance administrator. Create the operator's account as soon as the server answers, and keep the instance behind a private listener until it exists.

Write the credentials to a file readable only by you, register the account, then delete the file. The password must be 8 to 128 characters. Escape any `"` or `\` in it so the file stays valid JSON.

```sh
(umask 077; printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > admin.json)
curl --fail --silent --show-error -X POST "$EASEL_URL/api/auth/register" \
  -H 'content-type: application/json' --data @admin.json
rm admin.json
```

The operator can instead open `$EASEL_URL/register` and fill in the form themselves.

Sign in at `$EASEL_URL/login` with that account, then open both pages for the operator:

- `$EASEL_URL/admin` is the instance console. **Sign-in** turns email and password sign-in on or off and connects Niltavi Identity. **Accounts** lists accounts and grants or removes the administrator role. **General** sets the public address and the daily AI preview limit.
- `$EASEL_URL/app` is the whiteboard.

Give the operator the instance address, the `/admin` and `/app` links, the administrator email, the image revision, and the result of each check below. Deliver a generated password privately. Easel has no password reset page yet, so ask the operator to keep the password in their password manager.

## Verify the instance

```sh
curl --fail --silent --show-error "$EASEL_URL/api/auth/config"
```

The response should report `"localLogin":true`. In a fresh browser with standard certificate validation, open the public home page, sign in at `/login` with the administrator account, open `/admin` and confirm the account is listed under **Accounts**, then open `/app`, draw a shape, reload, and confirm the drawing is still there. With an authorized test account, also turn on sync for a drawing and open it from a separate browser context.

## Run it on a workstation

Use Node.js 24 or later and pnpm. `pnpm install --frozen-lockfile && pnpm build && pnpm server` serves Easel on `http://localhost:8787`. `pnpm server` reads `.env` from the repository root. Copy `.env.example` to start. Then follow [Initialize the instance](#initialize-the-instance) with `EASEL_URL=http://localhost:8787`.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `EASEL_DB` | `data/easel.db` (`/app/data/easel.db` in the image) | SQLite database file |
| `EASEL_ORIGIN` | unset | Public address of this server, used for Niltavi Identity redirects. The console can override it |
| `IDENTITY_ISSUER`, `IDENTITY_APP_ID`, `IDENTITY_APP_SECRET` | unset | Niltavi Identity credentials. The console can override them |
| `ANTHROPIC_API_KEY` | unset | Enables AI. Without it, everything else works |
| `EASEL_AI_MODEL`, `EASEL_AI_EFFORT` | see `.env.example` | Model and effort for AI edits |
| `EASEL_AI_DAILY_QUOTA` | `5` | AI previews per account per day. The console can override it |

See the [deployment reference](deploy.md) for the full sign-in rules and the [repository guidance](../../AGENTS.md) before proposing source changes.
