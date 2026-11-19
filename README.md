# Easel

[简体中文](docs/README.zh-CN.md)

An offline-first personal whiteboard in the Niltavi product family. Handwriting, text, shapes, and connectors share one infinite canvas. Works stay on the device by default; cloud sync is enabled per work, and AI can draw or edit a flowchart with a preview before the change is applied. Easel installs as a PWA and keeps working without a network.

## Get started

`pnpm build` writes the web app to `dist/`, and `pnpm server` serves it together with the API from one process. The server stores accounts and synced works in SQLite at `data/easel.db`. Sign-in uses an email code.

Copy `.env.example` to `.env` to configure the server. SMTP settings deliver sign-in codes; without them, the code is printed in the server log. `ANTHROPIC_API_KEY` enables AI. Drawing, managing works, and importing or exporting `.easel` files do not need the server.

## Development

Requirements: Node.js 24 and pnpm. Install dependencies and run the checks:

```sh
pnpm install
pnpm test
pnpm build
```

Developers start their own local servers: `pnpm dev:server` for the API and `pnpm dev` for the web app, which proxies `/api` to `EASEL_API` (`http://localhost:8787` by default). Set `EASEL_AI_MOCK=1` to try AI edits without a model key.

## Project layout

| Directory | Purpose |
| --- | --- |
| `src/components/` | Interface, built on HeroUI v3 and the Niltavi theme |
| `src/editor/` | Canvas; `adapter.ts` converts between Excalidraw and Easel data |
| `src/lib/` | Local data layer: IndexedDB, works, `.easel` files, sign-in, and sync |
| `src/theme/` | Theme copied from [niltavi-ui](https://github.com/niltavi/niltavi-ui); do not edit it here |
| `shared/` | API contracts, diagram types, and operation validation for browser and server |
| `server/` | Hono API: email-code sign-in, work snapshots, and AI previews |
| `tests/` | Diagram validation, file format, AI quota, and sync against a real server |

The product interface currently uses Chinese. Active development takes place in `niltavi/easel` on [GitHub](https://github.com/niltavi/easel) and [Gitea](https://git.yarinz.com/niltavi/easel).
