import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, Check, Circle, Crop, Download, ExternalLink, Hash, Highlighter, LoaderCircle, Minus, PenLine, Redo2, Shield, Square, Type, Undo2, X, ZoomIn, Grid2X2, MousePointer2, Droplets, Eraser } from "./icons";
import type { Capture } from "./model";
import { commit, createHistory, cropDocument, imagePoint, redo, rectBetween, renderDocument, undo, type Mark, type Point, type Tool } from "./editor/document";
import "./editor.css";

const TOOLS = [
  { id: "rect", name: "矩形", key: "R", Icon: Square },
  { id: "ellipse", name: "椭圆", key: "O", Icon: Circle },
  { id: "arrow", name: "箭头", key: "A", Icon: ArrowUpRight },
  { id: "line", name: "直线", key: "L", Icon: Minus },
  { id: "pen", name: "画笔", key: "P", Icon: PenLine },
  { id: "highlight", name: "荧光笔", key: "H", Icon: Highlighter },
  { id: "text", name: "文字", key: "T", Icon: Type },
  { id: "step", name: "序号", key: "N", Icon: Hash },
  { id: "mosaic", name: "马赛克", key: "M", Icon: Grid2X2 },
  { id: "blur", name: "模糊", key: "G", Icon: Droplets },
  { id: "eraser", name: "橡皮擦", key: "E", Icon: Eraser },
  { id: "redact", name: "实色遮盖", key: "B", Icon: Shield },
  { id: "crop", name: "裁剪", key: "C", Icon: Crop },
] as const;
const COLORS = ["#ee5946", "#f3bd36", "#418a67", "#438be0", "#a278df", "#ffffff", "#20252a"];
type Draft = { tool: Tool; color: string; width: number; points: Point[] };
export default function Editor({ item, source, onClose, onSave, onAction }: {
  item: Capture; source: string; onClose: () => void; onSave: (data: string) => Promise<void>; onAction: (command: string, id: string) => void;
}) {
  const [tool, setTool] = useState<Tool | null>("arrow"), [color, setColor] = useState(COLORS[0]), [width, setWidth] = useState(4);
  const [history, setHistory] = useState(() => createHistory(item.width || 1, item.height || 1));
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false), [zoom, setZoom] = useState(false);
  const [textEntry, setTextEntry] = useState<{ point: Point; text: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), photo = useRef<HTMLImageElement | null>(null), draft = useRef<Draft | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLElement>(null), textInput = useRef<HTMLTextAreaElement>(null);
  const isImage = item.kind === "image", doc = history.present, changed = history.past.length > 0;
  const render = useCallback((extra?: Mark) => {
    if (canvas.current && photo.current) renderDocument(canvas.current, photo.current, doc, extra);
  }, [doc]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!isImage) return;
    let active = true;
    setReady(false); setError(""); setTextEntry(null); draft.current = null;
    const image = new Image();
    // Local assets have a different Tauri origin. CORS must precede src assignment.
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      photo.current = image;
      setHistory(createHistory(image.naturalWidth, image.naturalHeight)); setReady(true);
    };
    image.onerror = () => active && setError("无法加载图片。请使用右下角的默认应用打开，或关闭后重试。");
    image.src = source;
    return () => { active = false; photo.current = null; };
  }, [source, isImage]);
  useEffect(() => { if (ready) render(); }, [ready, render]);
  useEffect(() => {
    if (!ready) return;
    render(textEntry?.text ? { tool: "text", color, width, points: [textEntry.point], text: textEntry.text } : undefined);
  }, [textEntry, color, width, ready, render]);
  useEffect(() => { if (textEntry) textInput.current?.focus(); }, [!!textEntry]);
  const addText = () => {
    if (!textEntry?.text.trim()) return;
    const mark: Mark = { tool: "text", color, width, points: [textEntry.point], text: textEntry.text };
    setHistory(previous => commit(previous, { ...previous.present, marks: [...previous.present.marks, mark] }));
    setTextEntry(null); canvas.current?.focus();
  };
  const save = async () => {
    if (!canvas.current || !ready || saving || textEntry) return;
    setSaving(true); setError("");
    try {
      draft.current = null; render();
      await onSave(canvas.current.toDataURL("image/png"));
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "SecurityError" ? "原图像素读取失败，请关闭预览后重新打开再试。" : reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(false); }
  };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // Capture before the library handler; typing and editor tools never trigger library shortcuts.
      event.stopPropagation();
      const input = event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable);
      if (event.key === "Tab") {
        const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, canvas[tabindex], video') || []).filter(element => element.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (textEntry) setTextEntry(null);
        else if (draft.current) { draft.current = null; render(); }
        else if (!saving) onClose();
        return;
      }
      if (input) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!textEntry) void save(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && textEntry) { event.preventDefault(); addText(); }
        return;
      }
      if (!ready || saving || !isImage) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") { event.preventDefault(); draft.current = null; setHistory(event.shiftKey ? redo : undo); }
        else if (event.key.toLowerCase() === "y") { event.preventDefault(); draft.current = null; setHistory(redo); }
        else if (event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
        return;
      }
      const selected = TOOLS.find(entry => entry.key.toLowerCase() === event.key.toLowerCase());
      if (selected) { event.preventDefault(); setTool(selected.id); }
      if (event.key === "v" || event.key === "V") setTool(null);
      if (event.key === "[") setWidth(value => Math.max(1, value - 1));
      if (event.key === "]") setWidth(value => Math.min(20, value + 1));
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  });
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return imagePoint({ x: event.clientX, y: event.clientY }, { x: box.left, y: box.top, width: box.width, height: box.height }, doc.crop);
  };
  const paintDraft = () => {
    const current = draft.current;
    if (!current) return;
    if (current.tool !== "crop") { render(current as Mark); return; }
    render();
    const ctx = canvas.current?.getContext("2d"), first = current.points[0], last = current.points.at(-1)!;
    if (!ctx) return;
    const rect = rectBetween(first, last), x = rect.x - doc.crop.x, y = rect.y - doc.crop.y;
    ctx.save(); ctx.fillStyle = "#00000088";
    ctx.beginPath(); ctx.rect(0, 0, doc.crop.width, doc.crop.height); ctx.rect(x, y, rect.width, rect.height); ctx.fill("evenodd");
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, doc.crop.width / 800); ctx.setLineDash([6, 5]); ctx.strokeRect(x, y, rect.width, rect.height); ctx.restore();
  };
  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    const completed = draft.current;
    if (!completed) return;
    draft.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const last = point(event);
    if (["pen", "highlight", "eraser"].includes(completed.tool)) completed.points.push(last);
    else completed.points = [completed.points[0], last];
    if (completed.tool === "crop") {
      const next = cropDocument(doc, completed.points[0], last);
      if (next !== doc) setHistory(previous => commit(previous, next)); else render();
    } else {
      const first = completed.points[0];
      if (!["pen", "highlight", "eraser"].includes(completed.tool) && Math.hypot(last.x - first.x, last.y - first.y) < 2) { render(); return; }
      setHistory(previous => commit(previous, { ...previous.present, marks: [...previous.present.marks, completed as Mark] }));
    }
  };
  const currentTool = TOOLS.find(entry => entry.id === tool);
  return <div className="modal-backdrop annotation-backdrop">
    <section className="editor annotation-editor" role="dialog" aria-modal="true" aria-label="图片预览与标注" ref={dialog}>
      <header className="editor-header"><div><strong>{item.name}</strong><span>{isImage ? `${doc.crop.width} × ${doc.crop.height} · 原始像素编辑` : "视频预览"}{changed ? " · 有未保存修改" : ""}</span></div><button className="icon-button" aria-label="关闭预览" title="关闭 · Esc" ref={closeButton} disabled={saving} onClick={onClose}><X size={20} /></button></header>
      {isImage && <div className="annotation-tools" role="toolbar" aria-label="标注工具">
        <button className={`icon-button ${tool === null ? "selected" : ""}`} title="浏览 · V" aria-label="浏览" aria-pressed={tool === null} disabled={saving} onClick={() => setTool(null)}><MousePointer2 size={18} /></button>
        {TOOLS.map(({ id, name, key, Icon }) => <button key={id} className={`icon-button ${tool === id ? "selected" : ""}`} title={`${name} · ${key}`} aria-label={name} aria-keyshortcuts={key} aria-pressed={tool === id} disabled={!ready || saving || !!textEntry} onClick={() => setTool(id)}><Icon size={18} /><span className="tool-caption">{name}</span></button>)}
      </div>}
      {isImage && <div className="annotation-options">
        <div className="annotation-colors" aria-label="标注颜色">{COLORS.map(value => <button key={value} aria-label={`颜色 ${value}`} aria-pressed={color === value} disabled={saving} onClick={() => setColor(value)} className={`color-dot ${color === value ? "active" : ""}`} style={{ background: value, color: value === "#ffffff" || value === "#f3bd36" ? "#20252a" : "#fff" }}>{color === value && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}</button>)}<input type="color" value={color} aria-label="自定义颜色" title="自定义颜色" disabled={saving} onChange={event => setColor(event.target.value)} /></div>
        <label className="annotation-width">粗细 <input type="range" min="1" max="20" value={width} disabled={saving} onChange={event => setWidth(Number(event.target.value))} aria-label="标注粗细" /><output>{width}px</output></label>
        <span className="annotation-option-note">{tool === "crop" ? "拖出范围，松开完成裁剪" : tool === "text" ? "点击图片放置文字" : tool === "step" ? "点击图片连续编号" : tool === "redact" ? "完全覆盖敏感内容" : tool === "mosaic" ? "拖出范围生成像素马赛克" : tool === "blur" ? "拖出范围模糊像素" : tool === "eraser" ? "擦除标注，恢复原始画面" : tool === "highlight" ? "半透明荧光笔" : "[ / ] 调整粗细"}</span>
      </div>}
      {textEntry && <form className="annotation-text-form" onSubmit={event => { event.preventDefault(); addText(); }}><label htmlFor="annotation-text">文字内容</label><textarea id="annotation-text" ref={textInput} value={textEntry.text} rows={2} maxLength={2000} onChange={event => setTextEntry({ ...textEntry, text: event.target.value })} placeholder="输入文字，Ctrl + Enter 添加" /><button className="button primary" type="submit" disabled={!textEntry.text.trim()}><Check size={16} />添加文字</button><button className="icon-button" type="button" aria-label="取消文字" onClick={() => setTextEntry(null)}><X size={18} /></button></form>}
      <div className={`editor-stage ${zoom ? "zoomed" : ""}`}>
        {!isImage ? <video src={source} controls onError={() => setError("此视频编码无法在内置播放器中播放，请使用默认应用打开。")} /> : <canvas ref={canvas} className={tool ? "drawing" : ""} tabIndex={0} aria-label={`图片标注画布，当前工具：${currentTool?.name || "浏览"}`} onPointerDown={event => {
          if (!tool || !ready || saving || textEntry || event.button !== 0) return;
          event.currentTarget.focus();
          const first = point(event);
          if (tool === "text") { setTextEntry({ point: first, text: "" }); return; }
          if (tool === "step") { setHistory(previous => commit(previous, { ...previous.present, marks: [...previous.present.marks, { tool, color, width, points: [first], number: previous.present.marks.filter(mark => mark.tool === "step").length + 1 }] })); return; }
          event.currentTarget.setPointerCapture(event.pointerId); draft.current = { tool, color, width, points: [first] };
        }} onPointerMove={event => {
          if (!draft.current) return;
          const next = point(event);
          if (["pen", "highlight", "eraser"].includes(draft.current.tool)) draft.current.points.push(next); else draft.current.points = [draft.current.points[0], next];
          paintDraft();
        }} onPointerUp={finish} onPointerCancel={() => { draft.current = null; render(); }} onLostPointerCapture={() => { if (draft.current) { draft.current = null; render(); } }} />}
        {isImage && !ready && !error && <div className="annotation-loading" role="status"><LoaderCircle size={22} className="spin" />正在加载原图…</div>}
        {error && <div className="editor-error" role="alert">{error}</div>}
      </div>
      <footer className="editor-toolbar annotation-footer">
        {isImage && <><button className="icon-button" aria-label="撤销标注" title="撤销 · Ctrl+Z" disabled={!history.past.length || saving || !!textEntry} onClick={() => setHistory(undo)}><Undo2 size={19} /></button><button className="icon-button" aria-label="重做标注" title="重做 · Ctrl+Shift+Z" disabled={!history.future.length || saving || !!textEntry} onClick={() => setHistory(redo)}><Redo2 size={19} /></button><button className="icon-button" aria-label={zoom ? "适应窗口" : "原始大小"} title={zoom ? "适应窗口" : "100% 原始大小"} aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? <Minus size={19} /> : <ZoomIn size={19} />}</button><span className="annotation-status">{zoom ? "100%" : "适应窗口"} · {doc.marks.length} 项标注</span></>}
        <div className="toolbar-spacer" />
        <button className="icon-button" title="默认应用打开原文件" aria-label="默认应用打开" onClick={() => onAction("open_item", item.id)}><ExternalLink size={18} /></button>
        <button className="icon-button" title="导出未修改的原文件" aria-label="导出原图" onClick={() => onAction("export_item", item.id)}><Download size={18} /></button>
        {isImage && <button className="button primary" title="保存标注 PNG 副本 · Ctrl+S" disabled={saving || !ready || !!textEntry} onClick={() => void save()}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{saving ? "正在保存…" : "保存副本"}</button>}
      </footer>
    </section>
  </div>;
}
