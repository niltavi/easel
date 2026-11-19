import {describe, expect, it} from "vitest";
import {canvasWidth, DEFAULT_WIDTH, widthLevel, WIDTHS} from "../src/editor/tools.ts";

describe("stroke width levels", () => {
  it("defaults to the thinnest level", () => {
    expect(DEFAULT_WIDTH).toBe(WIDTHS[0].value);
  });

  it("the same level converts to a smaller value on freehand strokes and reads back as the same level", () => {
    for (const {value} of WIDTHS) {
      expect(canvasWidth(value, "rectangle")).toBe(value);
      expect(canvasWidth(value, "freedraw")).toBeLessThan(value);
      expect(widthLevel(canvasWidth(value, "freedraw"), "freedraw")).toBe(value);
      expect(widthLevel(canvasWidth(value, "arrow"), "arrow")).toBe(value);
    }
  });

  it("stroke widths in old content that are not on a level map to the nearest level", () => {
    expect(widthLevel(3, "rectangle")).toBe(2);
    expect(widthLevel(2, "freedraw")).toBe(4);
  });
});
