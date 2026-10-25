/** Hidden webviews may throttle RAF; readiness relies on decoded pixels and
 * committed layout, with a bounded timer retry for native window configuration. */
export async function presentPreparedCapture(options: {
  cancelled: () => boolean;
  prepare: () => Promise<void>;
  present: () => Promise<boolean>;
  pause: () => Promise<void>;
  failed: () => Promise<unknown>;
}): Promise<void> {
  try {
    await options.prepare();
    for (let attempt = 0; attempt < 40 && !options.cancelled(); attempt++) {
      if (await options.present()) return;
      if (!options.cancelled()) await options.pause();
    }
    if (!options.cancelled()) throw new Error('截图窗口准备超时');
  } catch {
    if (!options.cancelled()) await options.failed().catch(() => undefined);
  }
}
