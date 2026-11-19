// .easel native file: JSON with a format version. Cloud snapshots use the same format.
import {t} from "./i18n.ts";
import type {Scene} from "./types.ts";
import {emptyView} from "./types.ts";

export const EASEL_FORMAT_VERSION = 1;
export const EASEL_EXTENSION = ".easel";
export const EASEL_MIME = "application/vnd.niltavi.easel+json";

export interface EaselDocument {
  type: "easel";
  version: number;
  name: string;
  engine: "excalidraw";
  scene: Scene;
}

export class EaselFileError extends Error {
  readonly reason: "invalid" | "unsupported_version";
  constructor(reason: "invalid" | "unsupported_version", message: string) {
    super(message);
    this.reason = reason;
  }
}

export function serializeDocument(name: string, scene: Scene): string {
  const doc: EaselDocument = {
    type: "easel",
    version: EASEL_FORMAT_VERSION,
    name,
    engine: "excalidraw",
    scene: {elements: scene.elements, files: scene.files, view: scene.view},
  };
  return JSON.stringify(doc);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function parseDocument(text: string): {name: string; scene: Scene} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EaselFileError("invalid", t("file.invalid"));
  }
  if (!isRecord(raw) || raw.type !== "easel" || !Number.isInteger(raw.version)) {
    throw new EaselFileError("invalid", t("file.invalid"));
  }
  if ((raw.version as number) > EASEL_FORMAT_VERSION || (raw.version as number) < 1) {
    throw new EaselFileError("unsupported_version", t("file.newer"));
  }
  const scene = raw.scene;
  if (raw.engine !== "excalidraw" || !isRecord(scene) || !Array.isArray(scene.elements)) {
    throw new EaselFileError("invalid", t("file.incomplete"));
  }
  for (const element of scene.elements) {
    if (!isRecord(element) || typeof element.id !== "string" || typeof element.type !== "string") {
      throw new EaselFileError("invalid", t("file.incomplete"));
    }
  }
  const view = isRecord(scene.view) ? scene.view : {};
  const zoom = finite(view.zoom, emptyView.zoom);
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : t("name.untitled"),
    scene: {
      elements: scene.elements,
      files: isRecord(scene.files) ? scene.files : {},
      view: {
        scrollX: finite(view.scrollX, 0),
        scrollY: finite(view.scrollY, 0),
        zoom: zoom > 0.05 && zoom < 40 ? zoom : 1,
      },
    },
  };
}

/** Strip characters that the various platforms don't allow in file names. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 80);
  return cleaned || t("name.untitled");
}
