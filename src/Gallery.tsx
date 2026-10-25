import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Expand, ImageOff, Images, LayoutGrid, LoaderCircle, RotateCcw, Search, Star, X } from "./icons";
import { createDemo } from "./demo";
import { selectItems, type AppSnapshot, type Capture } from "./model";
import { adjacentGalleryId, masonryLayout } from "./galleryLayout";
import GalleryImageViewer, { type GalleryImageAction } from "./GalleryImageViewer";
import "./gallery.css";

const native = isTauri();
const gallerySession = new URLSearchParams(location.search).get("session") ?? "";
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const imageSource = (item: Capture) => native && item.path ? convertFileSrc(item.path) : item.thumbnail;

function Thumbnail({ item }: { item: Capture }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.thumbnail]);
  return failed || !item.thumbnail
    ? <span className="gallery-thumbnail-missing"><ImageOff size={24} aria-hidden="true"/><span>点击查看原图</span></span>
    : <img src={item.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)}/>;
}

export default function Gallery() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(() => native ? null : createDemo());
  const [loading, setLoading] = useState(native), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""), [favorites, setFavorites] = useState(false), [compact, setCompact] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null), [gridWidth, setGridWidth] = useState(Math.max(1, window.innerWidth - 96));
  const grid = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), exit = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>()), restoreId = useRef<string | null>(null), noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null), revision = useRef(0);
  const allImages = useMemo(() => (snapshot?.items ?? []).filter(item => item.kind === "image"), [snapshot?.items]);
  const items = useMemo(() => selectItems(allImages, query, favorites, "image"), [allImages, query, favorites]);
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const layout = useMemo(() => masonryLayout(items, gridWidth, compact ? 210 : 290, compact ? 14 : 20), [items, gridWidth, compact]);
  const selected = items.find(item => item.id === selectedId) ?? null;

  const announce = useCallback((message: string) => { setNotice(message); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(""), 3000); }, []);
  const load = useCallback(async () => {
    if (!native) { setSnapshot(createDemo()); return; }
    setLoading(true); setError(""); const startedAt = revision.current;
    try { const state = await invoke<AppSnapshot>("get_state"); if (startedAt === revision.current) setSnapshot(state); }
    catch (reason) { setError(`图库加载失败：${errorText(reason)}`); }
    finally { setLoading(false); }
  }, []);
  const close = useCallback(async () => {
    try { if (native) await invoke("close_gallery", { session: gallerySession }); else { const url = new URL(location.href); url.searchParams.delete("view"); location.assign(url.toString()); } }
    catch (reason) { setError(`无法退出全屏图库：${errorText(reason)}`); }
  }, []);
  const closeViewer = useCallback(() => {
    restoreId.current = selectedId; setSelectedId(null);
  }, [selectedId]);
  const navigate = useCallback((direction: -1 | 1) => { if (selectedId) setSelectedId(adjacentGalleryId(ids, selectedId, direction)); }, [ids, selectedId]);

  useEffect(() => {
    document.documentElement.classList.add("gallery-document");
    let stopped = false; const cleanups: (() => void)[] = [];
    if (native) {
      void (async () => {
        try {
          const stop = await listen<AppSnapshot>("library-changed", event => { if (!stopped) { revision.current++; setSnapshot(event.payload); } });
          if (stopped) stop(); else cleanups.push(stop);
          const stopErrors = await listen<string>("app-error", event => { if (!stopped) setError(event.payload); });
          if (stopped) stopErrors(); else cleanups.push(stopErrors);
        } catch (reason) { if (!stopped) setError(errorText(reason)); }
        if (!stopped) await load();
      })();
    }
    return () => { stopped = true; cleanups.forEach(stop => stop()); if (noticeTimer.current) clearTimeout(noticeTimer.current); document.documentElement.classList.remove("gallery-document"); };
  }, [load]);
  useLayoutEffect(() => {
    if (!grid.current) return;
    const element = grid.current; const resize = () => setGridWidth(Math.max(1, element.clientWidth)); resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let second = 0, revealed = false;
    const reveal = () => {
      if (revealed) return;
      // Hidden WebView2 instances can pause rAF. A committed layout plus a timer
      // must also complete this handshake, including the load-error screen.
      if (grid.current) setGridWidth(Math.max(1, grid.current.clientWidth));
      revealed = true;
      if (native) void invoke("gallery_ready", { session: gallerySession }).catch(reason => setError(errorText(reason)));
      exit.current?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(() => { second = requestAnimationFrame(reveal); });
    const fallback = window.setTimeout(reveal, 120);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(second); window.clearTimeout(fallback); };
  }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [query, favorites]);
  useEffect(() => {
    if (selectedId && !selected) { restoreId.current = selectedId; setSelectedId(null); announce("这张图片已不在当前列表中"); }
  }, [selectedId, selected, announce]);
  useEffect(() => {
    if (selectedId || !restoreId.current) return;
    const id = restoreId.current; restoreId.current = null;
    const frame = requestAnimationFrame(() => { const card = cards.current.get(id); if (card) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: "nearest" }); } else search.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  useEffect(() => {
    if (selected) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (query) setQuery(""); else void close(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selected, query, close]);

  const action = async (command: GalleryImageAction, item: Capture) => {
    setError("");
    try {
      if (!native) {
        if (command === 'toggle_pin') setSnapshot(previous => previous && ({ ...previous, items: previous.items.map(candidate => candidate.id === item.id ? { ...candidate, pinned: !candidate.pinned } : candidate) }));
        else announce("请在桌面版中使用此操作");
        return;
      }
      await invoke(command, { id: item.id });
      if (command === "copy_item") announce("已复制到剪贴板");
      if (command === "pin_item") await close();
    } catch (reason) { setError(errorText(reason)); }
  };

  return <main className="gallery-shell">
    <div className="gallery-content" inert={Boolean(selected)}>
      <header className="gallery-header"><div className="gallery-heading"><Images size={21} aria-hidden="true"/><h1>图库</h1><span>{allImages.length}</span></div>
        <label className="gallery-search"><Search size={17} aria-hidden="true"/><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称或来源" aria-label="搜索图库"/>{query ? <button className="gallery-search-clear" aria-label="清空搜索" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={15}/></button> : <kbd>Ctrl F</kbd>}</label>
        <div className="gallery-header-actions">
          <div className="gallery-segment" role="group" aria-label="图片筛选"><button className={`gallery-button${!favorites ? ' is-active' : ''}`} aria-pressed={!favorites} onClick={() => setFavorites(false)}>全部</button><button className={`gallery-button gallery-filter${favorites ? ' is-active' : ''}`} aria-pressed={favorites} onClick={() => setFavorites(true)}><Star size={15}/><span>收藏</span></button></div>
          <div className="gallery-segment gallery-density" role="group" aria-label="图片密度"><button className={`gallery-button${!compact ? ' is-active' : ''}`} aria-pressed={!compact} onClick={() => setCompact(false)}>舒展</button><button className={`gallery-button${compact ? ' is-active' : ''}`} aria-pressed={compact} onClick={() => setCompact(true)}><LayoutGrid size={15}/><span>紧凑</span></button></div>
          <button ref={exit} className="gallery-icon-button gallery-exit" aria-label="关闭图库" title="关闭图库 · Esc" onClick={() => void close()}><X size={21}/></button>
        </div>
      </header>
      <div className="gallery-meta"><span>{query ? `搜索结果 · ${items.length} 张` : favorites ? `收藏 · ${items.length} 张` : `${items.length} 张图片`}</span><span>最近添加</span></div>
      <div ref={scroll} className="gallery-scroll">
        <div ref={grid} className="gallery-wall" role="list" aria-label="全部图片" style={{ height: Math.max(layout.height, loading || !items.length ? 300 : 0) }}>
          {items.map((item, index) => { const tile = layout.tiles[index]; return <div role="listitem" className="gallery-tile" key={item.id} style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }}><button ref={element => { if (element) cards.current.set(item.id, element); else cards.current.delete(item.id); }} className="gallery-card" aria-label={`查看 ${item.name}，${item.width} × ${item.height}`} onClick={() => { restoreId.current = item.id; setSelectedId(item.id); }} onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            let target: string | null = null;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") target = adjacentGalleryId(ids, item.id, 1);
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = adjacentGalleryId(ids, item.id, -1);
            if (event.key === "Home") target = ids[0] ?? null;
            if (event.key === "End") target = ids.at(-1) ?? null;
            if (target) { event.preventDefault(); cards.current.get(target)?.focus(); }
          }}><span className="gallery-card-image" style={{ height: tile.imageHeight }}><Thumbnail item={item}/><span className="gallery-card-expand"><Expand size={18} aria-hidden="true"/></span>{item.pinned && <span className="gallery-card-favorite" title="已收藏"><Star size={12} fill="currentColor" aria-hidden="true"/></span>}</span><span className="gallery-card-caption"><span title={item.name}>{item.name}</span><small>{item.width} × {item.height}</small></span></button></div>; })}
          {loading && !snapshot && <div className="gallery-empty" role="status"><LoaderCircle size={28} className="gallery-spinner"/><h2>正在加载图片…</h2></div>}
          {!loading && !items.length && <div className="gallery-empty"><Images size={36} aria-hidden="true"/><h2>{query ? "没有匹配的图片" : favorites ? "暂无收藏" : error ? "图库暂时无法加载" : "暂无图片"}</h2><p>{query ? "试试其他名称或来源" : favorites ? "收藏的图片会显示在这里" : "截图、粘贴或导入后查看图片"}</p>{query || favorites ? <button className="gallery-button" onClick={() => { setQuery(""); setFavorites(false); }}>查看全部</button> : error ? <button className="gallery-button" onClick={() => void load()}><RotateCcw size={16} aria-hidden="true"/>重新加载</button> : null}</div>}
        </div>
        {items.length > 0 && <p className="gallery-end">已显示全部 {items.length} 张图片</p>}
      </div>
    </div>
    {selected && <GalleryImageViewer source={imageSource(selected)} item={selected} index={items.findIndex(item => item.id === selected.id)} count={items.length} onClose={closeViewer} onNavigate={navigate} onAction={action}/>}
    {notice && <div className="gallery-toast" role="status"><Check size={16} aria-hidden="true"/>{notice}</div>}
    {error && <div className="gallery-error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError("")}><X size={17}/></button></div>}
  </main>;
}
