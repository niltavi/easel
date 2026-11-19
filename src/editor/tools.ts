import {t} from "../lib/i18n.ts";

export type Tool = "select" | "pen" | "eraser" | "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";

export const SHAPE_TOOLS = ["rectangle", "ellipse", "diamond"] as const;
export const CONNECTOR_TOOLS = ["arrow", "line"] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];
export type ConnectorTool = (typeof CONNECTOR_TOOLS)[number];

export const TOOL_LABEL: Record<Tool, string> = {
  select: t("tool.select"),
  pen: t("tool.pen"),
  eraser: t("tool.eraser"),
  rectangle: t("tool.rectangle"),
  ellipse: t("tool.ellipse"),
  diamond: t("tool.diamond"),
  text: t("tool.text"),
  arrow: t("tool.arrow"),
  line: t("tool.line"),
};

// Colours for work content, taken from the Niltavi palette (ink, niltava-600, rufous-600, leaf-600, gold-600, berry-600).
// They are written into work files, so they are stored as fixed colour values and don't follow the UI theme.
export const INKS = [
  {name: t("ink.ink"), value: "#283e38"},
  {name: t("ink.cobalt"), value: "#3a5cf4"},
  {name: t("ink.rufous"), value: "#bf4100"},
  {name: t("ink.leaf"), value: "#00874f"},
  {name: t("ink.gold"), value: "#9a6400"},
  {name: t("ink.berry"), value: "#d30033"},
] as const;
export const DEFAULT_INK = INKS[0].value;

export const WIDTHS = [
  {name: t("width.thin"), value: 1},
  {name: t("width.medium"), value: 2},
  {name: t("width.thick"), value: 4},
] as const;

export type WidthLevel = (typeof WIDTHS)[number]["value"];
export const DEFAULT_WIDTH: WidthLevel = 1;

// The engine scales stroke width up about 4x when drawing freehand strokes, so the same value is much thicker than a shape's line.
// Convert here so the same width level looks consistent across strokes, shapes and connectors.
const PEN_SCALE = 0.5;

/** The stroke width a given width level has when written to a canvas element. */
export const canvasWidth = (level: number, type: string) => (type === "freedraw" ? level * PEN_SCALE : level);

/** Which level a canvas element's stroke width maps to; off-level values in old content take the nearest level. */
export function widthLevel(strokeWidth: number, type: string): WidthLevel {
  const raw = type === "freedraw" ? strokeWidth / PEN_SCALE : strokeWidth;
  return WIDTHS.reduce((best, width) => (Math.abs(width.value - raw) < Math.abs(best - raw) ? width.value : best), WIDTHS[0].value as WidthLevel);
}

/** Number keys 1–6 map in order to the six entries on the toolbar. */
export const TOOL_KEYS = ["1", "2", "3", "4", "5", "6"] as const;
