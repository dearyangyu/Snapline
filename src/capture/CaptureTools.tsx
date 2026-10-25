import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Download,
  Droplets,
  Eraser,
  Grid2X2,
  Hash,
  Highlighter,
  Minus,
  MousePointer2,
  PenLine,
  Pin,
  Pipette,
  Redo2,
  Shield,
  Square,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from "../icons";
import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { CaptureTool } from "./interaction";
import { captureParameter } from "./toolPresentation";
import Select from "../Select";

export const TOOL_NAMES: Record<CaptureTool, string> = {
  rect: "矩形",
  ellipse: "椭圆",
  arrow: "箭头",
  line: "直线",
  pen: "画笔",
  highlight: "荧光笔",
  text: "文字",
  step: "序号",
  mosaic: "马赛克",
  redact: "实色遮盖",
  blur: "模糊",
  eraser: "橡皮",
};
const TOOL_ICONS: Record<CaptureTool, LucideIcon> = {
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  pen: PenLine,
  highlight: Highlighter,
  text: Type,
  step: Hash,
  mosaic: Grid2X2,
  redact: Shield,
  blur: Droplets,
  eraser: Eraser,
};
const COLORS = [
  { value: "#ee4e43", name: "珊瑚红", ink: "#fff" },
  { value: "#ffb82e", name: "琥珀黄", ink: "#292e35" },
  { value: "#68b348", name: "草木绿", ink: "#192d14" },
  { value: "#2493e8", name: "天空蓝", ink: "#142b40" },
  { value: "#aa63d4", name: "紫罗兰", ink: "#fff" },
  { value: "#ffffff", name: "白色", ink: "#292e35" },
  { value: "#252a30", name: "炭黑", ink: "#fff" },
];
export type TextStyle = { fontSize: number; fontFamily: string };
interface Props {
  tool: CaptureTool | null;
  setTool: (tool: CaptureTool | null) => void;
  color: string;
  setColor: (color: string) => void;
  width: number;
  setWidth: (width: number) => void;
  textStyle: TextStyle;
  setTextStyle: (style: TextStyle) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  busy: boolean;
  textActive: boolean;
  finish: (action: "copy" | "pin" | "save") => void;
  cancel: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  position: { x: number; y: number };
  maxWidth: number;
  maxHeight?: number;
  hidden?: boolean;
}

