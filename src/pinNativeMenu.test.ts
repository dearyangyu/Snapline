import { describe, expect, it, vi } from 'vitest';
import { PinMenuController, type NativePinMenu, type PinMenuState } from './pinNativeMenu';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const state = (): PinMenuState => ({ collapsed: false, opacity: 1, doubleClickAction: 'close' });
const resource = (): NativePinMenu => ({
  update: vi.fn(async () => {}), popup: vi.fn(async () => {}), close: vi.fn(async () => {}),
});

describe('native pin menu lifetime', () => {
  it('reuses the native resource after popup returns and reads the current pin settings each time', async () => {
    const native = resource(), current = state();
    const create = vi.fn(async () => native);
    const controller = new PinMenuController(create, () => ({ ...current }));
    await controller.show({ x: 90, y: 60 });
    expect(native.popup).toHaveBeenLastCalledWith({ x: 90, y: 60 });
    expect(native.close).not.toHaveBeenCalled(); // popup is not a dismissal signal.
    current.collapsed = true; current.opacity = 0.5; current.doubleClickAction = 'none';
    await controller.show({ x: 48, y: 36 }); // A 96 × 72 pin does not clamp menu dimensions.
    expect(create).toHaveBeenCalledTimes(1);
    expect(native.update).toHaveBeenLastCalledWith({ collapsed: true, opacity: 0.5, doubleClickAction: 'none' });
    controller.dispose();
    expect(native.close).toHaveBeenCalledTimes(1);
  });

  it('releases a resource that finishes loading after its pin was destroyed', async () => {
    let resolve!: (menu: NativePinMenu) => void;
    const native = resource();
    const controller = new PinMenuController(() => new Promise(done => { resolve = done; }), state);
    const opening = controller.show({ x: 5, y: 5 });
    controller.dispose(); resolve(native); await opening;
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(native.update).not.toHaveBeenCalled();
    expect(native.popup).not.toHaveBeenCalled();
  });

  it('Escape cancels a pending popup without losing its reusable resource', async () => {
    let resolve!: (menu: NativePinMenu) => void;
    const native = resource();
    const create = vi.fn(() => new Promise<NativePinMenu>(done => { resolve = done; }));
    const controller = new PinMenuController(create, state);
    const opening = controller.show({ x: 2, y: 3 });
    expect(controller.cancelPending()).toBe(true);
    resolve(native); await opening;
    expect(native.popup).not.toHaveBeenCalled();
    await controller.show({ x: 4, y: 5 });
    expect(native.popup).toHaveBeenCalledExactlyOnceWith({ x: 4, y: 5 });
    expect(create).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('cancels after async state refresh and serializes repeated opening requests', async () => {
    let finishUpdate!: () => void;
    const native = resource();
    native.update = vi.fn(() => new Promise<void>(done => { finishUpdate = done; }));
    const controller = new PinMenuController(async () => native, state);
    const opening = controller.show({ x: 1, y: 1 });
    await flush();
    await controller.show({ x: 80, y: 60 });
    controller.cancelPending(); finishUpdate(); await opening;
    expect(native.update).toHaveBeenCalledTimes(1);
    expect(native.popup).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('allows retry after failed creation and keeps two pins isolated', async () => {
    const first = resource(), second = resource();
    const create = vi.fn().mockRejectedValueOnce(new Error('native failure')).mockResolvedValue(first);
    const firstPin = new PinMenuController(create, state);
    const secondPin = new PinMenuController(async () => second, state);
    await expect(firstPin.show({ x: 0, y: 0 })).rejects.toThrow('native failure');
    await firstPin.show({ x: 10, y: 10 });
    await secondPin.show({ x: 20, y: 20 });
    firstPin.dispose();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    secondPin.dispose();
  });

  it('unmount during state refresh closes once and prevents a late native popup', async () => {
    let finishUpdate!: () => void;
    const native = resource();
    native.update = vi.fn(() => new Promise<void>(done => { finishUpdate = done; }));
    const controller = new PinMenuController(async () => native, state);
    const opening = controller.show({ x: 48, y: 36 });
    await flush();
    controller.dispose(); controller.dispose(); finishUpdate(); await opening;
    expect(native.close).toHaveBeenCalledTimes(1);
    expect(native.popup).not.toHaveBeenCalled();
  });
});
