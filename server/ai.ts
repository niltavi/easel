// Lets the model propose a restricted set of add, update and delete ops on the diagram. The output is validated by shared/diagram.ts before it is returned to the browser.
import Anthropic from "@anthropic-ai/sdk";
import type {Diagram} from "../shared/diagram.ts";

export class AiError extends Error {
  readonly code: "ai_unavailable" | "ai_invalid_output" | "ai_timeout";
  constructor(code: "ai_unavailable" | "ai_invalid_output" | "ai_timeout", message: string) {
    super(message);
    this.code = code;
  }
}

/** Returns the unvalidated list of ops. */
export type AiProvider = (prompt: string, diagram: Diagram, signal: AbortSignal) => Promise<unknown>;

const nullable = (type: string) => ({anyOf: [{type}, {type: "null"}]});
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Structured output requires every field to be present, so "no change" is expressed as null and stripped again in normalize below.
const OUTPUT_SCHEMA = object({
  ops: {
    type: "array",
    items: {
      anyOf: [
        object({
          op: {const: "add_node"},
          id: {type: "string"},
          kind: {enum: ["rectangle", "ellipse", "diamond", "text"]},
          x: {type: "number"},
          y: {type: "number"},
          width: {type: "number"},
          height: {type: "number"},
          text: {type: "string"},
        }),
        object({
          op: {const: "update_node"},
          id: {type: "string"},
          text: nullable("string"),
          x: nullable("number"),
          y: nullable("number"),
          width: nullable("number"),
          height: nullable("number"),
        }),
        object({
          op: {const: "add_edge"},
          id: {type: "string"},
          kind: {enum: ["arrow", "line"]},
          from: {type: "string"},
          to: {type: "string"},
          text: {type: "string"},
        }),
        object({
          op: {const: "update_edge"},
          id: {type: "string"},
          text: nullable("string"),
          from: nullable("string"),
          to: nullable("string"),
        }),
        object({op: {const: "delete"}, id: {type: "string"}}),
      ],
    },
  },
});

const SYSTEM = `You help the user draw and modify flowcharts in a whiteboard app. The user message contains an existing diagram described in JSON and an instruction; you carry out the instruction by returning a list of ops.

Canvas and objects:
- Coordinates are in pixels, x points right and y points down; a node's x and y are its top-left corner.
- Node kinds: rectangle (a step), ellipse (start or end), diamond (a decision), text (standalone explanatory text). A node's text is the label shown inside the shape.
- Edge kinds: arrow (directed) and line. from and to are node ids; an edge's text is the label on the line, for example "approve" or "reject" on the branches of a decision.
- If an existing edge has a null from or to, the user drew it by hand and it is not attached to a node; leave it alone unless the instruction involves it.

Available ops:
- add_node: add a node. Choose the id yourself, using short English or pinyin plus digits; it must not duplicate an existing id.
- update_node: modify an existing node. Fill in only the fields to change and set the rest to null.
- add_edge: add an edge. from and to must be existing nodes or nodes added in this batch.
- update_edge: modify the label or endpoints of an existing edge; set fields that do not change to null.
- delete: delete a node or an edge. When a node is deleted, the edges attached to it are deleted automatically and do not need to be deleted separately.

Layout:
- The canvas also holds handwritten strokes that you cannot see, so change only what the instruction asks for and do not move unrelated nodes just to tidy things up.
- Place a new node near the nodes it relates to, keep a gap of at least 60 pixels from surrounding nodes, and do not overlap existing nodes.
- On a blank canvas start near (0, 0), lay the main flow out top to bottom, and spread branches out to the left and right.
- Typical sizes: rectangle about 160×64, diamond about 180×100, ellipse about 140×60. Widen the node when the label is long.
- Keep the text inside nodes short, and use the same language as the user's instruction.

Ops are executed in order. If the instruction has nothing to do with the flowchart, or cannot be accomplished with these ops, return an empty ops list.`;

