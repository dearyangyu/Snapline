import type { CaptureTool } from "./interaction";

/** Labels show the actual pixel size used by drawMark; the stored 1–20 setting is unchanged. */
export function captureParameter(
  tool: CaptureTool,
  width: number,
): {
  label: string;
  value: number;
  unit: string;
  description: string;
} | null {
  if (tool === "text" || tool === "redact") return null;
  const level = Number.isFinite(width) ? Math.max(1, Math.min(20, width)) : 1;
  if (tool === "blur")
    return {
      label: "模糊强度",
      value: level,
      unit: "/ 20",
      description: `${level} 级，最高 20 级`,
    };
  const value =
    tool === "mosaic"
      ? Math.max(6, level * 3)
      : tool === "eraser" || tool === "highlight"
        ? level * 6
        : tool === "step"
          ? Math.max(13, level * 4) * 2
          : level;
  const label =
    tool === "mosaic"
      ? "颗粒尺寸"
      : tool === "eraser"
        ? "橡皮直径"
        : tool === "step"
          ? "序号直径"
          : "笔画粗细";
  return { label, value, unit: "px", description: `${value} 像素` };
}
