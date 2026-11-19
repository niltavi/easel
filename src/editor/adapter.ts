// Adapter layer between the canvas engine (Excalidraw) and Easel's own data.
// The rest of the app only knows Scene, Diagram and DiagramOp, and doesn't depend directly on the engine's element structure.
import {convertToExcalidrawElements, newElementWith, restoreElements} from "@excalidraw/excalidraw";
import type {ExcalidrawElement, ExcalidrawLinearElement, ExcalidrawTextElement} from "@excalidraw/excalidraw/element/types";
import type {ExcalidrawElementSkeleton} from "@excalidraw/excalidraw/data/transform";
import type {AppState, BinaryFiles} from "@excalidraw/excalidraw/types";
import type {Diagram, DiagramEdge, DiagramNode, EdgeKind, NodeKind} from "../../shared/diagram.ts";
import type {Scene} from "../lib/types.ts";

type El = ExcalidrawElement;
type Mutable<T> = {-readonly [K in keyof T]: T[K]};

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const BINDING_GAP = 6;

export function readScene(elements: readonly El[], appState: AppState, files: BinaryFiles): Scene {
  return {
    elements: elements.filter((element) => !element.isDeleted) as unknown[],
    files: files as Record<string, unknown>,
    view: {scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value},
  };
}

/** External content (imported files, cloud snapshots) goes through the engine's own repair before use. */
export function sanitizeScene(scene: Scene): Scene {
  return {...scene, elements: restoreElements(scene.elements as El[], null, {repairBindings: true}) as unknown[]};
}

export const sceneElements = (scene: Scene): El[] => restoreElements(scene.elements as El[], null);

// ---------- Canvas → diagram ----------

const isLinear = (element: El): element is ExcalidrawLinearElement => element.type === "arrow" || element.type === "line";
const isText = (element: El): element is ExcalidrawTextElement => element.type === "text";

