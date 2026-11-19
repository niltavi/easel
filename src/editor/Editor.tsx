import {CaptureUpdateAction, Excalidraw, exportToBlob, getSceneVersion, mutateElement, newElementWith} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {ExcalidrawElement} from "@excalidraw/excalidraw/element/types";
import type {AppState as CanvasState, BinaryFiles, ExcalidrawImperativeAPI} from "@excalidraw/excalidraw/types";
import {useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref} from "react";
import type {Diagram, OpsSummary} from "../../shared/diagram.ts";
import {serializeDocument} from "../lib/file.ts";
import {locale, t} from "../lib/i18n.ts";
import {currentWork, editor as editorBridge, getState, notify} from "../lib/state.ts";
import {scheduleSync} from "../lib/sync.ts";
import type {Scene} from "../lib/types.ts";
import {loadScene, saveScene} from "../lib/works.ts";
import {applyDiagram, boundsOf, isConnectable, readScene, sceneElements, toDiagram, type ScenePatch} from "./adapter.ts";
import {ConnectHandles} from "./Connect.tsx";
import {downloadBlob, easelFileName} from "./download.ts";
import {canvasWidth, DEFAULT_INK, DEFAULT_WIDTH, widthLevel, type Tool} from "./tools.ts";

export interface EditorUi {
  tool: Tool;
  selected: number;
  strokeColor: string;
  strokeWidth: number;
  preview: OpsSummary | null;
}

export interface EditorHandle {
  setTool(tool: Tool): void;
  setStroke(change: {color?: string; width?: number}): void;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  fit(): void;
  /** The diagram currently on the canvas, plus a version number used to tell "did the content change during the request". */
  diagram(): {diagram: Diagram; version: number};
  contentVersion(): number;
  startPreview(before: Diagram, after: Diagram): void;
  applyPreview(): Promise<void>;
  cancelPreview(): void;
  exportPng(): Promise<void>;
}

interface Loaded {
  key: string;
  id: string;
  scene: Scene;
}

interface Preview {
  original: readonly ExcalidrawElement[];
  view: {scrollX: number; scrollY: number; zoom: CanvasState["zoom"]};
  patch: ScenePatch;
}

const TOOL_TO_CANVAS: Record<Tool, string> = {
  select: "selection",
  pen: "freedraw",
  eraser: "eraser",
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  text: "text",
  arrow: "arrow",
  line: "line",
};
const CANVAS_TO_TOOL = Object.fromEntries(Object.entries(TOOL_TO_CANVAS).map(([tool, canvas]) => [canvas, tool])) as Record<string, Tool>;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const viewSignature = (state: CanvasState) => `${Math.round(state.scrollX)},${Math.round(state.scrollY)},${state.zoom.value.toFixed(3)}`;

interface Props {
  workId: string;
  nonce: number;
  theme: "light" | "dark";
  onUi: (ui: EditorUi) => void;
  ref: Ref<EditorHandle>;
}