export function CaptureTools(props: Props) {
  const {
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    textStyle,
    setTextStyle,
    busy,
    textActive,
  } = props;
  const optionsId = useId();
  const [expanded, setExpanded] = useState(true);
  const [remembered, setRemembered] = useState<{
    shape: "rect" | "ellipse";
    line: "arrow" | "line";
    pixel: "mosaic" | "blur" | "redact";
  }>({ shape: "rect", line: "arrow", pixel: "mosaic" });
  useEffect(() => {
    setExpanded(true);
    if (tool === "rect" || tool === "ellipse")
      setRemembered((previous) =>
        previous.shape === tool ? previous : { ...previous, shape: tool },
      );
    else if (tool === "arrow" || tool === "line")
      setRemembered((previous) =>
        previous.line === tool ? previous : { ...previous, line: tool },
      );
    else if (tool === "mosaic" || tool === "blur" || tool === "redact")
      setRemembered((previous) =>
        previous.pixel === tool ? previous : { ...previous, pixel: tool },
      );
  }, [tool]);
  const shape = tool === "ellipse" || tool === "rect" ? tool : remembered.shape;
  const line = tool === "line" || tool === "arrow" ? tool : remembered.line;
  const pixel =
    tool === "blur" || tool === "redact" || tool === "mosaic"
      ? tool
      : remembered.pixel;
  const variants: CaptureTool[] =
    tool === "rect" || tool === "ellipse"
      ? ["rect", "ellipse"]
      : tool === "arrow" || tool === "line"
        ? ["arrow", "line"]
        : tool === "mosaic" || tool === "blur" || tool === "redact"
          ? ["mosaic", "blur", "redact"]
          : [];
  const parameter = tool ? captureParameter(tool, width) : null;
  const ActiveIcon = tool ? TOOL_ICONS[tool] : MousePointer2;
  const showColors =
    tool !== null && !["mosaic", "blur", "eraser"].includes(tool);
  const customColor = !COLORS.some(
    (swatch) => swatch.value === color.toLowerCase(),
  );
  const toolButton = (
    id: CaptureTool | null,
    label: string,
    key: string,
    Icon: LucideIcon,
    group = false,
  ) => (
    <button
      type="button"
      className={`capture-tool-button ${tool === id ? "active" : ""}`}
      aria-label={label}
      title={`${label} · ${key}`}
      aria-pressed={tool === id}
      disabled={busy || textActive}
      onClick={() => {
        if (id !== null && tool === id) setExpanded((previous) => !previous);
        else {
          setTool(id);
          setExpanded(true);
        }
      }}
    >
      <Icon size={18} aria-hidden="true" />
      {group && (
        <ChevronDown
          className="capture-tool-chevron"
          size={9}
          aria-hidden="true"
        />
      )}
    </button>
  );

  return (
    <div
      className="capture-tool-panel"
      ref={props.panelRef}
      hidden={props.hidden}
      style={{
        left: props.position.x,
        top: props.position.y,
        maxWidth: props.maxWidth,
        maxHeight: props.maxHeight ?? "calc(100vh - 16px)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="capture-tool-main-scroll">
        <div
          className="capture-tool-row"
          role="toolbar"
          aria-label="截图标注工具栏"
        >
          {toolButton(null, "移动选区", "V", MousePointer2)}
          {toolButton(
            shape,
            TOOL_NAMES[shape],
            shape === "rect" ? "R" : "O",
            TOOL_ICONS[shape],
            true,
          )}
          {toolButton(
            line,
            TOOL_NAMES[line],
            line === "arrow" ? "A" : "L",
            TOOL_ICONS[line],
            true,
          )}
          {toolButton("pen", "画笔", "B / P", PenLine)}
          {toolButton("highlight", "荧光笔", "H", Highlighter)}
          {toolButton(
            pixel,
            TOOL_NAMES[pixel],
            pixel === "mosaic" ? "M" : "二级选项",
            TOOL_ICONS[pixel],
            true,
          )}
          {toolButton("text", "文字", "T", Type)}
          {toolButton("eraser", "橡皮", "E", Eraser)}
          {toolButton("step", "序号", "N", Hash)}
          <span className="capture-tool-separator" aria-hidden="true" />
          <button
            type="button"
            className="capture-tool-button"
            aria-label="撤销"
            title="撤销 · Ctrl+Z"
            disabled={!props.canUndo || busy || textActive}
            onClick={props.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className="capture-tool-button"
            aria-label="重做"
            title="重做 · Ctrl+Y / Ctrl+Shift+Z"
            disabled={!props.canRedo || busy || textActive}
            onClick={props.redo}
          >
            <Redo2 size={18} />
          </button>
          <span className="capture-tool-separator" aria-hidden="true" />
          <button
            type="button"
            className="capture-tool-button"
            aria-label="保存截图"
            title="保存截图 · Ctrl+S"
            disabled={busy || textActive}
            onClick={() => props.finish("save")}
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            className="capture-tool-button"
            aria-label="贴图"
            title="贴到屏幕 · Ctrl+T"
            disabled={busy || textActive}
            onClick={() => props.finish("pin")}
          >
            <Pin size={18} />
          </button>
          <button
            type="button"
            className="capture-tool-button"
            aria-label="取消截图"
            title="取消整张截图"
            disabled={busy}
            onClick={props.cancel}
          >
            <X size={19} />
          </button>
          <button
            type="button"
            className="capture-tool-button capture-tool-complete"
            aria-label="复制截图"
            title="复制截图 · Enter / Ctrl+C"
            disabled={busy || textActive}
            onClick={() => props.finish("copy")}
          >
            <Copy size={18} />
          </button>
        </div>
      </div>
      {tool !== null && (
        <section
          className="capture-tool-options"
          aria-label={`${TOOL_NAMES[tool]}选项`}
        >
          <div className="capture-options-heading">
            <span className="capture-options-icon">
              <ActiveIcon size={15} aria-hidden="true" />
            </span>
            <strong>{TOOL_NAMES[tool]}</strong>
            <span className="capture-options-caption">
              {variants.includes("mosaic") ? "框选区域处理" : "标注样式"}
            </span>
            <button
              type="button"
              className="capture-options-toggle"
              aria-label={expanded ? "收起工具选项" : "展开工具选项"}
              title={expanded ? "收起工具选项" : "展开工具选项"}
              aria-expanded={expanded}
              aria-controls={optionsId}
              onClick={() => setExpanded((previous) => !previous)}
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
          <div
            id={optionsId}
            className="capture-options-body"
            hidden={!expanded}
          >
            <div className="capture-options-grid">
              {variants.length > 0 && (
                <div className="capture-option-group">
                  <span className="capture-option-label">
                    {variants.includes("mosaic")
                      ? "处理方式"
                      : variants.includes("rect")
                        ? "形状"
                        : "线条样式"}
                  </span>
                  <div
                    className="capture-variant-group"
                    role="group"
                    aria-label="标注类型"
                  >
                    {variants.map((id) => {
                      const Icon = TOOL_ICONS[id];
                      return (
                        <button
                          type="button"
                          key={id}
                          aria-label={TOOL_NAMES[id]}
                          aria-pressed={tool === id}
                          onClick={() => setTool(id)}
                          disabled={busy || textActive}
                        >
                          <Icon size={15} aria-hidden="true" />
                          <span>
                            {id === "redact" ? "遮盖" : TOOL_NAMES[id]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {parameter && (
                <div className="capture-option-group capture-parameter-group">
                  <label
                    className="capture-option-label"
                    htmlFor={`${optionsId}-width`}
                  >
                    {parameter.label}
                  </label>
                  <div className="capture-parameter-control">
                    <input
                      id={`${optionsId}-width`}
                      type="range"
                      aria-label={`${TOOL_NAMES[tool]}${parameter.label}`}
                      aria-valuetext={parameter.description}
                      min={1}
                      max={20}
                      value={width}
                      disabled={busy}
                      style={
                        {
                          "--capture-range-progress": `${((width - 1) / 19) * 100}%`,
                        } as CSSProperties
                      }
                      onChange={(event) => setWidth(Number(event.target.value))}
                    />
                    <output
                      htmlFor={`${optionsId}-width`}
                      className="capture-parameter-value"
                    >
                      <b>{parameter.value}</b>
                      <span>{parameter.unit}</span>
                    </output>
                  </div>
                </div>
              )}
              {tool === "redact" && (
                <div className="capture-option-group capture-redact-note">
                  <Shield size={15} aria-hidden="true" />
                  <span>用所选颜色完整填充区域</span>
                </div>
              )}
              {tool === "text" && (
                <>
                  <div className="capture-option-group">
                    <label
                      className="capture-option-label"
                      htmlFor={`${optionsId}-font`}
                    >
                      字体
                    </label>
                    <Select
                      id={`${optionsId}-font`}
                      label="文字字体"
                      value={textStyle.fontFamily}
                      disabled={busy}
                      appearance="light"
                      options={[{value:'Microsoft YaHei',label:'微软雅黑'},{value:'Segoe UI',label:'Segoe UI'},{value:'Consolas',label:'Consolas'}]}
                      onChange={(value) =>
                        setTextStyle({
                          ...textStyle,
                          fontFamily: value,
                        })
                      }
                    />
                  </div>
                  <div className="capture-option-group">
                    <label
                      className="capture-option-label"
                      htmlFor={`${optionsId}-font-size`}
                    >
                      字号
                    </label>
                    <div className="capture-font-size-control">
                      <input
                        id={`${optionsId}-font-size`}
                        type="number"
                        aria-label="文字字号"
                        min={12}
                        max={96}
                        value={textStyle.fontSize}
                        disabled={busy}
                        onChange={(event) =>
                          setTextStyle({
                            ...textStyle,
                            fontSize: Math.max(
                              12,
                              Math.min(96, Number(event.target.value) || 12),
                            ),
                          })
                        }
                      />
                      <span>px</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            {showColors && (
              <div className="capture-option-group capture-color-group">
                <span className="capture-option-label">
                  {tool === "redact" ? "填充颜色" : "标注颜色"}
                </span>
                <div
                  className="capture-swatches"
                  role="group"
                  aria-label="标注颜色"
                >
                  {COLORS.map((swatch) => (
                    <button
                      type="button"
                      key={swatch.value}
                      aria-label={`颜色 ${swatch.name}`}
                      title={swatch.name}
                      aria-pressed={color.toLowerCase() === swatch.value}
                      className={
                        color.toLowerCase() === swatch.value ? "selected" : ""
                      }
                      style={{ background: swatch.value, color: swatch.ink }}
                      onClick={() => setColor(swatch.value)}
                      disabled={busy}
                    >
                      {color.toLowerCase() === swatch.value && (
                        <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                  <span className="capture-color-divider" aria-hidden="true" />
                  <label
                    className={`capture-custom-color ${customColor ? "selected" : ""}`}
                    title="选择自定义颜色"
                  >
                    <Pipette size={14} aria-hidden="true" />
                    <span>自定义</span>
                    {customColor && (
                      <i style={{ background: color }} aria-hidden="true" />
                    )}
                    <input
                      type="color"
                      aria-label="自定义标注颜色"
                      value={color}
                      disabled={busy}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            {tool === "eraser" && (
              <p className="capture-option-help">擦除标注，恢复原图</p>
            )}
            {tool === "text" && (
              <p className="capture-option-help">
                点击输入文字 · Ctrl+Enter 确认
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