/** Extract the structured objects that can be handed to the AI. Freehand strokes, images and the like are excluded. */
export function toDiagram(elements: readonly El[]): Diagram {
  const live = elements.filter((element) => !element.isDeleted);
  const labels = new Map<string, string>();
  for (const element of live) {
    if (isText(element) && element.containerId) labels.set(element.containerId, element.originalText ?? element.text);
  }
  const nodes: DiagramNode[] = [];
  for (const element of live) {
    const base = {id: element.id, x: Math.round(element.x), y: Math.round(element.y), width: Math.round(element.width), height: Math.round(element.height)};
    if (SHAPES.has(element.type)) nodes.push({...base, kind: element.type as NodeKind, text: labels.get(element.id) ?? ""});
    else if (isText(element) && !element.containerId) nodes.push({...base, kind: "text", text: element.originalText ?? element.text});
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: DiagramEdge[] = [];
  for (const element of live) {
    if (!isLinear(element)) continue;
    const from = element.startBinding?.elementId ?? null;
    const to = element.endBinding?.elementId ?? null;
    edges.push({
      id: element.id,
      kind: element.type as EdgeKind,
      from: from && nodeIds.has(from) ? from : null,
      to: to && nodeIds.has(to) ? to : null,
      text: labels.get(element.id) ?? "",
    });
  }
  return {nodes, edges};
}

// ---------- Diagram changes → canvas ----------

export interface ScenePatch {
  /** The full element list after applying the changes. */
  next: El[];
  /** For preview: deleted objects stay visible, just faded. */
  preview: El[];
  added: string[];
  updated: string[];
  deleted: string[];
}

const nodeChanged = (a: DiagramNode, b: DiagramNode) =>
  a.text !== b.text || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;

/** Walk from the node's centre toward the target until the node's edge, then leave a small gap. */
function anchor(node: DiagramNode, towardX: number, towardY: number): [number, number] {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = node.width / 2;
  const hh = node.height / 2;
  let t: number;
  if (node.kind === "ellipse") t = 1 / Math.hypot(dx / hw, dy / hh);
  else if (node.kind === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  const length = Math.hypot(dx, dy);
  const reach = Math.min(1, t + BINDING_GAP / length);
  return [cx + dx * reach, cy + dy * reach];
}

function styleOf(element: El | undefined) {
  if (!element) return {};
  const {strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, angle, groupIds, frameId, locked, link} = element;
  return {strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, angle, groupIds, frameId, locked, link};
}

function build(skeleton: ExcalidrawElementSkeleton): Mutable<El>[] {
  return convertToExcalidrawElements([skeleton], {regenerateIds: false}) as Mutable<El>[];
}

/**
 * Apply a validated result diagram to canvas elements.
 * This diffs the diagram before and after the change: changed nodes and connectors are regenerated by the engine (which handles text measurement and layout),
 * while unchanged elements are left as they are, including all freehand strokes.
 */
export function applyDiagram(elements: readonly El[], before: Diagram, after: Diagram, defaults: {strokeColor: string}): ScenePatch {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const afterEdgeIds = new Set(after.edges.map((edge) => edge.id));

  const replaced = new Map<string, Mutable<El>>();
  const extra: Mutable<El>[] = [];
  const removed = new Set<string>();
  const added: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const fresh = {strokeColor: defaults.strokeColor};

  const labelOf = (containerId: string) =>
    elements.find((element) => isText(element) && element.containerId === containerId && !element.isDeleted) as ExcalidrawTextElement | undefined;

  const put = (built: Mutable<El>[], id: string) => {
    for (const element of built) {
      if (element.id === id) replaced.set(id, element);
      else extra.push(element);
    }
    const oldLabel = labelOf(id);
    if (oldLabel) removed.add(oldLabel.id);
  };

  const movedNodes = new Set<string>();
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (previous && !nodeChanged(previous, node)) continue;
    const existing = byId.get(node.id);
    (previous ? updated : added).push(node.id);
    if (previous && (previous.x !== node.x || previous.y !== node.y || previous.width !== node.width || previous.height !== node.height)) {
      movedNodes.add(node.id);
    }
    if (node.kind === "text") {
      const old = existing as ExcalidrawTextElement | undefined;
      put(
        build({
          ...fresh,
          ...styleOf(existing),
          type: "text",
          id: node.id,
          x: node.x,
          y: node.y,
          text: node.text,
          ...(old ? {fontSize: old.fontSize, fontFamily: old.fontFamily, textAlign: old.textAlign} : {}),
        }),
        node.id,
      );
    } else {
      const oldLabel = labelOf(node.id);
      put(
        build({
          ...fresh,
          ...styleOf(existing),
          type: node.kind as "rectangle",
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          ...(node.text.trim()
            ? {label: {text: node.text, ...(oldLabel ? {fontSize: oldLabel.fontSize, fontFamily: oldLabel.fontFamily, strokeColor: oldLabel.strokeColor} : fresh)}}
            : {}),
        }),
        node.id,
      );
    }
  }

  for (const edge of after.edges) {
    const previous = beforeEdges.get(edge.id);
    const existing = byId.get(edge.id) as ExcalidrawLinearElement | undefined;
    const from = edge.from ? afterNodes.get(edge.from) : undefined;
    const to = edge.to ? afterNodes.get(edge.to) : undefined;
    const rewired = !previous || previous.from !== edge.from || previous.to !== edge.to;
    const relabeled = !previous || previous.text !== edge.text;
    const follows = (edge.from && movedNodes.has(edge.from)) || (edge.to && movedNodes.has(edge.to));
    if (!rewired && !relabeled && !follows) continue;
    if (!previous) added.push(edge.id);
    else if (rewired || relabeled) updated.push(edge.id);

    const oldLabel = labelOf(edge.id);
    const label = edge.text.trim()
      ? {label: {text: edge.text, ...(oldLabel ? {fontSize: oldLabel.fontSize, fontFamily: oldLabel.fontFamily, strokeColor: oldLabel.strokeColor} : fresh)}}
      : {};
    // Connectors attached to nodes at both ends are rerouted from the node positions; the rest keep the shape the user drew.
    const reroute = from && to && (rewired || follows || !existing);
    let geometry: {x: number; y: number; width: number; height: number; points: [number, number][]};
    if (reroute) {
      const [sx, sy] = anchor(from, to.x + to.width / 2, to.y + to.height / 2);
      const [ex, ey] = anchor(to, from.x + from.width / 2, from.y + from.height / 2);
      geometry = {x: sx, y: sy, width: ex - sx, height: ey - sy, points: [[0, 0], [ex - sx, ey - sy]]};
    } else if (existing) {
      geometry = {x: existing.x, y: existing.y, width: existing.width, height: existing.height, points: existing.points.map(([x, y]) => [x, y])};
    } else continue;

    const built = build({
      ...fresh,
      ...styleOf(existing),
      ...(existing ? {startArrowhead: existing.startArrowhead, endArrowhead: existing.endArrowhead} : {}),
      type: edge.kind,
      id: edge.id,
      ...geometry,
      ...label,
    } as ExcalidrawElementSkeleton);
    const line = built.find((element) => element.id === edge.id) as Mutable<ExcalidrawLinearElement> | undefined;
    if (!line) continue;
    line.startBinding = edge.from ? {elementId: edge.from, focus: 0, gap: BINDING_GAP} : null;
    line.endBinding = edge.to ? {elementId: edge.to, focus: 0, gap: BINDING_GAP} : null;
    put(built, edge.id);
  }

  for (const id of [...beforeNodes.keys(), ...beforeEdges.keys()]) {
    if (afterNodes.has(id) || afterEdgeIds.has(id)) continue;
    deleted.push(id);
    removed.add(id);
    const label = labelOf(id);
    if (label) removed.add(label.id);
  }

  // Regenerated elements keep their original layer position, and their version number increments from the existing one.
  const bump = (element: Mutable<El>, old: El | undefined): Mutable<El> => {
    if (old) {
      element.version = old.version + 1;
      element.index = old.index;
    }
    return element;
  };
  const next: Mutable<El>[] = [];
  for (const element of elements) {
    if (removed.has(element.id)) {
      next.push({...element, isDeleted: true, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31)});
    } else if (replaced.has(element.id)) {
      next.push(bump(replaced.get(element.id)!, element));
    } else next.push(element as Mutable<El>);
  }
  for (const element of replaced.values()) if (!byId.has(element.id)) next.push(element);
  next.push(...extra);

  // Shapes record "who is connected to me"; the engine relies on this to move connectors along with a shape.
  const attached = new Map<string, {id: string; type: "arrow" | "text"}[]>();
  const attach = (target: string, ref: {id: string; type: "arrow" | "text"}) => attached.set(target, [...(attached.get(target) ?? []), ref]);
  for (const element of next) {
    if (element.isDeleted) continue;
    if (isText(element) && element.containerId) attach(element.containerId, {id: element.id, type: "text"});
    if (isLinear(element)) {
      if (element.startBinding) attach(element.startBinding.elementId, {id: element.id, type: "arrow"});
      if (element.endBinding && element.endBinding.elementId !== element.startBinding?.elementId) {
        attach(element.endBinding.elementId, {id: element.id, type: "arrow"});
      }
    }
  }
  const final = next.map((element) => {
    if (element.isDeleted || isText(element)) return element;
    const want = attached.get(element.id) ?? [];
    const have = element.boundElements ?? [];
    const same = want.length === have.length && want.every((ref) => have.some((item) => item.id === ref.id));
    if (same) return element;
    const touched = replaced.has(element.id);
    return {...element, boundElements: want.length ? want : null, version: touched ? element.version : element.version + 1} as Mutable<El>;
  });

  const preview = final.map((element) => {
    if (!removed.has(element.id)) return element;
    const original = byId.get(element.id)!;
    return {...original, opacity: 25} as Mutable<El>;
  });

  return {next: final as El[], preview: preview as El[], added, updated, deleted};
}

