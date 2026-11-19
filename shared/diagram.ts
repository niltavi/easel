// A neutral representation of the diagram, plus the restricted ops the AI may propose.
// The browser and the server share the same validation; neither side trusts the other's output or the model's.

export const MAX_AI_OBJECTS = 100;
export const MAX_PROMPT_LENGTH = 1000;
const MAX_TEXT_LENGTH = 400;
const MAX_OPS = 200;
const MAX_COORD = 100_000;

export const NODE_KINDS = ["rectangle", "ellipse", "diamond", "text"] as const;
export const EDGE_KINDS = ["arrow", "line"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface DiagramEdge {
  id: string;
  kind: EdgeKind;
  /** The nodes the start and end are bound to; null for unbound edges drawn by hand. */
  from: string | null;
  to: string | null;
  text: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type DiagramOp =
  | {op: "add_node"; node: DiagramNode}
  | {op: "update_node"; id: string; text?: string; x?: number; y?: number; width?: number; height?: number}
  | {op: "add_edge"; edge: DiagramEdge & {from: string; to: string}}
  | {op: "update_edge"; id: string; text?: string; from?: string; to?: string}
  | {op: "delete"; id: string};

export interface OpsSummary {
  added: number;
  updated: number;
  deleted: number;
}

export type ValidationResult =
  | {ok: true; ops: DiagramOp[]; result: Diagram; summary: OpsSummary}
  | {ok: false; error: string};

export function countObjects(diagram: Diagram): number {
  return diagram.nodes.length + diagram.edges.length;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const isSize = (v: unknown): v is number => isCoord(v) && v >= 1 && v <= 4000;

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/**
 * Validates each op in turn and dry-runs it on a copy. If any one is invalid, the whole batch is void.
 * The returned ops contain only whitelisted fields and can be handed straight to the canvas adapter layer.
 */
export function validateOps(diagram: Diagram, raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) return {ok: false, error: "操作列表格式不正确"};
  if (raw.length === 0) return {ok: false, error: "没有可应用的改动"};
  if (raw.length > MAX_OPS) return {ok: false, error: "改动数量超出上限"};

  const nodes = new Map(diagram.nodes.map((n) => [n.id, {...n}]));
  const edges = new Map(diagram.edges.map((e) => [e.id, {...e}]));
  const touched = {added: new Set<string>(), updated: new Set<string>(), deleted: new Set<string>()};
  const ops: DiagramOp[] = [];
  const fail = (index: number, reason: string): ValidationResult => ({ok: false, error: `第 ${index + 1} 条改动无效：${reason}`});

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isRecord(item)) return fail(i, "不是对象");
    switch (item.op) {
      case "add_node": {
        const n = item.node;
        if (!onlyKeys(item, ["op", "node"]) || !isRecord(n)) return fail(i, "缺少节点");
        if (!onlyKeys(n, ["id", "kind", "x", "y", "width", "height", "text"])) return fail(i, "含有不支持的属性");
        if (!isId(n.id) || nodes.has(n.id) || edges.has(n.id)) return fail(i, "节点 id 无效或重复");
        if (!NODE_KINDS.includes(n.kind as NodeKind)) return fail(i, "不支持的节点类型");
        if (!isCoord(n.x) || !isCoord(n.y) || !isSize(n.width) || !isSize(n.height)) return fail(i, "位置或尺寸无效");
        if (!isText(n.text)) return fail(i, "文字无效");
        if (n.kind === "text" && n.text.trim() === "") return fail(i, "文字节点不能为空");
        const node: DiagramNode = {id: n.id, kind: n.kind as NodeKind, x: n.x, y: n.y, width: n.width, height: n.height, text: n.text};
        nodes.set(node.id, node);
        touched.added.add(node.id);
        ops.push({op: "add_node", node});
        break;
      }
      case "update_node": {
        if (!onlyKeys(item, ["op", "id", "text", "x", "y", "width", "height"])) return fail(i, "含有不支持的属性");
        if (!isId(item.id) || !nodes.has(item.id)) return fail(i, "找不到要修改的节点");
        const node = nodes.get(item.id)!;
        const op: DiagramOp = {op: "update_node", id: item.id};
        if (item.text !== undefined) {
          if (!isText(item.text)) return fail(i, "文字无效");
          if (node.kind === "text" && item.text.trim() === "") return fail(i, "文字节点不能为空");
          node.text = op.text = item.text;
        }
        for (const key of ["x", "y"] as const) {
          if (item[key] === undefined) continue;
          if (!isCoord(item[key])) return fail(i, "位置无效");
          node[key] = op[key] = item[key] as number;
        }
        for (const key of ["width", "height"] as const) {
          if (item[key] === undefined) continue;
          if (!isSize(item[key])) return fail(i, "尺寸无效");
          node[key] = op[key] = item[key] as number;
        }
        if (Object.keys(op).length === 2) return fail(i, "没有要修改的内容");
        if (!touched.added.has(node.id)) touched.updated.add(node.id);
        ops.push(op);
        break;
      }
      case "add_edge": {
        const e = item.edge;
        if (!onlyKeys(item, ["op", "edge"]) || !isRecord(e)) return fail(i, "缺少连线");
        if (!onlyKeys(e, ["id", "kind", "from", "to", "text"])) return fail(i, "含有不支持的属性");
        if (!isId(e.id) || nodes.has(e.id) || edges.has(e.id)) return fail(i, "连线 id 无效或重复");
        if (!EDGE_KINDS.includes(e.kind as EdgeKind)) return fail(i, "不支持的连线类型");
        if (!isId(e.from) || !isId(e.to) || !nodes.has(e.from) || !nodes.has(e.to)) return fail(i, "连线两端必须是已有节点");
        if (e.from === e.to) return fail(i, "连线不能连接同一个节点");
        const text = e.text === undefined ? "" : e.text;
        if (!isText(text)) return fail(i, "文字无效");
        const edge = {id: e.id, kind: e.kind as EdgeKind, from: e.from, to: e.to, text};
        edges.set(edge.id, edge);
        touched.added.add(edge.id);
        ops.push({op: "add_edge", edge});
        break;
      }
      case "update_edge": {
        if (!onlyKeys(item, ["op", "id", "text", "from", "to"])) return fail(i, "含有不支持的属性");
        if (!isId(item.id) || !edges.has(item.id)) return fail(i, "找不到要修改的连线");
        const edge = edges.get(item.id)!;
        const op: DiagramOp = {op: "update_edge", id: item.id};
        if (item.text !== undefined) {
          if (!isText(item.text)) return fail(i, "文字无效");
          edge.text = op.text = item.text;
        }
        for (const key of ["from", "to"] as const) {
          if (item[key] === undefined) continue;
          const target = item[key];
          if (!isId(target) || !nodes.has(target)) return fail(i, "连线端点必须是已有节点");
          edge[key] = op[key] = target;
        }
        if (edge.from !== null && edge.from === edge.to) return fail(i, "连线不能连接同一个节点");
        if (Object.keys(op).length === 2) return fail(i, "没有要修改的内容");
        if (!touched.added.has(edge.id)) touched.updated.add(edge.id);
        ops.push(op);
        break;
      }
      case "delete": {
        if (!onlyKeys(item, ["op", "id"]) || !isId(item.id)) return fail(i, "缺少 id");
        const id = item.id;
        if (nodes.has(id)) {
          nodes.delete(id);
          // When a node is deleted, the edges bound to it are removed along with it, so no dangling references are left.
          for (const edge of [...edges.values()]) {
            if (edge.from === id || edge.to === id) {
              edges.delete(edge.id);
              markDeleted(touched, edge.id);
            }
          }
        } else if (edges.has(id)) {
          edges.delete(id);
        } else {
          return fail(i, "找不到要删除的对象");
        }
        markDeleted(touched, id);
        ops.push({op: "delete", id});
        break;
      }
      default:
        return fail(i, "不支持的操作");
    }
  }

  const result: Diagram = {nodes: [...nodes.values()], edges: [...edges.values()]};
  const summary = {added: touched.added.size, updated: touched.updated.size, deleted: touched.deleted.size};
  if (summary.added + summary.updated + summary.deleted === 0) return {ok: false, error: "没有可应用的改动"};
  return {ok: true, ops, result, summary};
}