function normalize(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as {ops?: unknown}).ops)) {
    throw new AiError("ai_invalid_output", "AI 返回的内容无法识别");
  }
  return (raw as {ops: Array<Record<string, unknown>>}).ops.map((item) => {
    const entries = Object.entries(item).filter(([, value]) => value !== null);
    const op = Object.fromEntries(entries);
    if (op.op === "add_node") {
      const {op: _op, ...node} = op;
      return {op: "add_node", node};
    }
    if (op.op === "add_edge") {
      const {op: _op, ...edge} = op;
      return {op: "add_edge", edge};
    }
    return op;
  });
}

export function createClaudeProvider(env: NodeJS.ProcessEnv): AiProvider {
  const client = new Anthropic();
  const model = env.EASEL_AI_MODEL ?? "claude-opus-5-5";
  const effort = (env.EASEL_AI_EFFORT ?? "low") as "low" | "medium" | "high";
  return async (prompt, diagram, signal) => {
    let response;
    try {
      response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          // When the safety classifier triggers a refusal, the server automatically retries with a different model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: {effort, format: {type: "json_schema", schema: OUTPUT_SCHEMA}},
          system: [{type: "text", text: SYSTEM, cache_control: {type: "ephemeral"}}],
          messages: [
            {
              role: "user",
              content: `<diagram>\n${JSON.stringify(diagram)}\n</diagram>\n\n<instruction>\n${prompt}\n</instruction>`,
            },
          ],
        },
        {signal, maxRetries: 1},
      );
    } catch (error) {
      if (signal.aborted) throw new AiError("ai_timeout", "AI 响应超时");
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        console.error("[easel] invalid AI credentials", error.message);
        throw new AiError("ai_unavailable", "AI 暂时不可用");
      }
      if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
        throw new AiError("ai_unavailable", "AI 正忙，请稍后再试");
      }
      if (error instanceof Anthropic.APIConnectionError) throw new AiError("ai_unavailable", "AI 暂时不可用");
      if (error instanceof Anthropic.APIError) {
        console.error("[easel] AI request failed", error.status, error.message);
        throw new AiError("ai_unavailable", "AI 暂时不可用");
      }
      throw error;
    }
    if (response.stop_reason === "refusal") throw new AiError("ai_invalid_output", "AI 无法处理这条指令");
    if (response.stop_reason === "max_tokens") throw new AiError("ai_invalid_output", "这次改动太大，试着分几步描述");
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiError("ai_invalid_output", "AI 返回的内容无法识别");
    }
    return normalize(parsed);
  };
}

/** Demo implementation used when there are no model credentials; only enabled when EASEL_AI_MOCK=1 is set explicitly. */
export const mockProvider: AiProvider = async (prompt, diagram) => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (diagram.nodes.length === 0) {
    return [
      {op: "add_node", node: {id: "start", kind: "ellipse", x: 20, y: 0, width: 140, height: 60, text: "提交申请"}},
      {op: "add_node", node: {id: "review", kind: "diamond", x: 0, y: 130, width: 180, height: 100, text: "审批"}},
      {op: "add_node", node: {id: "done", kind: "rectangle", x: 10, y: 300, width: 160, height: 64, text: "归档"}},
      {op: "add_node", node: {id: "reject", kind: "rectangle", x: 260, y: 148, width: 160, height: 64, text: "退回修改"}},
      {op: "add_edge", edge: {id: "e1", kind: "arrow", from: "start", to: "review", text: ""}},
      {op: "add_edge", edge: {id: "e2", kind: "arrow", from: "review", to: "done", text: "通过"}},
      {op: "add_edge", edge: {id: "e3", kind: "arrow", from: "review", to: "reject", text: "驳回"}},
    ];
  }
  const anchor = diagram.nodes[0];
  const id = `n${Date.now().toString(36)}`;
  return [
    {op: "update_node", id: anchor.id, text: `${anchor.text || "步骤"}*`},
    {op: "add_node", node: {id, kind: "rectangle", x: anchor.x + anchor.width + 100, y: anchor.y, width: 160, height: 64, text: prompt.slice(0, 12)}},
    {op: "add_edge", edge: {id: `e${id}`, kind: "arrow", from: anchor.id, to: id, text: ""}},
    ...(diagram.edges.length > 1 ? [{op: "delete", id: diagram.edges[diagram.edges.length - 1].id}] : []),
  ];
};
