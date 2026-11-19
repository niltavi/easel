import {describe, expect, it} from "vitest";
import {EaselFileError, parseDocument, serializeDocument} from "../src/lib/file.ts";

const scene = {elements: [{id: "1", type: "rectangle"}], files: {}, view: {scrollX: 10, scrollY: -5, zoom: 1.5}};

describe(".easel file", () => {
  it("reads back exactly what was exported", () => {
    expect(parseDocument(serializeDocument("流程", scene))).toEqual({name: "流程", scene});
  });

  it("rejects files that are not Easel files", () => {
    for (const text of ["not json", "{}", JSON.stringify({type: "excalidraw", version: 2, elements: []})]) {
      expect(() => parseDocument(text)).toThrow(EaselFileError);
    }
  });

  it("rejects files from a newer version and explains why", () => {
    const doc = {...JSON.parse(serializeDocument("x", scene)), version: 99};
    try {
      parseDocument(JSON.stringify(doc));
      expect.unreachable();
    } catch (error) {
      expect((error as EaselFileError).reason).toBe("unsupported_version");
    }
  });

  it("rejects structurally corrupted content", () => {
    const doc = {...JSON.parse(serializeDocument("x", scene)), scene: {elements: [{type: "rectangle"}]}};
    expect(() => parseDocument(JSON.stringify(doc))).toThrow(EaselFileError);
  });
});
