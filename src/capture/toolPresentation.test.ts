import { describe, expect, it } from "vitest";
import { captureParameter } from "./toolPresentation";
import { toolbarPosition } from "./interaction";

describe("capture parameter presentation", () => {
  it("labels rendered pixel sizes without changing the stored tool level", () => {
    expect(captureParameter("mosaic", 1)?.value).toBe(6);
    expect(captureParameter("mosaic", 4)).toMatchObject({
      label: "颗粒尺寸",
      value: 12,
      unit: "px",
    });
    expect(captureParameter("mosaic", 20)?.value).toBe(60);
    expect(captureParameter("eraser", 4)).toMatchObject({
      label: "橡皮直径",
      value: 24,
    });
    expect(captureParameter("highlight", 4)?.value).toBe(24);
    expect(captureParameter("step", 1)?.value).toBe(26);
    expect(captureParameter("pen", 4)?.value).toBe(4);
  });
  it("keeps blur strength distinct from pixels and excludes parameters with no rendering effect", () => {
    expect(captureParameter("blur", 4)).toMatchObject({
      label: "模糊强度",
      value: 4,
      unit: "/ 20",
    });
    expect(captureParameter("blur", Number.NaN)?.value).toBe(1);
    expect(captureParameter("blur", 40)?.value).toBe(20);
    expect(captureParameter("text", 4)).toBeNull();
    expect(captureParameter("redact", 4)).toBeNull();
  });
  it("keeps an expanded or constrained inspector inside offset monitor bounds at fractional DPI", () => {
    const monitor = { x: 1536, y: 120, width: 1024, height: 576 };
    const selection = { x: 2510, y: 670, width: 18, height: 12 };
    for (const panel of [
      { width: 570, height: 216 },
      { width: 340, height: 400 },
      { width: 570, height: 88 },
    ]) {
      const position = toolbarPosition(selection, panel, monitor);
      expect(position.x).toBeGreaterThanOrEqual(monitor.x + 8);
      expect(position.y).toBeGreaterThanOrEqual(monitor.y + 8);
      expect(position.x + panel.width).toBeLessThanOrEqual(
        monitor.x + monitor.width - 8,
      );
      expect(position.y + panel.height).toBeLessThanOrEqual(
        monitor.y + monitor.height - 8,
      );
    }
  });
});
