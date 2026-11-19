# Easel

[简体中文](docs/README.zh-CN.md)

Easel is a personal whiteboard that works offline. Handwriting, text, shapes, and connectors share one infinite canvas. Works are saved on the device by default. Cloud sync can be turned on for each work, and AI can draw a flowchart or edit an existing one. The interface is in Simplified Chinese.

## Run locally

Use Node.js 24 or later and pnpm.

```sh
pnpm install
pnpm dev:server   # API, http://localhost:8787 by default
pnpm dev          # web app, proxies /api to the server above
```

`pnpm dev` alone is enough for drawing, managing works, and importing or exporting files. Sign-in, cloud sync, and AI need the server. Set `EASEL_API` to point the dev proxy at a server on another address.

See `.env.example` for server settings. Without SMTP settings, the sign-in code is printed in the server log. Without `ANTHROPIC_API_KEY`, AI is unavailable; set `EASEL_AI_MOCK=1` for a local demo that returns a fixed sample edit.

## Build and deploy

```sh
pnpm build        # type-check and write dist/, including the service worker
pnpm server       # one process serves the API and the web app in dist/
```

Data is stored in `data/easel.db` (SQLite).

## Test

```sh
pnpm test
```

The tests cover diagram operation validation, the `.easel` file format, stroke width levels, and the quota and failure handling of the AI endpoint. Sync tests run against a real server: conflicts between two devices, retry after a lost response, deletion in the cloud, expired sessions, sign-out, and switching accounts.

## Code layout

| Directory | Contents |
| --- | --- |
| `shared/` | API contracts, diagram types, and operation validation used by both the browser and the server |
| `src/lib/` | Local data layer: IndexedDB, works, `.easel` files, sign-in, and sync. It does not depend on the UI library |
| `src/editor/` | The canvas. `adapter.ts` converts between Excalidraw data and Easel's own data |
| `src/components/` | The interface, built on HeroUI v3 and the Niltavi theme. `src/theme/` is copied from [niltavi-ui](https://github.com/niltavi/niltavi-ui); do not edit it here |
| `server/` | Hono API: sign-in by email code, work snapshots, and AI previews |

## Sync model

The cloud keeps a full, versioned snapshot of each work. A push names the version that the local content is based on, and the server accepts it only if that version is the latest. The device that pushes late receives a conflict. It saves its own changes as a conflict copy and then pulls the cloud version.

Each push carries a mutation ID in the form `device:revision`, so retrying the same content does not create a new version. Deleting the cloud copy leaves a record without content. A later push from an offline device then gets a clear "removed" response, and its unsent changes become a local copy.