/** Bounding rectangle of a group of objects in canvas coordinates, used to mark where changes are during preview. */
export function boundsOf(elements: readonly El[], ids: readonly string[]) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return ids.flatMap((id) => {
    const element = byId.get(id);
    if (!element) return [];
    if (isLinear(element)) {
      const xs = element.points.map(([x]) => element.x + x);
      const ys = element.points.map(([, y]) => element.y + y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return [{id, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y}];
    }
    return [{id, x: element.x, y: element.y, width: element.width, height: element.height}];
  });
}

// ---------- Pulling a connector straight from an object's edge ----------

const CONNECTABLE = new Set(["rectangle", "ellipse", "diamond", "text"]);

/** Objects that can be connector endpoints: the three shapes and standalone text. Rotated objects are excluded, so handle positions never mismatch the actual edges. */
export const isConnectable = (element: El) =>
  !element.isDeleted && CONNECTABLE.has(element.type) && element.angle === 0 && !(isText(element) && element.containerId);

const asNode = (element: El): DiagramNode => ({
  id: element.id,
  kind: SHAPES.has(element.type) ? (element.type as NodeKind) : "rectangle",
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  text: "",
});

export type Side = "top" | "right" | "bottom" | "left";

/** Midpoint of one edge of an object (canvas coordinates), shifted outward by offset. */
export function sidePoint(element: {x: number; y: number; width: number; height: number}, side: Side, offset = 0): [number, number] {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  if (side === "top") return [cx, element.y - offset];
  if (side === "bottom") return [cx, element.y + element.height + offset];
  if (side === "left") return [element.x - offset, cy];
  return [element.x + element.width + offset, cy];
}

