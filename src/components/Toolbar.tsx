import {ArrowUpRight, ArrowUturnCcwLeft, ArrowUturnCwRight, Eraser, Font, Pencil, Sparkles, Square, TrashBin} from "@gravity-ui/icons";
import {Button, ButtonGroup, ColorSwatchPicker, parseColor, Separator, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip} from "@heroui/react";
import {useEffect, useRef, useState, type ReactNode} from "react";
import type {OpsSummary} from "../../shared/diagram.ts";
import type {EditorHandle, EditorUi} from "../editor/Editor.tsx";
import {t} from "../lib/i18n.ts";
import {CONNECTOR_TOOLS, INKS, SHAPE_TOOLS, TOOL_KEYS, TOOL_LABEL, WIDTHS, type ConnectorTool, type ShapeTool, type Tool} from "../editor/tools.ts";
import {CursorIcon, DiamondIcon, EllipseIcon, LineIcon} from "./icons.tsx";

const isShape = (tool: Tool): tool is ShapeTool => (SHAPE_TOOLS as readonly string[]).includes(tool);
const isConnector = (tool: Tool): tool is ConnectorTool => (CONNECTOR_TOOLS as readonly string[]).includes(tool);

const TOOL_ICON: Record<Tool, ReactNode> = {
  select: <CursorIcon aria-hidden />,
  pen: <Pencil aria-hidden />,
  eraser: <Eraser aria-hidden />,
  rectangle: <Square aria-hidden />,
  ellipse: <EllipseIcon aria-hidden />,
  diamond: <DiamondIcon aria-hidden />,
  text: <Font aria-hidden />,
  arrow: <ArrowUpRight aria-hidden />,
  line: <LineIcon aria-hidden />,
};

function Tip({label, children}: {label: string; children: ReactNode}) {
  return (
    <Tooltip delay={500}>
      {children}
      <Tooltip.Content placement="top">{label}</Tooltip.Content>
    </Tooltip>
  );
}

interface Props {
  ui: EditorUi;
  editor: () => EditorHandle | null;
  onAi: () => void;
}

