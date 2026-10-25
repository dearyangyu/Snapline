import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  FolderOpen,
  Eye,
  EyeOff,
  RotateCcw,
  Image,
  Images,
  Keyboard,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  Pin,
  Star,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Video,
  X,
} from "./icons";
import Editor from "./Editor";
import Logo from "./BrandLogo";
import CaptureOverlay from "./CaptureOverlay";
import PinWindow from "./PinWindow";
import Gallery from "./Gallery";
import TopAnchor from "./TopAnchor";
import AnchorGlow from "./AnchorGlow";
import ShelfPreview from "./ShelfPreview";
import Select from "./Select";
import PetSettings from "./PetSettings";
import { openShelfHoverPreview, ShelfHoverPreviewTimer } from "./shelfHoverPreview";
import { useShelfCards } from "./useShelfCards";
import { SHELF_REFLOW_MS, shelfReflowOffset } from "./shelfCards";
import { initialShelfDragVisual, measureShelfDragVisual, ShelfDragVisualSource, shelfDragVisualState, type ShelfDragVisualEvent } from "./shelfDragVisual";
import { useShelfPresentation } from "./useShelfPresentation";
import ClotheslineRope from "./ClotheslineRope";
import PerchedPet from "./PerchedPet";
import { normalizeIslandPets } from "./petCatalog";
import { useShelfRopeMotion } from "./useShelfRopeMotion";
import HangingCard from "./HangingCard";
import { clotheslineAttachment } from "./clothesline";
import { clearImageSelection, guardShelfDocumentSelection, ImageDragGesture, preventImageBrowserDrag } from "./imageDrag";
import "./clothesline.css";
import { createDemo } from "./demo";
import { shelfPageDistance, shelfPosition, shelfWheelDelta, type ShelfPosition } from "./shelfNavigation";
import { retainShelfSelection, shelfManagementItems, ShelfVisibilityBatch, type ShelfManagementScope } from "./shelfManagement";
import {
  dayLabel,
  defaultSettings,
  formatTime,
  selectItems,
  shelfItems,
  type AppSnapshot,
  type Capture,
  type Settings,
} from "./model";
const native = isTauri();
const shelf = new URLSearchParams(location.search).get("view") === "shelf";
const sourceOf = (item: Capture) =>
  native ? convertFileSrc(item.path) : item.thumbnail;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "selected" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function ShortcutInput({value,label,onChange}:{value:string;label:string;onChange:(value:string)=>void}) {
  const [recording,setRecording] = useState(false);
  return <button className={`shortcut-input ${recording?'recording':''}`} aria-label={`${label}快捷键：${value}`} onClick={()=>setRecording(true)} onBlur={()=>setRecording(false)}
    onKeyDown={event=>{
      if(!recording && (event.key==='Enter'||event.key===' ')){event.preventDefault();setRecording(true);return;}
      if(!recording)return;
      if(event.key==='Tab'){setRecording(false);return;}
      event.preventDefault();event.stopPropagation();
      if(event.key==='Escape'){setRecording(false);return;}
      if(['Control','Alt','Shift','Meta'].includes(event.key))return;
      if(!event.ctrlKey&&!event.altKey&&!/^F\d{1,2}$/.test(event.key))return;
      const key=event.key.length===1?event.key.toUpperCase():event.key;
      onChange([event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Super':'',key].filter(Boolean).join('+'));
      setRecording(false);
    }}>{recording?'请按组合键…':value.replace('Control','Ctrl')}</button>;
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

export default function App() {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "capture") return <CaptureOverlay />;
  if (view === "pin") return <PinWindow />;
  if (view === "gallery") return <Gallery />;
  if (view === "anchor") return <TopAnchor />;
  if (view === "anchor-glow") return <AnchorGlow />;
  if (view === "shelf-preview") return <ShelfPreview />;
  return <LibraryApp />;
}
function LibraryApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() =>
    native
      ? { items: [], settings: defaultSettings, storagePath: "" }
      : createDemo(),
  );
  const [page, setPage] = useState<"recent" | "pinned" | "shelf" | "settings">("recent"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [toast, setToast] = useState<{ message: string; error: boolean; undoId?: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [settingsSaving, setSettingsSaving] = useState(false),
    [loading, setLoading] = useState(native),
    [loadError, setLoadError] = useState(""),
    [draggingOver, setDraggingOver] = useState(false),
    [selected, setSelected] = useState<Capture | null>(null),
    [clearConfirm, setClearConfirm] = useState(false);
  const [shelfScope, setShelfScope] = useState<ShelfManagementScope>('visible');
  const [shelfQuery, setShelfQuery] = useState('');
  const [shelfSelection, setShelfSelection] = useState<string[]>([]);
  const [shelfUpdating, setShelfUpdating] = useState(false);
  const shelfBatch = useRef(new ShelfVisibilityBatch());
  const [startupWarnings,setStartupWarnings] = useState<string[]>([]);
  const shelfTrack = useRef<HTMLDivElement>(null);
  const shelfRope = useRef<SVGSVGElement>(null);
  const hoverPreview = useRef(new ShelfHoverPreviewTimer());
  const previewSession = useRef<number | null>(null);
  const previewItems = useRef(new Map<number, string>());
  const dragVisualSource = useRef(new ShelfDragVisualSource());
  const [dragVisual, setDragVisual] = useState(initialShelfDragVisual);
  const shelfPositions = useRef(new Map<string, { left: number; top: number }>());
  const shelfReflows = useRef(new Map<string, Animation>());
  const reflowRevision = useRef(0);
  const visibleShelfItems = shelfItems(snapshot.items);
  const [shelfWidth, setShelfWidth] = useState(window.innerWidth);
  const [shelfCopied, setShelfCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shelfView, setShelfView] = useState<ShelfPosition>({ first: 0, last: 0, previous: false, next: false });
  const browserInput = useRef<HTMLInputElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    imageDrag = useRef(new ImageDragGesture()),
    dragged = useRef(false),
    holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    settingsBusy = useRef(false);
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), error ? 6500 : 3000);
  }, []);
  const announceShelfDismiss = useCallback((id: string) => {
    setToast({ message: "已从晾衣架收起，图库仍保留", error: false, undoId: id });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  const shelfPresentation = useShelfPresentation(native && shelf, notify);
  const shelfCards = useShelfCards(snapshot.items, shelf, shelfPresentation.visible);
  const shelfPets = normalizeIslandPets(snapshot.settings.islandPets);
  const ropeMotion = useShelfRopeMotion({ enabled: shelf, root: shelfPresentation.root, track: shelfTrack, rope: shelfRope,
    pets: shelfPets, generation: shelfPresentation.generation, visible: shelfPresentation.visible, reversing: shelfPresentation.reversing,
    reflows: shelfReflows, interactions: snapshot.settings.islandPetInteractions !== false });
  useEffect(() => {
    if (!shelf) return;
    hoverPreview.current.configure(snapshot.settings.shelfHoverPreview ?? true, snapshot.settings.shelfHoverDelayMs ?? 1000);
    if (!shelfPresentation.visible) hoverPreview.current.cancel();
    return () => hoverPreview.current.cancel();
  }, [snapshot.settings.shelfHoverPreview, snapshot.settings.shelfHoverDelayMs, shelfPresentation.visible, shelfPresentation.generation]);
  useEffect(() => {
    if (!shelf) return;
    const cancel = () => hoverPreview.current.cancel();
    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || previewSession.current === null) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void invoke('close_shelf_preview', { sessionId: previewSession.current }).catch(() => {});
    };
    window.addEventListener('keydown', closePreviewOnEscape, true);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('wheel', cancel, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      cancel();
      window.removeEventListener('keydown', closePreviewOnEscape, true);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('wheel', cancel, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, []);
  const startHoverPreview = (id: string, element: HTMLElement) => {
    if (!shelfPresentation.visible || imageDrag.current.active || !(snapshot.settings.shelfHoverPreview ?? true)) return;
    const item = snapshot.items.find(entry => entry.id === id);
    if (!item || item.kind !== 'image' || item.shelfHidden) return;
    hoverPreview.current.enter(id, request => {
      if (!element.isConnected || !element.matches(':hover') || imageDrag.current.active) return;
      if (native) void openShelfHoverPreview(request, {
        create: async () => {
          const sessionId = await invoke<number>('show_shelf_preview', { id });
          previewItems.current.set(sessionId, id);
          return sessionId;
        },
        confirm: sessionId => invoke('confirm_shelf_preview', { sessionId }),
        cancelPending: sessionId => {
          // Native ignores this cancellation after the lightbox is visible, so
          // leaving the original card to enter the large image cannot close it.
          void invoke('close_shelf_preview', { sessionId, onlyIfPending: true }).catch(() => {});
        },
      }).catch(error => { if (request.current()) notify(errorMessage(error), true); });
    });
  };
  useEffect(() => {
    if (!shelf) return;
    // Window capture also covers keyboard focus on Document/body, outside the
    // React root. Main-window editors/search never install this guard.
    const selectionGuard = (event: KeyboardEvent | globalThis.PointerEvent) =>
      guardShelfDocumentSelection(event, window.getSelection(), document.activeElement);
    window.addEventListener('keydown', selectionGuard, true);
    window.addEventListener('pointerdown', selectionGuard, true);
    return () => {
      window.removeEventListener('keydown', selectionGuard, true);
      window.removeEventListener('pointerdown', selectionGuard, true);
    };
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setSnapshot(await invoke<AppSnapshot>("get_state"));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("shelf-document", shelf);
    if (!native) return;
    void load();
    let stopped = false;
    const cleanups: (() => void)[] = [];
    const register = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => (stopped ? unlisten() : cleanups.push(unlisten)))
        .catch((error) => notify(errorMessage(error), true));
    };
    register(
      listen<AppSnapshot>("library-changed", (event) =>
        setSnapshot(event.payload),
      ),
    );
    register(
      listen<string>("app-error", (event) => notify(event.payload, true)),
    );
    if (shelf) register(listen<{ id: string }>('shelf-dismissed', event => {
      hoverPreview.current.cancel();
      announceShelfDismiss(event.payload.id);
    }));
    if (shelf) {
      register(listen<ShelfDragVisualEvent>('shelf-drag-visual', event => setDragVisual(current => shelfDragVisualState(current, event.payload))));
      register(listen<{ sessionId: number }>('shelf-preview-opened', event => {
        previewSession.current = event.payload.sessionId;
        const id = previewItems.current.get(event.payload.sessionId);
        if (id) hoverPreview.current.shown(id);
      }));
      register(listen<{ sessionId: number }>('shelf-preview-closed', event => {
        const id = previewItems.current.get(event.payload.sessionId);
        if (id && previewSession.current === event.payload.sessionId) hoverPreview.current.closed(id);
        previewItems.current.delete(event.payload.sessionId);
        if (previewSession.current === event.payload.sessionId) previewSession.current = null;
      }));
    }
    if (!shelf) {
      void invoke<string[]>('get_startup_warnings').then(warnings=>{
        if (!stopped) setStartupWarnings(warnings);
      }).catch(error=>notify(errorMessage(error),true));
      register(
        listen<{ id: string }>("preview-item", (event) => {
          void invoke<AppSnapshot>("get_state")
            .then((next) => {
              if (stopped) return;
              setSnapshot(next);
              const item = next.items.find(
                (entry) => entry.id === event.payload.id,
              );
              if (item) setSelected(item);
              else notify("这张图片已被移除，请重新选择。", true);
            })
            .catch((error) => notify(errorMessage(error), true));
        }),
      );
    }
    register(
      getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        setDraggingOver(payload.type === "over" || payload.type === "enter");
        if (payload.type === "drop") {
          setBusy(true);
          void invoke<AppSnapshot>("import_files", { paths: payload.paths })
            .then(setSnapshot)
            .catch((error) => notify(errorMessage(error), true))
            .finally(() => setBusy(false));
        }
      }),
    );
    return () => {
      stopped = true;
      cleanups.forEach((fn) => fn());
    };
  }, [load, notify, announceShelfDismiss]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        snapshot.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : snapshot.settings.theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snapshot.settings.theme]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(holdTimer.current);
      clearTimeout(copiedTimer.current);
      for (const motion of shelfReflows.current.values()) motion.cancel();
      shelfReflows.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (!clearConfirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setClearConfirm(false);
      if (event.key === "Tab") {
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          ".confirm-dialog button",
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clearConfirm]);
  const setShelfVisibility = async (id: string, hidden: boolean) => {
    hoverPreview.current.cancel(id);
    if (native) setSnapshot(await invoke<AppSnapshot>('set_shelf_hidden', { id, hidden }));
    else setSnapshot(old => ({ ...old, items: old.items.map(item => item.id === id ? { ...item, shelfHidden: hidden } : item) }));
    if (hidden) announceShelfDismiss(id);
    else notify("已恢复到晾衣架");
  };
  const manageShelf = async (ids: readonly string[], hidden: boolean) => {
    if (shelfBatch.current.busy) return;
    setShelfUpdating(true);
    try {
      const result = await shelfBatch.current.run(snapshot.items, ids, hidden, async (id, nextHidden) => {
        if (native) setSnapshot(await invoke<AppSnapshot>('set_shelf_hidden', { id, hidden: nextHidden }));
        else setSnapshot(old => ({ ...old, items: old.items.map(item => item.id === id ? { ...item, shelfHidden: nextHidden } : item) }));
      });
      if (!result) return;
      setShelfSelection(current => current.filter(id => !result.completed.includes(id)));
      const verb = hidden ? '收起' : '恢复';
      if (result.pending.length) notify(`${result.completed.length ? `已${verb} ${result.completed.length} 项；` : ''}其余项目未处理：${errorMessage(result.error)}`, true);
      else if (result.completed.length) notify(`已${verb} ${result.completed.length} 项${hidden ? '，图库仍保留' : '到晾衣架'}`);
    } finally { setShelfUpdating(false); }
  };
  const action = async (command: string, id?: string, extra?: Record<string, unknown>) => {
    try {
      if (id && command === 'preview_shelf_item') {
        hoverPreview.current.explicit();
        if (native) {
          const sessionId = await invoke<number>('show_shelf_preview', { id, explicit: true });
          previewItems.current.set(sessionId, id);
          await invoke('confirm_shelf_preview', { sessionId });
        }
        else notify('Windows 应用中可打开临时大图预览');
        return;
      }
      if (id && (command === 'hide_shelf_item' || command === 'restore_shelf_item')) {
        await setShelfVisibility(id, command === 'hide_shelf_item');
        return;
      }
      if (!native) {
        if (command === "toggle_pin")
          setSnapshot((old) => ({
            ...old,
            items: old.items.map((item) =>
              item.id === id ? { ...item, pinned: !item.pinned } : item,
            ),
          }));
        else if (command === "remove_item") {
          setSnapshot((old) => ({
            ...old,
            items: old.items.filter((item) => item.id !== id),
          }));
          notify("已从图库移除");
        } else if (command === "clear_unpinned") {
          setSnapshot((old) => ({
            ...old,
            items: old.items.filter((item) => item.pinned),
          }));
          notify("未收藏的图片已清理");
        } else if (command === "import_files") browserInput.current?.click();
        else if (command === "export_item") {
          const item = snapshot.items.find((item) => item.id === id);
          if (item) {
            const a = document.createElement("a");
            a.href = item.thumbnail;
            a.download = item.thumbnail.startsWith("data:image/svg")
              ? item.name.replace(/\.[^.]+$/, ".svg")
              : item.name;
            a.click();
          }
        } else if (command === "open_item") {
          const item = snapshot.items.find((item) => item.id === id);
          if (item) setSelected(item);
        } else if (command === "open_shelf") location.search = "?view=shelf";
        else if (command === "hide_shelf") location.search = "";
        else if (command === "show_main") location.search = "";
        else if (command === "show_gallery") location.search = "?view=gallery";
        else if (command === "reset_shelf_anchor") notify("桌面版可重置顶部入口位置");
        else if (command === "copy_item")
          notify("浏览器演示：请在 Windows 应用中使用图片复制");
        else notify("此功能在 Windows 桌面应用中可用");
        return;
      }
      const response = await invoke<AppSnapshot | null>(
        command,
        id ? { id, ...extra } : extra,
      );
      if (response && Array.isArray(response.items)) setSnapshot(response);
      if (command === "copy_item") {
        if (shelf && id) {
          setShelfCopied(id);
          clearTimeout(copiedTimer.current);
          copiedTimer.current = setTimeout(() => setShelfCopied(null), 1700);
        } else notify("已复制到剪贴板");
      }
      if (command === "remove_item") notify("已从图库移除，源文件不受影响");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };
  const importFiles = async () => {
    if (busy) return;
    setBusy(true);
    await action("import_files");
    setBusy(false);
  };
  const saveSettings = async (patch: Partial<Settings>) => {
    // A synchronous lock also prevents a second event before React paints disabled controls.
    if (settingsBusy.current) return;
    settingsBusy.current = true;
    setSettingsSaving(true);
    try {
      if (native) {
        const current = await invoke<AppSnapshot>("get_state");
        const settings = { ...current.settings, ...patch };
        setSnapshot(await invoke<AppSnapshot>("update_settings", { settings }));
        setStartupWarnings(await invoke<string[]>('get_startup_warnings'));
      } else
        setSnapshot((old) => ({
          ...old,
          settings: { ...old.settings, ...patch },
        }));
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      settingsBusy.current = false;
      setSettingsSaving(false);
    }
  };
  const chooseFolder = async () => {
    if (settingsBusy.current) return;
    if (!native) {
      notify("Windows 应用中可添加要自动收集的文件夹");
      return;
    }
    settingsBusy.current = true;
    setSettingsSaving(true);
    try {
      setSnapshot(await invoke<AppSnapshot>("choose_watch_folder"));
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      settingsBusy.current = false;
      setSettingsSaving(false);
    }
  };
  const importBrowserFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Capture[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
        continue;
      const thumbnail = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const kind = file.type.startsWith("video/") ? "video" : "image";
      let width = 0,
        height = 0;
      if (kind === "image") {
        const image = new window.Image();
        image.src = thumbnail;
        await image
          .decode()
          .then(() => {
            width = image.naturalWidth;
            height = image.naturalHeight;
          })
          .catch(() => undefined);
      }
      added.push({
        id: crypto.randomUUID(),
        name: file.name,
        path: "",
        thumbnail,
        kind,
        width,
        height,
        createdAt: Date.now(),
        source: "导入图片",
        pinned: false,
        shelfHidden: false,
      });
    }
    setSnapshot((old) => ({ ...old, items: [...added, ...old.items] }));
    notify(`已导入 ${added.length} 个文件`);
    if (browserInput.current) browserInput.current.value = "";
  };
  const saveEdited = async (dataUrl: string) => {
    if (!selected) return;
    if (native)
      setSnapshot(
        await invoke<AppSnapshot>("save_edited_image", {
          id: selected.id,
          dataUrl,
        }),
      );
    else
      setSnapshot((old) => ({
        ...old,
        items: [
          {
            ...selected,
            id: crypto.randomUUID(),
            name: `标注_${selected.name}`,
            thumbnail: dataUrl,
            createdAt: Date.now(),
            source: "标注副本",
            pinned: false,
            shelfHidden: false,
          },
          ...old.items,
        ],
      }));
    setSelected(null);
    notify("标注已保存为新副本");
  };
  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  };
  const endPointer = (pointerId?: number, sourceId?: string) => {
    if (imageDrag.current.cancel(pointerId, sourceId)) {
      dragVisualSource.current.cancel(pointerId, sourceId);
      cancelHold();
    }
  };
  const startPointer = (event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    // Pointer capture routes movement; it does not suppress selection or the
    // browser's HTML drag. Cancel that default before the first fast movement.
    event.preventDefault();
    const surface = event.currentTarget.closest('.shelf-root, .capture-grid') ?? event.currentTarget;
    clearImageSelection(surface, window.getSelection());
    event.currentTarget.focus({ preventScroll: true });
    hoverPreview.current.cancel();
    cancelHold();
    dragged.current = false;
    imageDrag.current.begin(id, event, event.currentTarget);
    dragVisualSource.current.begin(id, event.pointerId,
      shelf && snapshot.items.find(item => item.id === id)?.kind === 'image'
        ? measureShelfDragVisual(event.currentTarget, event) : undefined);
    if (shelf) {
      holdTimer.current = setTimeout(() => {
        holdTimer.current = undefined;
        dragged.current = true;
        imageDrag.current.cancel();
        dragVisualSource.current.cancel();
        if (!native) {
          notify("Windows 应用中，长按可打开预览与标注");
          return;
        }
        void invoke("show_main")
          .then(() => emitTo("main", "preview-item", { id }))
          .catch((error) => notify(errorMessage(error), true));
      }, 500);
    }
  };
  const movePointer = (event: PointerEvent<HTMLElement>, beforeNativeDrag?: () => void) => {
    if (imageDrag.current.owns(event.pointerId) && event.buttons & 1) event.preventDefault();
    const id = imageDrag.current.commitMove(event);
    if (!id) return;
    cancelHold();
    // Consume before either capture owner can synchronously dispatch onEnd.
    const visual = dragVisualSource.current.take(id, event.pointerId);
    dragged.current = true;
    imageDrag.current.releaseCapture();
    beforeNativeDrag?.();
    if (native) void action("start_drag", id, visual ? { visual } : undefined);
  };
  useEffect(() => {
    const released = (event: globalThis.PointerEvent) => endPointer(event.pointerId);
    const blurred = () => endPointer();
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', released);
    window.addEventListener('blur', blurred);
    return () => {
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', released);
      window.removeEventListener('blur', blurred);
      imageDrag.current.cancel();
      dragVisualSource.current.cancel();
    };
  }, []);
  useLayoutEffect(() => {
    const track = shelfTrack.current;
    if (!shelf || !track) return;
    const update = (animate = false) => {
      const cards = Array.from(track.querySelectorAll<HTMLElement>(".hanging-card"));
      const present = new Set(cards.map(card => card.dataset.shelfId!));
      for (const [id, animation] of shelfReflows.current) {
        if (!present.has(id) || !shelfPresentation.visible || shelfCards.reduced) { animation.cancel(); shelfReflows.current.delete(id); }
      }
      for (const id of shelfPositions.current.keys()) if (!present.has(id)) shelfPositions.current.delete(id);
      setShelfWidth(track.clientWidth);
      // Batch old visual/layout reads before writing any new attachment positions.
      const layouts = cards.map(card => {
        const id = card.dataset.shelfId!;
        const before = shelfPositions.current.get(id);
        const transform = getComputedStyle(card).transform;
        const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
        const attachment = clotheslineAttachment(card.offsetLeft, card.offsetWidth, track.scrollLeft, track.clientWidth);
        return { card, id, before, matrix, attachment, left: card.offsetLeft, width: card.offsetWidth };
      });
      for (const { card, attachment } of layouts) {
        card.style.setProperty('--peg-top', `${attachment.top}px`);
        card.style.opacity = String(attachment.opacity);
      }
      for (const { card, id, before, matrix, attachment, left, width } of layouts) {
        const after = { left, top: attachment.top };
        shelfPositions.current.set(id, after);
        if (animate && before && left + width > track.scrollLeft && left < track.scrollLeft + track.clientWidth) {
          const offset = shelfReflowOffset(before, after, { x: matrix.m41, y: matrix.m42 });
          shelfReflows.current.get(id)?.cancel();
          if (Math.abs(offset.x) + Math.abs(offset.y) > .5) {
            const motion = card.animate([{ transform: `translate(${offset.x}px, ${offset.y}px)` }, { transform: 'translate(0px, 0px)' }], { duration: SHELF_REFLOW_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
            if (card.querySelector('.hanging-swing.is-pressed')) motion.pause();
            shelfReflows.current.set(id, motion);
            motion.onfinish = () => { if (shelfReflows.current.get(id) === motion) shelfReflows.current.delete(id); };
          }
        } else if (before && (before.left !== after.left || before.top !== after.top)) {
          shelfReflows.current.get(id)?.cancel(); shelfReflows.current.delete(id);
        }
      }
      const next = shelfPosition(track.scrollLeft, track.clientWidth, track.scrollWidth,
        layouts.filter(({ card }) => !card.classList.contains('is-exiting')).map(({ left, width }) => ({ left, width })));
      setShelfView(old => old.first === next.first && old.last === next.last && old.previous === next.previous && old.next === next.next ? old : next);
      ropeMotion.refresh();
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || track.scrollWidth <= track.clientWidth) return;
      const delta = shelfWheelDelta(event.deltaX, event.deltaY, event.deltaMode, track.clientWidth);
      if (!delta) return;
      event.preventDefault();
      clearTimeout(holdTimer.current);
      if (imageDrag.current.active) dragged.current = true;
      imageDrag.current.cancel();
      dragVisualSource.current.cancel();
      track.scrollLeft += delta;
    };
    const onScroll = () => { hoverPreview.current.cancel(); update(); };
    const observer = new ResizeObserver(() => update());
    observer.observe(track);
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("wheel", wheel, { passive: false });
    const animate = shelfCards.revision !== reflowRevision.current && shelfPresentation.visible && !shelfCards.reduced;
    reflowRevision.current = shelfCards.revision;
    update(animate);
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("wheel", wheel);
    };
  }, [snapshot.items, shelfCards.cards, shelfCards.revision, shelfCards.reduced, shelfPresentation.visible]);
  const browseShelf = (direction: number) => {
    hoverPreview.current.cancel();
    endPointer();
    const track = shelfTrack.current;
    if (!track) return;
    track.scrollBy({ left: direction * shelfPageDistance(track.clientWidth), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  const shownItems = selectItems(
    snapshot.items,
    query,
    page === "pinned",
    filter,
  );
  const managedItems = shelfManagementItems(snapshot.items, shelfScope, shelfQuery);
  useEffect(() => {
    setShelfSelection(current => {
      const next = page === 'shelf' ? retainShelfSelection(current, shelfManagementItems(snapshot.items, shelfScope, shelfQuery)) : [];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [page, shelfScope, shelfQuery, snapshot.items]);
  const managedSelection = retainShelfSelection(shelfSelection, managedItems);
  const allManagedSelected = managedItems.length > 0 && managedSelection.length === managedItems.length;
  const groups = [
    ...new Set(shownItems.map((item) => dayLabel(item.createdAt))),
  ];
  const captureButton = (
    <button
      className="button primary"
      onClick={() => void action("start_capture")}
    >
      <Plus size={16} />
      <span>截取屏幕</span>
      <kbd>{snapshot.settings.captureShortcut}</kbd>
    </button>
  );
  const toastView = toast && (
    <div
      className={`toast ${toast.error ? "error" : ""}`}
      role={toast.error ? "alert" : "status"}
    >
      {toast.error ? <X size={17} /> : <Check size={17} />}
      <span>{toast.message}</span>
      {toast.undoId && <button className="toast-undo" onClick={() => void action("restore_shelf_item", toast.undoId)}><RotateCcw size={14} />撤销</button>}
      <button aria-label="关闭提示" onClick={() => setToast(null)}>
        <X size={14} />
      </button>
    </div>
  );
  const fileInput = (
    <input
      hidden
      type="file"
      ref={browserInput}
      multiple
      accept="image/*,video/*"
      onChange={(event) =>
        void importBrowserFiles(event.target.files).catch((error) =>
          notify(errorMessage(error), true),
        )
      }
    />
  );
  if (shelf)
    return (
      <main ref={shelfPresentation.root} className={`shelf-root${native ? " is-native-shelf" : ""}`} onDragStartCapture={preventImageBrowserDrag}
        onPointerLeave={() => { hoverPreview.current.leave(); if (!imageDrag.current.captured) endPointer(); }}>
        <ClotheslineRope width={shelfWidth} ropeRef={shelfRope} />
        {shelfPets.map((petId, index) => <span key={petId} className="shelf-rope-perch" data-rope-pet={index} aria-hidden="true"><PerchedPet petId={petId} /></span>)}
        <div className="shelf-toolbar" role="toolbar" aria-label="晾图操作" title="滚轮左右浏览 · 单击复制 · 长按标注 · 拖出分享">
          <Images size={15} aria-hidden="true" />
          <span className="shelf-count" aria-label={`共 ${visibleShelfItems.length} 项`}>{visibleShelfItems.length} 张</span>
          <span className="shelf-toolbar-divider" aria-hidden="true" />
          <span className="shelf-position" aria-live="polite">{shelfView.first ? `${shelfView.first}–${shelfView.last}` : "0"} / {visibleShelfItems.length}</span>
          <IconButton label="向左浏览晾图" disabled={!shelfView.previous} onClick={() => browseShelf(-1)}><ChevronLeft size={17} /></IconButton>
          <IconButton label="向右浏览晾图" disabled={!shelfView.next} onClick={() => browseShelf(1)}><ChevronRight size={17} /></IconButton>
          <span className="shelf-toolbar-divider" aria-hidden="true" />
          <button className="shelf-gallery-button" title="全屏瀑布流浏览所有图片" onClick={() => void action("show_gallery")}>
            <Maximize2 size={15} aria-hidden="true" /><span>全屏图库</span>
          </button>
          <IconButton
            label="截取屏幕"
            onClick={() => void action("start_capture")}
          >
            <Plus size={16} />
          </IconButton>
          <IconButton label="导入文件" onClick={() => void importFiles()}>
            <Upload size={16} />
          </IconButton>
          <IconButton label="打开图库" onClick={() => void action("show_main")}>
            <LayoutGrid size={16} />
          </IconButton>
          <IconButton
            label="收起晾图"
            onClick={() => void action("hide_shelf")}
          >
            <ChevronDown className="rotate-up" size={16} />
          </IconButton>
        </div>
        <div className="hanging-items" ref={shelfTrack} tabIndex={0} role="region" aria-label="晾图列表" aria-describedby="shelf-browse-hint"
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              if (event.key === "Home" || event.key === "End") event.currentTarget.scrollLeft = event.key === "Home" ? 0 : event.currentTarget.scrollWidth;
              else browseShelf(event.key === "ArrowLeft" || event.key === "PageUp" ? -1 : 1);
            }
          }}>
          {shelfCards.cards.map(({ item, exitToken }) => <HangingCard key={item.id} item={item} source={item.thumbnail || sourceOf(item)}
            generation={shelfPresentation.generation} visible={shelfPresentation.visible} reversing={shelfPresentation.reversing} copied={shelfCopied === item.id} dragged={dragged}
            exitToken={exitToken} onExitFinished={shelfCards.finish}
            nativeDragging={dragVisual.id === item.id}
            onHover={startHoverPreview} onHoverEnd={(id, left) => left ? hoverPreview.current.leave(id) : hoverPreview.current.cancel(id)}
            onStart={startPointer} onMove={movePointer} onEnd={() => endPointer(undefined, item.id)} onAction={(command, id) => void action(command, id)} />)}
          {shelfCards.cards.length === 0 && (
            <div className="shelf-empty">
              <Images size={26} />
              <span>{snapshot.items.length ? "图片已收起，可在图库中恢复。" : "截图会显示在这里。"}</span>
              <button className="text-button" onClick={() => void (snapshot.items.length ? action("show_main") : importFiles())}>{snapshot.items.length ? "打开图库" : "导入图片"}</button>
            </div>
          )}
        </div>
        <span className="shelf-browse-hint" id="shelf-browse-hint">滚轮或触控板左右浏览；聚焦列表后用方向键、Home、End 浏览。单击复制，长按标注，拖出分享。</span>
        {fileInput}
        {toastView}
      </main>
    );

  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        if (!native) {
          event.preventDefault();
          setDraggingOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDraggingOver(false);
      }}
      onDrop={(event) => {
        if (!native) {
          event.preventDefault();
          setDraggingOver(false);
          void importBrowserFiles(event.dataTransfer.files).catch((error) =>
            notify(errorMessage(error), true),
          );
        }
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            <strong>
              晾图<span>Snapline</span>
            </strong>
          </div>
        </div>
        <div className="sidebar-label">图库</div>
        <nav aria-label="主导航">
          <button
            className={page === "recent" ? "nav-item active" : "nav-item"}
            aria-label="全部截图" title="全部截图"
            onClick={() => setPage("recent")}
          >
            <Images size={19} />
            <span>全部截图</span>
            <span className="nav-count">{snapshot.items.length}</span>
          </button>
          <button
            className={page === "pinned" ? "nav-item active" : "nav-item"}
            aria-label="已收藏" title="已收藏"
            onClick={() => setPage("pinned")}
          >
            <Star size={18} />
            <span>已收藏</span>
            <span className="nav-count">
              {snapshot.items.filter((item) => item.pinned).length}
            </span>
          </button>
        </nav>
        <div className="sidebar-tools">
          <button className={page === 'shelf' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('shelf')} title="管理晾衣架" aria-label="晾衣架管理" aria-current={page === 'shelf' ? 'page' : undefined}><Images size={17} /><span>晾衣架</span><span className="nav-count">{visibleShelfItems.length}</span></button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            aria-label="偏好设置" title="偏好设置"
            onClick={() => setPage("settings")}
          >
            <Settings2 size={19} />
            <span>偏好设置</span>
          </button>
          <span className="version">Snapline for Windows · v0.4.25</span>
        </div>
      </aside>
      <main className="main-content">
        {startupWarnings.length>0 && <div className="startup-warning" role="alert"><Keyboard size={18}/><div><strong>部分快捷键未能注册</strong>{startupWarnings.map((warning,index)=><p key={index}>{warning}</p>)}</div><button className="button secondary" onClick={()=>setPage('settings')}>修改快捷键</button></div>}
        <header className="topbar">
          <div className="breadcrumb">
            晾图<span>/</span>
            <strong>
              {page === "settings"
                ? "偏好设置"
                : page === "shelf"
                  ? "晾衣架"
                : page === "pinned"
                  ? "已收藏"
                  : "全部截图"}
            </strong>
            {!native && <span className="demo-pill">浏览器演示</span>}
          </div>
          <div className="topbar-status">
            <span
              className={`status-dot ${snapshot.settings.watchClipboard ? "" : "paused"}`}
            />
            {snapshot.settings.watchClipboard
              ? "正在收集剪贴板图片"
              : "剪贴板收集未开启"}
          </div>
        </header>
        {page === "settings" ? (
          <section className="settings-page">
            <div className="page-heading">
              <div>
                <h1>偏好设置</h1>
              </div>
            </div>
            <fieldset
              className="settings-controls"
              disabled={settingsSaving}
              aria-busy={settingsSaving}
            >
              <div className="settings-section">
                <div className="section-heading"><Keyboard size={19}/><h2>全局快捷键</h2></div>
                <p className="section-description">点击后按下新组合键，Esc 取消。</p>
                {([
                  {key:'captureShortcut',title:'区域截图'},
                  {key:'pasteShortcut',title:'贴出剪贴板图片'},
                  {key:'shelfShortcut',title:'展开 / 收起晾衣架'},
                ] as const).map(row=><div className="setting-row" key={row.key}>
                  <div><strong>{row.title}</strong></div>
                  <ShortcutInput value={snapshot.settings[row.key]} label={row.title} onChange={value=>void saveSettings({[row.key]:value})}/>
                </div>)}
              </div>
              <div className="settings-section">
                <div className="section-heading">
                  <Clipboard size={19} />
                  <h2>收集与呈现</h2>
                </div>
                <div className="setting-row">
                  <div><strong>截图时隐藏晾图窗口</strong><p>开启后，截图时临时隐藏设置界面、灵动岛等窗口。</p></div>
                  <Toggle checked={snapshot.settings.hideWindowsOnCapture ?? false} label="截图时隐藏晾图窗口"
                    onChange={() => void saveSettings({ hideWindowsOnCapture: !(snapshot.settings.hideWindowsOnCapture ?? false) })} />
                </div>
                {(
                  [
                    {
                      key: "watchClipboard",
                      title: "自动收集剪贴板图片",
                      description: "截图或复制图片后，自动放到晾图中。",
                    },
                    {
                      key: "edgeReveal",
                      title: "显示顶部固定入口",
                      description: "悬停宠物展开晾衣架；拖动左侧手柄调整位置，自动记住。",
                    },
                    {
                      key: "peekOnCapture",
                      title: "新截图时短暂展示",
                      description: "收集新图片后短暂展开晾衣架。",
                    },
                    {
                      key: "shelfShakeToDismiss",
                      title: "拖动摇晃收起图片",
                      description: "拖动晾衣架图片时左右摇晃，只从晾衣架收起；图库和原文件保留。",
                    },
                    {
                      key: "shelfHoverPreview",
                      title: "悬停预览大图",
                      description: "鼠标停在晾衣架照片上时显示大图；点击空白处或按 Esc 关闭。",
                    },
                    {
                      key: "startAtLogin",
                      title: "登录 Windows 时启动",
                      description: "开机后在托盘中待命。",
                    },
                  ] as const
                ).map((row) => (
                  <div className="setting-row" key={row.key}>
                    <div>
                      <strong>{row.title}</strong>
                      <p>{row.description}</p>
                    </div>
                    <Toggle
                      checked={snapshot.settings[row.key]}
                      label={row.title}
                      onChange={() =>
                        void saveSettings({
                          [row.key]: !snapshot.settings[row.key],
                        })
                      }
                    />
                  </div>
                ))}
                <div className="setting-row">
                  <div><strong>悬停等待时间</strong><p>按下、拖动或滚动时不会弹出预览。</p></div>
                  <Select label="悬停等待时间" disabled={settingsSaving || !snapshot.settings.shelfHoverPreview} value={String(snapshot.settings.shelfHoverDelayMs ?? 1000)}
                    options={[...new Set([1000, 2000, 3000, 4000, 5000, snapshot.settings.shelfHoverDelayMs ?? 1000])].sort((a,b) => a-b).map(delay => ({ value:String(delay), label:`${delay / 1000} 秒${delay === 1000 ? '（默认）' : ''}` }))}
                    onChange={value => void saveSettings({ shelfHoverDelayMs: Number(value) })} />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>顶部入口位置</strong>
                    <p>拖动入口左侧手柄到顺手的位置；聚焦手柄后也可用左右方向键微调。</p>
                  </div>
                  <button className="button secondary" onClick={() => void action("reset_shelf_anchor")}>恢复默认位置</button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>双击贴图时</strong>
                    <p>可关闭贴图或收起为缩略图；收起后再次双击或点击展开即可恢复。</p>
                  </div>
                  <Select label="双击贴图时" disabled={settingsSaving} value={snapshot.settings.pinDoubleClickAction ?? 'close'}
                    options={[{value:'close',label:'关闭贴图'},{value:'collapse',label:'收起 / 展开'},{value:'none',label:'不执行操作'}]}
                    onChange={value=>void saveSettings({pinDoubleClickAction:value as Settings['pinDoubleClickAction']})} />
                </div>
              </div>
              <PetSettings settings={snapshot.settings} disabled={settingsSaving} onChange={saveSettings} />
              <div className="settings-section">
                <div className="section-heading">
                  <FolderOpen size={19} />
                  <h2>自动收集文件夹</h2>
                  <button
                    className="text-button"
                    onClick={() => void chooseFolder()}
                  >
                    <Plus size={15} />
                    添加文件夹
                  </button>
                </div>
                <p className="section-description">
                  这些文件夹中的新图片和视频会自动加入，源文件会保留。
                </p>
                {snapshot.settings.watchFolders.length ? (
                  snapshot.settings.watchFolders.map((folder) => (
                    <div className="folder-row" key={folder}>
                      <FolderOpen size={17} />
                      <span title={folder}>{folder}</span>
                      <IconButton
                        label={`移除文件夹 ${folder}`}
                        onClick={() =>
                          void saveSettings({
                            watchFolders: snapshot.settings.watchFolders.filter(
                              (path) => path !== folder,
                            ),
                          })
                        }
                      >
                        <X size={16} />
                      </IconButton>
                    </div>
                  ))
                ) : (
                  <div className="folder-empty">
                    还没有添加文件夹。可以添加 Windows「屏幕截图」文件夹。
                  </div>
                )}
              </div>
              <div className="settings-section">
                <div className="section-heading">
                  <Monitor size={19} />
                  <h2>外观与存储</h2>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>界面主题</strong>
                  </div>
                  <div className="segmented">
                    {(
                      [
                        { id: "light", label: "浅色", Icon: Sun },
                        { id: "dark", label: "深色", Icon: Moon },
                        { id: "system", label: "系统", Icon: Monitor },
                      ] as const
                    ).map(({ id, label, Icon }) => (
                      <button
                        className={
                          snapshot.settings.theme === id ? "active" : ""
                        }
                        key={id}
                        onClick={() => void saveSettings({ theme: id })}
                      >
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>保留数量</strong>
                    <p>超出后清理最早的未收藏项目；收藏项目始终保留。</p>
                  </div>
                  <Select label="保留数量" disabled={settingsSaving} value={String(snapshot.settings.maxItems)}
                    options={[25,50,100,200,500].map(count=>({value:String(count),label:`${count} 项`}))}
                    onChange={value=>void saveSettings({maxItems:Number(value)})} />
                </div>
                <div className="storage-path">
                  <FolderOpen size={16} />
                  <div>
                    <strong>存储位置</strong>
                    <span>{snapshot.storagePath || "正在读取存储位置…"}</span>
                  </div>
                </div>
              </div>
            </fieldset>
            <div className="settings-footer">
              <Logo small />
              <span>
                Snapline 晾图 · Windows 版<br />
                <small>灵感源自开源项目 Tendedero · MIT License</small>
              </span>
            </div>
          </section>
        ) : page === 'shelf' ? (
          <section className="shelf-management-page" aria-labelledby="shelf-management-title">
            <div className="page-heading">
              <div><h1 id="shelf-management-title">晾衣架</h1><p>管理顶部展示的图片</p></div>
              <IconButton label="展开桌面晾衣架" onClick={() => void action('open_shelf')}><ArrowUpRight size={18} /></IconButton>
            </div>
            <div className="shelf-management-toolbar">
              <div className="shelf-management-tabs" role="group" aria-label="晾晒状态">
                {([{ id: 'visible', label: '正在晾晒', count: visibleShelfItems.length }, { id: 'hidden', label: '已收起', count: snapshot.items.length - visibleShelfItems.length }] as const).map(tab =>
                  <button type="button" key={tab.id} aria-pressed={shelfScope === tab.id} disabled={shelfUpdating} className={shelfScope === tab.id ? 'is-active' : ''}
                    onClick={() => { setShelfScope(tab.id); setShelfSelection([]); }}><span>{tab.label}</span><small>{tab.count}</small></button>)}
              </div>
              <label className="search-box shelf-management-search"><Search size={17} /><input aria-label="搜索晾衣架图片" placeholder="搜索名称或来源" value={shelfQuery} disabled={shelfUpdating}
                onChange={event => { setShelfQuery(event.target.value); setShelfSelection([]); }} />{shelfQuery && <button type="button" aria-label="清空晾衣架搜索" disabled={shelfUpdating} onClick={() => { setShelfQuery(''); setShelfSelection([]); }}><X size={14} /></button>}</label>
            </div>
            <div className="shelf-management-selection" aria-busy={shelfUpdating}>
              <button type="button" className="shelf-select-all" role="checkbox" aria-checked={allManagedSelected ? true : managedSelection.length ? 'mixed' : false} disabled={!managedItems.length || shelfUpdating}
                onClick={() => setShelfSelection(allManagedSelected ? [] : managedItems.map(item => item.id))}>
                <span className={`shelf-check ${allManagedSelected || managedSelection.length ? 'is-checked' : ''}`}>{allManagedSelected ? <Check size={13} /> : managedSelection.length ? <Minus size={13} /> : null}</span><span>全选当前列表</span>
              </button>
              <span className="shelf-selection-summary" role="status">{shelfUpdating ? '正在更新…' : managedSelection.length ? `已选 ${managedSelection.length} 项` : `${managedItems.length} 项`}</span>
              {managedSelection.length > 0 && <button className="text-button" disabled={shelfUpdating} onClick={() => setShelfSelection([])}>取消选择</button>}
              <button className="button secondary shelf-batch-action" disabled={!managedSelection.length || shelfUpdating} onClick={() => void manageShelf(managedSelection, shelfScope === 'visible')}>
                {shelfUpdating ? <LoaderCircle size={16} className="spin" /> : shelfScope === 'visible' ? <EyeOff size={16} /> : <Eye size={16} />}{shelfScope === 'visible' ? '收起所选' : '恢复所选'}
              </button>
            </div>
            {loading ? <div className="empty-state"><LoaderCircle size={30} className="spin" /><h2>正在读取图片…</h2></div>
              : loadError ? <div className="empty-state"><h2>暂时无法读取晾衣架</h2><p>{loadError}</p><button className="button secondary" onClick={() => void load()}>重新加载</button></div>
              : !managedItems.length ? <div className="empty-state shelf-management-empty"><Images size={34} /><h2>{shelfQuery ? '没有匹配的图片' : shelfScope === 'hidden' ? '没有已收起的图片' : '晾衣架是空的'}</h2>
                <p>{shelfQuery ? '换个名称或来源再试试。' : shelfScope === 'hidden' ? '从晾衣架收起的图片会保留在这里。' : snapshot.items.length ? '切换到“已收起”即可放回图片。' : '截图或导入图片后会出现在这里。'}</p>
                {shelfQuery ? <button className="button secondary" onClick={() => setShelfQuery('')}>清空搜索</button> : shelfScope === 'visible' && !snapshot.items.length ? <button className="button secondary" onClick={() => void importFiles()}><Upload size={16} />导入图片</button> : null}</div>
              : <div className="shelf-management-grid">
                {managedItems.map(item => <article key={item.id} className={`shelf-management-card${managedSelection.includes(item.id) ? ' is-selected' : ''}`}>
                  <button type="button" className="shelf-management-thumbnail" aria-label={`预览 ${item.name}`} onClick={() => setSelected(item)}>
                    {item.kind === 'image' || item.thumbnail.startsWith('data:image/') ? <img src={item.thumbnail || sourceOf(item)} alt="" draggable={false} loading="lazy" /> : <Video size={30} />}
                  </button>
                  <button type="button" className="shelf-item-select" role="checkbox" aria-checked={managedSelection.includes(item.id)} aria-label={`选择 ${item.name}`} disabled={shelfUpdating}
                    onClick={() => setShelfSelection(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>
                    <span className={`shelf-check ${managedSelection.includes(item.id) ? 'is-checked' : ''}`}>{managedSelection.includes(item.id) && <Check size={13} />}</span>
                  </button>
                  <div className="shelf-management-card-info"><h2 title={item.name}>{item.name}</h2><div className="shelf-management-meta"><span>{item.width ? `${item.width} × ${item.height}` : item.kind === 'video' ? '视频' : '图片'}</span><time>{dayLabel(item.createdAt)} {formatTime(item.createdAt)}</time>{item.pinned && <Star size={12} weight="fill" aria-label="已收藏" />}</div>
                    <button type="button" className="shelf-item-action" disabled={shelfUpdating} onClick={() => void manageShelf([item.id], !item.shelfHidden)}>{item.shelfHidden ? <Eye size={15} /> : <EyeOff size={15} />}<span>{item.shelfHidden ? '放回晾衣架' : '从晾衣架收起'}</span></button>
                  </div>
                </article>)}
              </div>}
            <p className="shelf-management-note">收起只改变晾晒状态，图库和原文件仍保留。</p>
          </section>
        ) : (
          <section className="library-page">
            <div className="page-heading">
              <div>
                <h1>
                  {page === "pinned"
                    ? "我的收藏"
                    : "全部截图"}
                </h1>
                <p>
                  {page === "pinned"
                    ? "收藏的图片会一直保留，不参与自动清理。"
                    : `${snapshot.items.length} 个项目 · 单击预览，拖动分享`}
                </p>
              </div>
              <div className="header-actions">
                <button className="button secondary" onClick={()=>void action('paste_clipboard')} title="将剪贴板图片贴到屏幕">
                  <Pin size={17}/><span>贴图</span><kbd>{snapshot.settings.pasteShortcut}</kbd>
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void importFiles()}
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Upload size={17} />
                  )}
                  导入
                </button>
                {captureButton}
              </div>
            </div>
            <div className="library-toolbar">
              <button className="utility-capture" onClick={()=>void action('capture_fullscreen')} title="截取鼠标所在屏幕并复制"><Monitor size={16}/><span>全屏截图</span></button>
              <button className="utility-capture gallery-launch" onClick={()=>void action('show_gallery')} title="全屏瀑布流浏览所有图片" aria-label="全屏图库"><Maximize2 size={16}/><span>全屏图库</span></button>
              <div className="segmented" aria-label="文件类型筛选">
                {[
                  { id: "all", label: "全部", Icon: LayoutGrid },
                  { id: "image", label: "图片", Icon: Image },
                  { id: "video", label: "视频", Icon: Video },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    aria-pressed={filter === id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="toolbar-spacer" />
              <label className="search-box">
                <Search size={17} />
                <input
                  aria-label="搜索截图"
                  placeholder="搜索截图"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button aria-label="清空搜索" onClick={() => setQuery("")}>
                    <X size={14} />
                  </button>
                )}
              </label>
              <IconButton
                label="清理未收藏项目"
                disabled={!snapshot.items.some((item) => !item.pinned)}
                onClick={() => setClearConfirm(true)}
              >
                <Trash2 size={17} />
              </IconButton>
            </div>
            {loading ? (
              <div className="empty-state">
                <LoaderCircle size={34} className="spin" />
                <h2>正在读取截图…</h2>
              </div>
            ) : loadError ? (
              <div className="empty-state">
                <h2>暂时无法读取图库</h2>
                <p>{loadError}</p>
                <button className="button primary" onClick={() => void load()}>
                  重新加载
                </button>
              </div>
            ) : shownItems.length === 0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <Images size={46} />
                  <Sparkles size={23} />
                </div>
                <h2>
                  {query
                    ? "还没找到这张截图"
                    : page === "pinned"
                      ? "还没有收藏"
                      : "还没有截图"}
                </h2>
                <p>
                  {query
                    ? "试试其他名称，或清空搜索再看看。"
                    : page === "pinned"
                      ? "点击截图名称旁的星标，即可收藏。"
                      : "点击「截取屏幕」开始截图，或直接把图片拖进来。"}
                </p>
                {!query && page === "recent" && (
                  <button
                    className="button primary"
                    onClick={() => void importFiles()}
                  >
                    <Plus size={17} />
                    导入第一张图片
                  </button>
                )}
                {query && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>
            ) : (
              groups.map((group) => (
                <section className="day-group" key={group}>
                  <div className="day-heading">
                    <h2>{group}</h2>
                    <span>
                      {
                        shownItems.filter(
                          (item) => dayLabel(item.createdAt) === group,
                        ).length
                      }{" "}
                      个项目
                    </span>
                    <div />
                  </div>
                  <div className="capture-grid">
                    {shownItems
                      .filter((item) => dayLabel(item.createdAt) === group)
                      .map((item) => (
                        <article key={item.id} className="capture-card" onDragStartCapture={preventImageBrowserDrag} draggable={false}>
                          <button
                            className="capture-image"
                            draggable={false}
                            onPointerDown={(event) =>
                              startPointer(event, item.id)
                            }
                            onPointerMove={movePointer}
                            onPointerUp={event => endPointer(event.pointerId, item.id)}
                            onPointerCancel={event => endPointer(event.pointerId, item.id)}
                            onPointerLeave={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) endPointer(event.pointerId, item.id); }}
                            onLostPointerCapture={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) endPointer(event.pointerId, item.id); }}
                            onClick={(event) => {
                              if (event.detail === 0 || !dragged.current) setSelected(item);
                            }}
                            title="预览与标注 · 拖动到其他应用分享"
                          >
                            {item.kind === "image" ||
                            item.thumbnail.startsWith("data:image/") ? (
                              <img
                                src={item.thumbnail || sourceOf(item)}
                                alt={item.name}
                                loading="lazy"
                                draggable={false}
                              />
                            ) : (
                              <div className="video-placeholder">
                                <Video size={36} />
                                <span>视频</span>
                              </div>
                            )}
                            <span className="image-badge">
                              {item.kind === "video" ? (
                                <Video size={12} />
                              ) : (
                                <Image size={12} />
                              )}{" "}
                              {item.width > 0
                                ? `${item.width} × ${item.height}`
                                : "视频"}
                            </span>
                            <span className="preview-hint">
                              <ArrowUpRight size={17} />
                              预览与标注
                            </span>
                          </button>
                          <div className="card-info">
                            <div className="card-title">
                              <h3 title={item.name}>{item.name}</h3>
                              <IconButton
                                label={item.pinned ? "取消收藏" : "收藏"}
                                active={item.pinned}
                                onClick={() =>
                                  void action("toggle_pin", item.id)
                                }
                              >
                                <Star size={15} weight={item.pinned ? 'fill' : 'regular'} />
                              </IconButton>
                            </div>
                            <div className="card-meta">
                              <span>
                                {item.source === "screenshot"
                                  ? "截图"
                                  : item.source === "annotated"
                                    ? "截图标注"
                                  : item.source === "edited"
                                    ? "编辑副本"
                                    : item.source === "clipboard"
                                      ? "剪贴板"
                                      : item.source === "import"
                                        ? "手动导入"
                                        : item.source === "folder"
                                          ? "文件夹"
                                          : item.source}
                              </span>
                              <b>·</b>
                              <time>{formatTime(item.createdAt)}</time>
                              {item.shelfHidden && <button className="shelf-hidden-badge" title="仅从晾衣架收起，点击恢复" onClick={() => void action("restore_shelf_item", item.id)}><EyeOff size={11} />已收起 · 恢复</button>}
                            </div>
                            <div className="card-actions">
                              <button
                                className="copy-button"
                                onClick={() =>
                                  void action("copy_item", item.id)
                                }
                              >
                                <Copy size={14} />
                                复制
                              </button>
                              <div className="toolbar-spacer" />
                              {item.kind === 'image' && <IconButton label="贴到屏幕" onClick={()=>void action('pin_item',item.id)}><Pin size={15}/></IconButton>}
                              <IconButton label={item.shelfHidden ? "恢复到晾衣架" : "从晾衣架收起（图库保留）"} onClick={() => void action(item.shelfHidden ? 'restore_shelf_item' : 'hide_shelf_item', item.id)}>{item.shelfHidden ? <Eye size={15} /> : <EyeOff size={15} />}</IconButton>
                              <IconButton
                                label="导出"
                                onClick={() =>
                                  void action("export_item", item.id)
                                }
                              >
                                <Download size={15} />
                              </IconButton>
                              <IconButton
                                label="在文件夹中显示"
                                onClick={() =>
                                  void action("reveal_item", item.id)
                                }
                              >
                                <FolderOpen size={15} />
                              </IconButton>
                              <IconButton
                                label="从图库移除（源文件保留）"
                                onClick={() =>
                                  void action("remove_item", item.id)
                                }
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                </section>
              ))
            )}
            <footer className="library-footer">
              <span>
                <ArrowDownToLine size={14} />
                将图片拖到这里，或者拖到其他应用去分享
              </span>
              <span>
                {shownItems.length} 个项目
                <Keyboard size={14} />
              </span>
            </footer>
          </section>
        )}
      </main>
      {fileInput}
      {toastView}
      {draggingOver && (
        <div className="drop-overlay">
          <div>
            <ArrowDownToLine size={48} />
            <h2>松开以导入文件</h2>
            <p>支持图片和视频</p>
          </div>
        </div>
      )}
      {selected && (
        <Editor
          key={selected.id}
          item={selected}
          source={sourceOf(selected)}
          onClose={() => setSelected(null)}
          onSave={saveEdited}
          onAction={(command, id) => void action(command, id)}
        />
      )}
      {clearConfirm && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <div className="confirm-icon">
              <Trash2 size={25} />
            </div>
            <h2 id="clear-title">清理未收藏项目？</h2>
            <p>
              将移除 {snapshot.items.filter((item) => !item.pinned).length}{" "}
              个未收藏项目。收藏项目与导入的源文件会保留。
            </p>
            <div>
              <button
                className="button secondary"
                autoFocus
                onClick={() => setClearConfirm(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setClearConfirm(false);
                  void action("clear_unpinned");
                }}
              >
                清理未收藏
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
