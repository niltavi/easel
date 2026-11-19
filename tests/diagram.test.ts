import {describe, expect, it} from "vitest";
import {parseDiagram, validateOps, type Diagram} from "../shared/diagram.ts";

const diagram: Diagram = {
  nodes: [
    {id: "a", kind: "rectangle", x: 0, y: 0, width: 160, height: 64, text: "Submit"},
    {id: "b", kind: "diamond", x: 0, y: 140, width: 180, height: 100, text: "Review"},
  ],
  edges: [{id: "e1", kind: "arrow", from: "a", to: "b", text: ""}],
};

describe("validateOps", () => {
  it("accepts adds, updates and deletes, and returns a summary", () => {
    const result = validateOps(diagram, [
      {op: "add_node", node: {id: "c", kind: "rectangle", x: 260, y: 150, width: 160, height: 64, text: "Reject"}},
      {op: "add_edge", edge: {id: "e2", kind: "arrow", from: "b", to: "c", text: "Reject"}},
      {op: "update_node", id: "a", text: "Submit request"},
      {op: "delete", id: "e1"},
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({added: 2, updated: 1, deleted: 1});
    expect(result.result.nodes.find((n) => n.id === "a")?.text).toBe("Submit request");
  });

  it("deleting a node also deletes the edges bound to it", () => {
    const result = validateOps(diagram, [{op: "delete", id: "b"}]);
    expect(result.ok && result.summary.deleted).toBe(2);
    expect(result.ok && result.result.edges).toEqual([]);
  });

  it.each([
    ["reference to a missing node", [{op: "add_edge", edge: {id: "e9", kind: "arrow", from: "a", to: "nope", text: ""}}]],
    ["duplicate id", [{op: "add_node", node: {id: "a", kind: "rectangle", x: 0, y: 0, width: 10, height: 10, text: ""}}]],
    ["unsupported property", [{op: "update_node", id: "a", strokeColor: "red"}]],
    ["unsupported kind", [{op: "add_node", node: {id: "z", kind: "image", x: 0, y: 0, width: 10, height: 10, text: ""}}]],
    ["unsupported op", [{op: "run_script", id: "a"}]],
    ["non-finite number", [{op: "update_node", id: "a", x: Number.NaN}]],
    ["empty ops", []],
    ["not an array", {ops: []}],
  ])("rejects: %s", (_name, ops) => {
    expect(validateOps(diagram, ops).ok).toBe(false);
  });

  it("any single invalid op voids the whole batch", () => {
    const result = validateOps(diagram, [{op: "update_node", id: "a", text: "ok"}, {op: "delete", id: "missing"}]);
    expect(result.ok).toBe(false);
  });
});

describe("parseDiagram", () => {
  it("rejects more than 100 objects", () => {
    const nodes = Array.from({length: 101}, (_, i) => ({id: `n${i}`, kind: "rectangle", x: 0, y: 0, width: 10, height: 10, text: ""}));
    expect(parseDiagram({nodes, edges: []})).toBeNull();
    expect(parseDiagram({nodes: nodes.slice(0, 100), edges: []})).not.toBeNull();
  });

  it("rejects dangling edge references", () => {
    expect(parseDiagram({nodes: [], edges: [{id: "e", kind: "arrow", from: "x", to: null, text: ""}]})).toBeNull();
  });
});