function markDeleted(touched: {added: Set<string>; updated: Set<string>; deleted: Set<string>}, id: string) {
  // An object that is added and then deleted within the same batch never happened as far as the user is concerned.
  if (touched.added.delete(id)) return;
  touched.updated.delete(id);
  touched.deleted.add(id);
}

/** The diagram in the request body must be validated too: structure, references and count limits. */
export function parseDiagram(raw: unknown): Diagram | null {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  if (raw.nodes.length + raw.edges.length > MAX_AI_OBJECTS) return null;
  const ids = new Set<string>();
  const nodes: DiagramNode[] = [];
  for (const n of raw.nodes) {
    if (!isRecord(n) || !isId(n.id) || ids.has(n.id) || !NODE_KINDS.includes(n.kind as NodeKind)) return null;
    if (!isCoord(n.x) || !isCoord(n.y) || !isCoord(n.width) || !isCoord(n.height) || typeof n.text !== "string") return null;
    ids.add(n.id);
    nodes.push({id: n.id, kind: n.kind as NodeKind, x: n.x, y: n.y, width: n.width, height: n.height, text: n.text.slice(0, MAX_TEXT_LENGTH)});
  }
  const nodeIds = new Set(ids);
  const edges: DiagramEdge[] = [];
  for (const e of raw.edges) {
    if (!isRecord(e) || !isId(e.id) || ids.has(e.id) || !EDGE_KINDS.includes(e.kind as EdgeKind) || typeof e.text !== "string") return null;
    const from = e.from ?? null;
    const to = e.to ?? null;
    if (from !== null && !(isId(from) && nodeIds.has(from))) return null;
    if (to !== null && !(isId(to) && nodeIds.has(to))) return null;
    ids.add(e.id);
    edges.push({id: e.id, kind: e.kind as EdgeKind, from, to, text: e.text.slice(0, MAX_TEXT_LENGTH)});
  }
  return {nodes, edges};
}
