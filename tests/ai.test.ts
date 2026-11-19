import {beforeEach, describe, expect, it} from "vitest";
import {AiError, type AiProvider} from "../server/ai.ts";
import {createApp} from "../server/app.ts";
import {openDatabase} from "../server/db.ts";

let app: ReturnType<typeof createApp>;
let provider: AiProvider;
let token: string;
let clock: number;
let seen: unknown[];

const goodOps = [{op: "add_node", node: {id: "a", kind: "rectangle", x: 0, y: 0, width: 160, height: 64, text: "开始"}}];
const empty = {nodes: [], edges: []};

const preview = (body: unknown, signal?: AbortSignal) =>
  app.request("/api/ai/preview", {method: "POST", signal, body: JSON.stringify(body), headers: {authorization: `Bearer ${token}`, "content-type": "application/json"}});
const quota = async () => (await (await app.request("/api/ai/quota", {headers: {authorization: `Bearer ${token}`}})).json()) as {remaining: number; resetAt: number};

beforeEach(async () => {
  clock = Date.UTC(2026, 10, 19, 10);
  seen = [];
  provider = async (_prompt, diagram) => {
    seen.push(diagram);
    return goodOps;
  };
  let code = "";
  app = createApp({
    db: openDatabase(":memory:"),
    mailer: async (_email, value) => void (code = value),
    ai: (prompt, diagram, signal) => provider(prompt, diagram, signal),
    dailyQuota: 2,
    aiTimeoutMs: 50,
    now: () => clock,
  });
  const json = {"content-type": "application/json"};
  await app.request("/api/auth/request", {method: "POST", body: JSON.stringify({email: "a@example.com"}), headers: json});
  const res = await app.request("/api/auth/verify", {method: "POST", body: JSON.stringify({email: "a@example.com", code}), headers: json});
  token = ((await res.json()) as {token: string}).token;
});

describe("AI preview endpoint", () => {
  it("requires sign-in", async () => {
    token = "nope";
    expect((await preview({prompt: "x", diagram: empty})).status).toBe(401);
  });

  it("returns validated ops and hands only the diagram structure to the model", async () => {
    const res = await preview({prompt: "画一个流程", diagram: empty});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {ops: unknown[]; quota: {remaining: number}};
    expect(body.ops).toEqual(goodOps);
    expect(body.quota.remaining).toBe(1);
    expect(seen).toEqual([empty]);
  });

  it("failed requests do not consume quota: invalid output, service failure, timeout", async () => {
    provider = async () => [{op: "delete", id: "does-not-exist"}];
    expect((await preview({prompt: "x", diagram: empty})).status).toBe(502);
    provider = async () => {
      throw new AiError("ai_unavailable", "AI 暂时不可用");
    };
    expect((await preview({prompt: "x", diagram: empty})).status).toBe(503);
    provider = (_p, _d, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new AiError("ai_timeout", "超时"))));
    expect((await preview({prompt: "x", diagram: empty})).status).toBe(504);
    expect((await quota()).remaining).toBe(2);
  });

  it("rejects once the quota is used up, and resets the next day", async () => {
    await preview({prompt: "x", diagram: empty});
    await preview({prompt: "x", diagram: empty});
    const res = await preview({prompt: "x", diagram: empty});
    expect(res.status).toBe(429);
    expect(((await res.json()) as {error: string}).error).toBe("quota_exhausted");
    expect(seen).toHaveLength(2);
    clock = (await quota()).resetAt + 1;
    expect((await quota()).remaining).toBe(2);
  });

  it("rejects diagrams with more than 100 objects or a bad format outright, without calling the model", async () => {
    const nodes = Array.from({length: 101}, (_, i) => ({id: `n${i}`, kind: "rectangle", x: 0, y: 0, width: 10, height: 10, text: ""}));
    expect((await preview({prompt: "x", diagram: {nodes, edges: []}})).status).toBe(400);
    expect((await preview({prompt: "x", diagram: {nodes: [{id: "s", kind: "freedraw"}], edges: []}})).status).toBe(400);
    expect((await preview({prompt: "", diagram: empty})).status).toBe(400);
    expect(seen).toEqual([]);
  });
});