/**
 * Draw an arrow from one edge of from: if it lands on another object it connects to it, otherwise it stops where the pointer was released.
 * Returns the new element list and the arrow's id; bindings at both ends are written, so the arrow follows when the objects move.
 */
export function connect(
  elements: readonly El[],
  link: {fromId: string; side: Side; toId: string | null; end: [number, number]; strokeColor: string; strokeWidth: number},
): {next: El[]; arrowId: string} | null {
  const from = elements.find((element) => element.id === link.fromId);
  const to = link.toId ? elements.find((element) => element.id === link.toId) : undefined;
  if (!from || !isConnectable(from) || (to && !isConnectable(to))) return null;
  const [sx, sy] = sidePoint(from, link.side, BINDING_GAP);
  const [ex, ey] = to ? anchor(asNode(to), sx, sy) : link.end;
  if (Math.hypot(ex - sx, ey - sy) < 4) return null;
  const built = build({
    type: "arrow",
    x: sx,
    y: sy,
    width: ex - sx,
    height: ey - sy,
    points: [[0, 0], [ex - sx, ey - sy]],
    strokeColor: link.strokeColor,
    strokeWidth: link.strokeWidth,
  } as ExcalidrawElementSkeleton);
  const arrow = built.find((element) => element.type === "arrow") as Mutable<ExcalidrawLinearElement> | undefined;
  if (!arrow) return null;
  arrow.startBinding = {elementId: from.id, focus: 0, gap: BINDING_GAP};
  arrow.endBinding = to ? {elementId: to.id, focus: 0, gap: BINDING_GAP} : null;
  const ends = new Set([from.id, ...(to ? [to.id] : [])]);
  const next = elements.map((element) =>
    ends.has(element.id) ? newElementWith(element, {boundElements: [...(element.boundElements ?? []), {id: arrow.id, type: "arrow"}]}) : element,
  );
  return {next: [...next, ...(built as El[])], arrowId: arrow.id};
}
