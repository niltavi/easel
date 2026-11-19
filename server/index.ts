import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {serve} from "@hono/node-server";
import {serveStatic} from "@hono/node-server/serve-static";
import {Hono} from "hono";
import {createClaudeProvider, mockProvider, type AiProvider} from "./ai.ts";
import {createApp} from "./app.ts";
import {openDatabase} from "./db.ts";
import {createMailer} from "./mail.ts";

const env = process.env;
const port = Number(env.PORT ?? 8787);
const dbPath = resolve(env.EASEL_DB ?? "data/easel.db");
mkdirSync(dirname(dbPath), {recursive: true});

const selfHosted = env.EASEL_SELF_HOSTED === "1";
if (selfHosted) console.log("[easel] self-hosted mode: sign-in uses email and password, and no email is sent");

let ai: AiProvider | null = null;
if (env.EASEL_AI_MOCK === "1") ai = mockProvider;
else if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) ai = createClaudeProvider(env);
else console.log("[easel] ANTHROPIC_API_KEY is not configured; AI features are unavailable");

const api = createApp({
  db: openDatabase(dbPath),
  mailer: createMailer(env),
  ai,
  dailyQuota: Number(env.EASEL_AI_DAILY_QUOTA ?? 5),
  selfHosted,
});

const server = new Hono();
server.route("/", api);

// In production the same process serves the built frontend.
if (existsSync("dist/index.html")) {
  const index = readFileSync("dist/index.html", "utf8");
  server.use("*", serveStatic({root: "dist"}));
  server.get("*", (c) => c.html(index));
}

serve({fetch: server.fetch, port}, () => console.log(`[easel] server started: http://localhost:${port}`));
