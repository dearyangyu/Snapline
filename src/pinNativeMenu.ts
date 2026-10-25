import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import type { Point } from './captureGeometry';
import type { Settings } from './model';

type DoubleClickAction = Settings['pinDoubleClickAction'];
export type PinMenuAction = 'copy' | 'save' | 'edit' | 'actual' | 'collapse' | 'close'
  | `opacity:${number}` | `double:${DoubleClickAction}`;
export type PinMenuState = { collapsed: boolean; opacity: number; doubleClickAction: DoubleClickAction };
export interface NativePinMenu {
  update(state: PinMenuState): Promise<void>;
  popup(point: Point): Promise<void>;
  close(): Promise<void>;
}

/** One resource tree per pin. Explicit child handles keep callbacks owned until
 * unmount; closing every handle also releases Tauri's per-item Channel handlers. */
export async function createPinNativeMenu(dispatch: (action: PinMenuAction) => void): Promise<NativePinMenu> {
  const resources: Array<{ close(): Promise<void> }> = [];
  const own = async <T extends { close(): Promise<void> }>(promise: Promise<T>): Promise<T> => {
    const resource = await promise;
    resources.push(resource);
    return resource;
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled(resources.reverse().map(resource => resource.close()));
  };
  const item = (text: string, action: PinMenuAction) => own(MenuItem.new({
    text, action: () => { if (!closed) dispatch(action); },
  }));
  const separator = () => own(PredefinedMenuItem.new({ item: 'Separator' }));
  try {
    // Text suffixes advertise the existing WebView shortcuts without installing
    // native accelerators that could dispatch the same command a second time.
    const copy = await item('复制\tCtrl+C', 'copy');
    const save = await item('另存为…', 'save');
    const edit = await item('再次标注', 'edit');
    const actual = await item('恢复原始大小\t0', 'actual');
    const collapse = await item('收起为缩略图', 'collapse');
    const opacity: Array<{ value: number; item: CheckMenuItem }> = [];
    for (const value of [1, 0.75, 0.5, 0.25, 0.15]) {
      opacity.push({ value, item: await own(CheckMenuItem.new({
        text: `${Math.round(value * 100)}%`, checked: value === 1,
        action: () => { if (!closed) dispatch(`opacity:${value}`); },
      })) });
    }
    const doubleClick: Array<{ value: DoubleClickAction; item: CheckMenuItem }> = [];
    for (const [value, text] of [
      ['close', '关闭贴图'], ['collapse', '收起 / 展开'], ['none', '不执行操作'],
    ] as const) {
      doubleClick.push({ value, item: await own(CheckMenuItem.new({
        text, checked: value === 'close',
        action: () => { if (!closed) dispatch(`double:${value}`); },
      })) });
    }
    const opacityMenu = await own(Submenu.new({ text: '透明度', items: opacity.map(row => row.item) }));
    const doubleMenu = await own(Submenu.new({ text: '双击贴图时', items: doubleClick.map(row => row.item) }));
    const firstSeparator = await separator();
    const lastSeparator = await separator();
    const exit = await item('关闭贴图\tEsc', 'close');
    const menu = await own(Menu.new({ items: [copy, save, edit, actual, collapse,
      firstSeparator, opacityMenu, doubleMenu, lastSeparator, exit] }));
    return {
      update: async state => {
        await Promise.all([
          collapse.setText(state.collapsed ? '展开贴图' : '收起为缩略图'),
          ...opacity.map(row => row.item.setChecked(Math.abs(row.value - state.opacity) < 0.005)),
          ...doubleClick.map(row => row.item.setChecked(row.value === state.doubleClickAction)),
        ]);
      },
      popup: point => menu.popup(new LogicalPosition(point.x, point.y)),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Popup's public API does not signal dismissal. Keep its resource tree alive
 * across openings, and use the OS menu loop for keyboard dismissal. */
export class PinMenuController {
  private resource?: NativePinMenu;
  private creating?: Promise<NativePinMenu>;
  private disposed = false;
  private serial = 0;
  private opening = false;
  private preparing = false;
  constructor(private readonly create: () => Promise<NativePinMenu>, private readonly read: () => PinMenuState) {}
  async show(point: Point): Promise<void> {
    if (this.disposed || this.opening) return;
    this.opening = this.preparing = true;
    const serial = ++this.serial;
    try {
      this.creating ??= this.create().then(async menu => {
        if (this.disposed) await menu.close();
        else this.resource = menu;
        return menu;
      }).catch(error => { this.creating = undefined; throw error; });
      const menu = await this.creating;
      if (this.disposed || serial !== this.serial) return;
      await menu.update(this.read());
      if (this.disposed || serial !== this.serial) return;
      this.preparing = false;
      await menu.popup(point);
    } finally { this.opening = this.preparing = false; }
  }
  cancelPending(): boolean {
    if (!this.preparing) return false;
    this.serial++;
    return true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.serial++;
    void this.resource?.close();
  }
}