export function Editor({workId, nonce, theme, onUi, ref}: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [previewing, setPreviewing] = useState<ScenePatch | null>(null);
  const [, repaint] = useState(0);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const uiRef = useRef<EditorUi | null>(null);
  const pointerType = useRef("mouse");
  // The currently selected width level. Converted per tool when written to the canvas, see canvasWidth.
  const level = useRef<number>(DEFAULT_WIDTH);
  const [canvasTool, setCanvasTool] = useState<Tool>("select");
  const [linkable, setLinkable] = useState<string | null>(null);
  // Sample points we record ourselves during a freehand stroke, denser than what the engine records per frame.
  const stroke = useRef<{pointerId: number; zoom: number; scrollX: number; scrollY: number; left: number; top: number; samples: [number, number, number][]} | null>(null);
  // The persisted content version and viewport; baseline is set in the first callback after the canvas initializes.
  const saved = useRef<{version: number | null; view: string}>({version: null, view: ""});
  const pending = useRef<{timer: ReturnType<typeof setTimeout>; content: boolean} | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadScene(workId).then((scene) => {
      if (cancelled) return;
      // When the same work is replaced by the cloud version, drop the saves queued for the old content.
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      previewRef.current = null;
      setPreviewing(null);
      saved.current = {version: null, view: ""};
      const next = {key: `${workId}:${nonce}`, id: workId, scene};
      loadedRef.current = next;
      setLoaded(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workId, nonce]);

  const publishUi = useCallback(
    (state: CanvasState) => {
      const selected = Object.keys(state.selectedElementIds).length;
      // With a selection, the properties bar shows its colour and width rather than the settings for the next stroke.
      const first = selected ? apiRef.current?.getSceneElements().find((element) => state.selectedElementIds[element.id]) : undefined;
      const next: EditorUi = {
        tool: CANVAS_TO_TOOL[state.activeTool.type] ?? "select",
        selected,
        strokeColor: first?.strokeColor ?? state.currentItemStrokeColor,
        strokeWidth: first && first.type !== "text" ? widthLevel(first.strokeWidth, first.type) : level.current,
        preview: previewRef.current
          ? {added: previewRef.current.patch.added.length, updated: previewRef.current.patch.updated.length, deleted: previewRef.current.patch.deleted.length}
          : null,
      };
      setCanvasTool(next.tool);
      setLinkable(selected === 1 && first && isConnectable(first) ? first.id : null);
      const prev = uiRef.current;
      if (prev && prev.tool === next.tool && prev.selected === next.selected && prev.strokeColor === next.strokeColor && prev.strokeWidth === next.strokeWidth && !prev.preview === !next.preview) return;
      uiRef.current = next;
      onUi(next);
    },
    [onUi],
  );

  const save = useCallback(async (content: boolean) => {
    const api = apiRef.current;
    const target = loadedRef.current;
    if (!api || !target) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const state = api.getAppState();
    const version = getSceneVersion(elements);
    const ok = await saveScene(target.id, readScene(elements, state, api.getFiles()), content);
    if (!ok) return;
    saved.current = {version, view: viewSignature(state)};
    if (content && currentWork()?.cloud) scheduleSync();
  }, []);

  const cancelPreview = useCallback(() => {
    const api = apiRef.current;
    const preview = previewRef.current;
    if (!api || !preview) return;
    previewRef.current = null;
    api.updateScene({elements: preview.original, appState: preview.view, captureUpdate: CaptureUpdateAction.NEVER});
    setPreviewing(null);
    publishUi(api.getAppState());
  }, [publishUi]);

  const flush = useCallback(async () => {
    // What's shown during a preview isn't work content; restore the original first.
    cancelPreview();
    const job = pending.current;
    if (!job) return;
    clearTimeout(job.timer);
    pending.current = null;
    await save(job.content);
  }, [cancelPreview, save]);

  const schedule = useCallback(
    (content: boolean, delay: number) => {
      const wasContent = pending.current?.content ?? false;
      if (pending.current) clearTimeout(pending.current.timer);
      const job = {
        content: content || wasContent,
        timer: setTimeout(() => {
          pending.current = null;
          void save(job.content);
        }, delay),
      };
      pending.current = job;
    },
    [save],
  );

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], state: CanvasState, _files: BinaryFiles) => {
      publishUi(state);
      // On tool change, convert the "next stroke width" into this tool's value so every tool draws equally thick.
      const width = canvasWidth(level.current, state.activeTool.type);
      if (state.currentItemStrokeWidth !== width) apiRef.current?.updateScene({appState: {currentItemStrokeWidth: width}});
      if (previewRef.current) return;
      const version = getSceneVersion(elements);
      if (saved.current.version === null) {
        saved.current = {version, view: viewSignature(state)};
        return;
      }
      if (version !== saved.current.version || getState().save === "failed") schedule(true, 500);
      else if (viewSignature(state) !== saved.current.view) schedule(false, 900);
    },
    [publishUi, schedule],
  );

  const exportFile = useCallback(() => {
    const api = apiRef.current;
    const work = currentWork();
    if (!api || !work) return;
    const scene = readScene(previewRef.current?.original ?? api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
    downloadBlob(new Blob([serializeDocument(work.name, scene)], {type: "application/json"}), easelFileName(work.name));
  }, []);

  useEffect(() => {
    editorBridge.flush = flush;
    editorBridge.exportFile = exportFile;
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      editorBridge.flush = async () => {};
      editorBridge.exportFile = () => {};
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush, exportFile]);

  /** Record every sample point in a pointer event (the browser coalesces multiple moves within a frame into one event). */
  const sample = useCallback((event: PointerEvent) => {
    const current = stroke.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const batch = event.getCoalescedEvents?.() ?? [];
    for (const item of batch.length ? batch : [event]) {
      const x = (item.clientX - current.left) / current.zoom - current.scrollX;
      const y = (item.clientY - current.top) / current.zoom - current.scrollY;
      const last = current.samples[current.samples.length - 1];
      // Skip points less than half a screen pixel apart, so high-report-rate mice don't bloat the stroke.
      if (last && Math.hypot(x - last[0], y - last[1]) * current.zoom < 0.5) continue;
      current.samples.push([x, y, item.pressure || 0.5]);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", sample, {capture: true, passive: true});
    return () => window.removeEventListener("pointermove", sample, {capture: true});
  }, [sample]);

  const bindApi = useCallback((api: ExcalidrawImperativeAPI | null) => {
    apiRef.current = api;
    if (!api) return;
    api.onPointerDown((tool, _state, event) => {
      pointerType.current = event.pointerType;
      stroke.current = null;
      if (tool.type !== "freedraw" || !event.isPrimary) return;
      const state = api.getAppState();
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      stroke.current = {pointerId: event.pointerId, zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY, left: box.left, top: box.top, samples: []};
      sample(event.nativeEvent);
    });
    api.onPointerUp((tool) => {
      const recorded = stroke.current;
      stroke.current = null;
      if (tool.type !== "freedraw") return;
      const elements = api.getSceneElements();
      const drawn = elements[elements.length - 1];
      if (drawn?.type !== "freedraw") return;
      const pen = pointerType.current === "pen";
      // The engine records only one point per frame, so fast writing leaves corners in the stroke. Replace them with all the sample points we recorded for a smoother line.
      const samples = recorded?.samples ?? [];
      const first = samples[0];
      const aligned = first && Math.hypot(first[0] - drawn.x, first[1] - drawn.y) < 2;
      if (aligned && samples.length > drawn.points.length + 1) {
        mutateElement(drawn, {
          points: samples.map(([x, y]) => [x - drawn.x, y - drawn.y]),
          // Pressure-sensitive pens keep their real pressure; mouse and finger use a steady width with no simulated pressure variation.
          pressures: pen ? samples.map(([, , pressure]) => pressure) : [],
          simulatePressure: false,
        } as never);
      } else if (!pen && drawn.simulatePressure) {
        mutateElement(drawn, {simulatePressure: false, pressures: []} as never);
      }
    });
    api.onScrollChange(() => {
      if (previewRef.current) repaint((n) => n + 1);
    });
  }, [sample]);

  const getApi = useCallback(() => apiRef.current, []);

  const key = useCallback((init: KeyboardEventInit) => {
    const target = containerRef.current?.querySelector(".excalidraw");
    target?.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init}));
  }, []);

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      setTool(tool) {
        apiRef.current?.setActiveTool({type: TOOL_TO_CANVAS[tool] as "selection"});
      },
      setStroke({color, width}) {
        const api = apiRef.current;
        if (!api) return;
        const state = api.getAppState();
        if (width) level.current = width;
        const selected = state.selectedElementIds;
        const elements = api.getSceneElements();
        const targets = new Set(elements.filter((element) => selected[element.id]).map((element) => element.id));
        api.updateScene({
          appState: {
            currentItemStrokeColor: color ?? state.currentItemStrokeColor,
            currentItemStrokeWidth: canvasWidth(level.current, state.activeTool.type),
          },
          ...(targets.size
            ? {
                elements: api.getSceneElementsIncludingDeleted().map((element) => {
                  const isTarget = targets.has(element.id);
                  const isLabel = element.type === "text" && element.containerId !== null && targets.has(element.containerId);
                  if (!isTarget && !(isLabel && color)) return element;
                  return newElementWith(element, {
                    ...(color ? {strokeColor: color} : {}),
                    ...(width && isTarget && element.type !== "text" ? {strokeWidth: canvasWidth(width, element.type)} : {}),
                  });
                }),
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              }
            : {}),
        });
      },
      undo: () => key({key: "z", code: "KeyZ", ctrlKey: true, metaKey: true}),
      redo: () => key({key: "z", code: "KeyZ", ctrlKey: true, metaKey: true, shiftKey: true}),
      deleteSelected: () => key({key: "Delete", code: "Delete"}),
      fit() {
        apiRef.current?.scrollToContent(undefined, {fitToViewport: true, viewportZoomFactor: 0.85, animate: true, duration: 220});
      },
      diagram() {
        const elements = apiRef.current?.getSceneElementsIncludingDeleted() ?? [];
        return {diagram: toDiagram(elements), version: getSceneVersion(elements)};
      },
      contentVersion: () => getSceneVersion(apiRef.current?.getSceneElementsIncludingDeleted() ?? []),
      startPreview(before, after) {
        const api = apiRef.current;
        if (!api || previewRef.current) return;
        const state = api.getAppState();
        const original = api.getSceneElementsIncludingDeleted();
        const patch = applyDiagram(original, before, after, {strokeColor: state.currentItemStrokeColor});
        previewRef.current = {original, view: {scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom}, patch};
        api.updateScene({
          elements: patch.preview,
          appState: {selectedElementIds: {}},
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        const changed = new Set([...patch.added, ...patch.updated, ...patch.deleted]);
        const focus = patch.preview.filter((element) => changed.has(element.id));
        if (focus.length) api.scrollToContent(focus, {fitToViewport: true, viewportZoomFactor: 0.7, animate: true, duration: 220});
        setPreviewing(patch);
        publishUi(api.getAppState());
      },
      async applyPreview() {
        const api = apiRef.current;
        const preview = previewRef.current;
        if (!api || !preview) return;
        // First restore the original and let the canvas commit once, then write the result as a single step: one undo then returns to the state before applying.
        api.updateScene({elements: preview.original, captureUpdate: CaptureUpdateAction.NEVER});
        await nextFrame();
        await nextFrame();
        previewRef.current = null;
        api.updateScene({elements: preview.patch.next, appState: preview.view, captureUpdate: CaptureUpdateAction.IMMEDIATELY});
        setPreviewing(null);
        publishUi(api.getAppState());
      },
      cancelPreview,
      async exportPng() {
        const api = apiRef.current;
        const work = currentWork();
        if (!api || !work) return;
        const elements = api.getSceneElements();
        if (elements.length === 0) {
          notify({kind: "info", title: t("export.emptyTitle"), description: t("export.emptyBody")});
          return;
        }
        const blob = await exportToBlob({
          elements,
          files: api.getFiles(),
          appState: {exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false},
          mimeType: "image/png",
          exportPadding: 32,
        });
        downloadBlob(blob, easelFileName(work.name, ".png"));
      },
    }),
    [cancelPreview, key, publishUi],
  );

  const api = apiRef.current;
  const state = previewing && api ? api.getAppState() : null;
  const marks = previewing && api && state
    ? ([
        ["added", previewing.added],
        ["updated", previewing.updated],
        ["deleted", previewing.deleted],
      ] as const).flatMap(([kind, ids]) => boundsOf(previewing.preview, ids).map((box) => ({...box, kind})))
    : [];

  return (
    <div ref={containerRef} className="easel-canvas" data-previewing={previewing ? "" : undefined}>
      {loaded && (
        <Excalidraw
          key={loaded.key}
          excalidrawAPI={bindApi}
          initialData={{
            elements: sceneElements(loaded.scene),
            files: loaded.scene.files as BinaryFiles,
            appState: {
              scrollX: loaded.scene.view.scrollX,
              scrollY: loaded.scene.view.scrollY,
              zoom: {value: loaded.scene.view.zoom as CanvasState["zoom"]["value"]},
              viewBackgroundColor: "transparent",
              currentItemStrokeColor: uiRef.current?.strokeColor ?? DEFAULT_INK,
              currentItemStrokeWidth: level.current,
            },
          }}
          onChange={onChange}
          theme={theme}
          langCode={locale}
          viewModeEnabled={previewing !== null}
          UIOptions={{canvasActions: {loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false}}}
        />
      )}
      {loaded && (
        <ConnectHandles api={getApi} container={containerRef} enabled={canvasTool === "select" && previewing === null} selectedId={linkable} strokeWidth={level.current} />
      )}
      {state &&
        marks.map((mark) => (
          <span
            key={`${mark.kind}:${mark.id}`}
            className="easel-mark"
            data-kind={mark.kind}
            style={{
              left: (mark.x + state.scrollX) * state.zoom.value - 6,
              top: (mark.y + state.scrollY) * state.zoom.value - 6,
              width: mark.width * state.zoom.value + 12,
              height: mark.height * state.zoom.value + 12,
            }}
          />
        ))}
    </div>
  );
}
