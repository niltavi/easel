import {CaptureUpdateAction} from "@excalidraw/excalidraw";
import type {ExcalidrawElement} from "@excalidraw/excalidraw/element/types";
import type {ExcalidrawImperativeAPI} from "@excalidraw/excalidraw/types";
import {useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject} from "react";
import {connect, isConnectable, sidePoint, type Side} from "./adapter.ts";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
/** How close the pointer must be to an object for the handles to appear (screen pixels). */
const HOVER_REACH = 30;
/** Distance from the handles to the object's edge; when selected, stay clear of the engine's own resize and rotate handles. */
const GAP = 14;
const GAP_SELECTED = 36;

interface Drag {
  fromId: string;
  side: Side;
  /** Pointer position within the canvas container. */
  x: number;
  y: number;
  toId: string | null;
  moved: boolean;
}

interface Props {
  api: () => ExcalidrawImperativeAPI | null;
  container: RefObject<HTMLDivElement | null>;
  /** Only shown with the select tool, so it doesn't get in the way of drawing. */
  enabled: boolean;
  /** The single selected connectable object: touch screens have no hover, so this is what shows the handles. */
  selectedId: string | null;
  /** Stroke width for new connectors. */
  strokeWidth: number;
}

function hit(elements: readonly ExcalidrawElement[], x: number, y: number, reach: number, except?: string): ExcalidrawElement | null {
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];
    if (element.id === except || !isConnectable(element)) continue;
    if (x >= element.x - reach && x <= element.x + element.width + reach && y >= element.y - reach && y <= element.y + element.height + reach) return element;
  }
  return null;
}

/**
 * Connector handles around an object: they appear when the pointer nears (or selects) a shape or a piece of text;
 * dragging out from a handle draws an arrow, and dropping it on another object connects the two automatically.
 */
export function ConnectHandles({api, container, enabled, selectedId, strokeWidth}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, repaint] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const toScene = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = api();
      const box = container.current?.getBoundingClientRect();
      if (!canvas || !box) return null;
      const state = canvas.getAppState();
      const x = clientX - box.left;
      const y = clientY - box.top;
      return {x, y, sceneX: x / state.zoom.value - state.scrollX, sceneY: y / state.zoom.value - state.scrollY, zoom: state.zoom.value};
    },
    [api, container],
  );

  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) {
      setHoverId(null);
      return;
    }
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (dragRef.current || event.pointerType === "touch" || event.buttons !== 0) return;
      const {clientX, clientY} = event;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = api();
        const point = toScene(clientX, clientY);
        if (!canvas || !point) return;
        const found = hit(canvas.getSceneElements(), point.sceneX, point.sceneY, HOVER_REACH / point.zoom);
        setHoverId(found?.id ?? null);
      });
    };
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element).closest?.(".easel-link")) return;
      setPressed(true);
      setHoverId(null);
    };
    const onUp = () => {
      setPressed(false);
      repaint((n) => n + 1);
    };
    const onLeave = () => {
      if (!dragRef.current) setHoverId(null);
    };
    root.addEventListener("pointermove", onMove, {capture: true, passive: true});
    root.addEventListener("pointerdown", onDown, {capture: true, passive: true});
    root.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const unsubscribe = api()?.onScrollChange(() => repaint((n) => n + 1));
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", onMove, {capture: true});
      root.removeEventListener("pointerdown", onDown, {capture: true});
      root.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      unsubscribe?.();
    };
  }, [api, container, enabled, toScene]);

  const canvas = api();
  if (!enabled || !canvas) return null;
  const state = canvas.getAppState();
  const elements = canvas.getSceneElements();
  const zoom = state.zoom.value;
  const toScreen = (x: number, y: number): [number, number] => [(x + state.scrollX) * zoom, (y + state.scrollY) * zoom];

  const sourceId = drag?.fromId ?? (pressed ? null : (hoverId ?? selectedId));
  const source = sourceId ? elements.find((element) => element.id === sourceId && isConnectable(element)) : undefined;
  if (!source) return null;
  const gap = (state.selectedElementIds[source.id] ? GAP_SELECTED : GAP) / zoom;

  const begin = (side: Side) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    const point = toScene(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({fromId: source.id, side, x: point.x, y: point.y, toId: null, moved: false});
  };
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = dragRef.current;
    const point = toScene(event.clientX, event.clientY);
    if (!current || !point) return;
    const target = hit(elements, point.sceneX, point.sceneY, 6 / point.zoom, current.fromId);
    const moved = current.moved || Math.hypot(point.x - current.x, point.y - current.y) > 4;
    setDrag({...current, x: point.x, y: point.y, toId: target?.id ?? null, moved});
  };
  const end = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = dragRef.current;
    const point = toScene(event.clientX, event.clientY);
    setDrag(null);
    setHoverId(null);
    if (!current || !point || !current.moved) return;
    const result = connect(canvas.getSceneElementsIncludingDeleted(), {
      fromId: current.fromId,
      side: current.side,
      toId: current.toId,
      end: [point.sceneX, point.sceneY],
      strokeColor: state.currentItemStrokeColor,
      strokeWidth,
    });
    if (result) canvas.updateScene({elements: result.next, captureUpdate: CaptureUpdateAction.IMMEDIATELY});
  };

  const target = drag?.toId ? elements.find((element) => element.id === drag.toId) : undefined;
  const wireStart = drag ? toScreen(...sidePoint(source, drag.side)) : null;

  return (
    <>
      {drag && wireStart && (
        <svg className="easel-link__wire" aria-hidden>
          <line x1={wireStart[0]} y1={wireStart[1]} x2={drag.x} y2={drag.y} />
        </svg>
      )}
      {target && (
        <span
          className="easel-link__target"
          style={{
            left: toScreen(target.x, target.y)[0] - 4,
            top: toScreen(target.x, target.y)[1] - 4,
            width: target.width * zoom + 8,
            height: target.height * zoom + 8,
          }}
        />
      )}
      {SIDES.map((side) => {
        if (drag && drag.side !== side) return null;
        const [left, top] = toScreen(...sidePoint(source, side, gap));
        return (
          <span
            key={side}
            className="easel-link"
            data-side={side}
            data-active={drag ? "" : undefined}
            style={{left, top}}
            aria-hidden
            onPointerDown={begin(side)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
    </>
  );
}