export function EditorToolbar({ui, editor, onAi}: Props) {
  // Shapes and connectors each get a single entry that remembers the kind used last.
  const [shape, setShape] = useState<ShapeTool>("rectangle");
  const [connector, setConnector] = useState<ConnectorTool>("arrow");
  const group = isShape(ui.tool) ? "shape" : isConnector(ui.tool) ? "connector" : ui.tool;
  const pick = (tool: Tool) => {
    if (isShape(tool)) setShape(tool);
    if (isConnector(tool)) setConnector(tool);
    editor()?.setTool(tool);
  };
  const entries: {id: string; tool: Tool; label: string}[] = [
    {id: "select", tool: "select", label: TOOL_LABEL.select},
    {id: "pen", tool: "pen", label: TOOL_LABEL.pen},
    {id: "eraser", tool: "eraser", label: TOOL_LABEL.eraser},
    {id: "shape", tool: shape, label: t("tool.shape")},
    {id: "text", tool: "text", label: TOOL_LABEL.text},
    {id: "connector", tool: connector, label: t("tool.connector")},
  ];
  // Number keys 1–6 switch tools directly; don't steal keys while text is being typed or a dialog or menu is open.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const index = (TOOL_KEYS as readonly string[]).indexOf(event.key);
      if (index < 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu']")) return;
      // The canvas engine has hidden dialog nodes of its own; only look at dialogs opened by Easel.
      const dialogs = document.querySelectorAll("[role='dialog'], [role='alertdialog']");
      if ([...dialogs].some((dialog) => !dialog.closest(".excalidraw"))) return;
      const entry = entriesRef.current[index];
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      editor()?.setTool(entry.tool);
    };
    window.addEventListener("keydown", onKey, {capture: true});
    return () => window.removeEventListener("keydown", onKey, {capture: true});
  }, [editor]);

  const showInk = ui.tool === "pen" || ui.tool === "text" || isShape(ui.tool) || isConnector(ui.tool) || ui.selected > 0;
  const showWidth = showInk && ui.tool !== "text";

  return (
    <>
      {showInk && (
        <Toolbar aria-label={t("toolbar.properties")} className="easel-bar easel-bar--props">
          {isShape(ui.tool) && (
            <>
              <KindPicker label={t("tool.shape")} value={ui.tool} options={SHAPE_TOOLS} onChange={pick} />
              <Separator orientation="vertical" />
            </>
          )}
          {isConnector(ui.tool) && (
            <>
              <KindPicker label={t("tool.connector")} value={ui.tool} options={CONNECTOR_TOOLS} onChange={pick} />
              <Separator orientation="vertical" />
            </>
          )}
          <ColorSwatchPicker
            aria-label={t("toolbar.colour")}
            size="sm"
            className="easel-inks"
            value={parseColor(ui.strokeColor)}
            onChange={(color) => editor()?.setStroke({color: color.toString("hex").toLowerCase()})}
          >
            {INKS.map((ink) => (
              <ColorSwatchPicker.Item key={ink.value} color={ink.value} aria-label={ink.name}>
                <ColorSwatchPicker.Swatch />
                <ColorSwatchPicker.Indicator />
              </ColorSwatchPicker.Item>
            ))}
          </ColorSwatchPicker>
          {showWidth && (
            <>
              <Separator orientation="vertical" />
              <ToggleButtonGroup
                aria-label={t("toolbar.width")}
                size="sm"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[String(ui.strokeWidth)]}
                onSelectionChange={(keys) => {
                  const width = Number([...keys][0]);
                  if (width) editor()?.setStroke({width});
                }}
              >
                {WIDTHS.map((width, index) => (
                  <ToggleButton key={width.value} id={String(width.value)} isIconOnly aria-label={t("width.line", {name: width.name})}>
                    {index > 0 && <ToggleButtonGroup.Separator />}
                    <span className="easel-weight" style={{height: width.value + 1}} aria-hidden />
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </>
          )}
          {ui.selected > 0 && (
            <>
              <Separator orientation="vertical" />
              <Tip label={t("toolbar.deleteSelected")}>
                <Button isIconOnly size="sm" variant="ghost" aria-label={t("toolbar.deleteSelected")} onPress={() => editor()?.deleteSelected()}>
                  <TrashBin aria-hidden />
                </Button>
              </Tip>
            </>
          )}
        </Toolbar>
      )}
      <Toolbar aria-label={t("toolbar.drawing")} className="easel-bar">
        <ToggleButtonGroup
          aria-label={t("toolbar.tools")}
          size="sm"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[group]}
          onSelectionChange={(keys) => {
            const entry = entries.find((item) => item.id === [...keys][0]);
            if (entry) pick(entry.tool);
          }}
        >
          {entries.map((entry, index) => (
            <Tip key={entry.id} label={`${entry.label} · ${TOOL_KEYS[index]}`}>
              <ToggleButton id={entry.id} isIconOnly aria-label={entry.label} aria-keyshortcuts={TOOL_KEYS[index]} className="relative">
                {index > 0 && <ToggleButtonGroup.Separator />}
                {TOOL_ICON[entry.tool]}
                <span className="easel-key" aria-hidden>
                  {TOOL_KEYS[index]}
                </span>
              </ToggleButton>
            </Tip>
          ))}
        </ToggleButtonGroup>
        <Separator orientation="vertical" />
        <ButtonGroup size="sm" variant="tertiary">
          <Tip label={t("common.undo")}>
            <Button isIconOnly variant="tertiary" aria-label={t("common.undo")} onPress={() => editor()?.undo()}>
              <ArrowUturnCcwLeft aria-hidden />
            </Button>
          </Tip>
          <Tip label={t("common.redo")}>
            <Button isIconOnly variant="tertiary" aria-label={t("common.redo")} onPress={() => editor()?.redo()}>
              <ButtonGroup.Separator />
              <ArrowUturnCwRight aria-hidden />
            </Button>
          </Tip>
        </ButtonGroup>
        <Separator orientation="vertical" />
        <Tip label={t("ai.title")}>
          <Button isIconOnly size="sm" variant="tertiary" aria-label={t("ai.title")} onPress={onAi}>
            <Sparkles aria-hidden />
          </Button>
        </Tip>
      </Toolbar>
    </>
  );
}

function KindPicker<T extends Tool>({label, value, options, onChange}: {label: string; value: T; options: readonly T[]; onChange: (tool: T) => void}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0] as T | undefined;
        if (next) onChange(next);
      }}
    >
      {options.map((tool, index) => (
        <ToggleButton key={tool} id={tool} isIconOnly aria-label={TOOL_LABEL[tool]}>
          {index > 0 && <ToggleButtonGroup.Separator />}
          {TOOL_ICON[tool]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function PreviewBar({summary, onApply, onCancel}: {summary: OpsSummary; onApply: () => void; onCancel: () => void}) {
  const parts = [
    summary.added ? {kind: "added", text: t("preview.added", {count: summary.added})} : null,
    summary.updated ? {kind: "updated", text: t("preview.updated", {count: summary.updated})} : null,
    summary.deleted ? {kind: "deleted", text: t("preview.deleted", {count: summary.deleted})} : null,
  ].filter((part) => part !== null);
  return (
    <div className="easel-bar easel-bar--preview" role="group" aria-label={t("preview.label")}>
      <p className="easel-preview__summary">
        {parts.map((part) => (
          <span key={part.kind} className="easel-preview__count" data-kind={part.kind}>
            {part.text}
          </span>
        ))}
      </p>
      <Button size="sm" variant="tertiary" onPress={onCancel}>
        {t("preview.discard")}
      </Button>
      <Button size="sm" variant="primary" onPress={onApply}>
        {t("preview.apply")}
      </Button>
    </div>
  );
}
