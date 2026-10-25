import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaptureTools, TOOL_NAMES } from "./CaptureTools";
import type { CaptureTool } from "./interaction";

const props: ComponentProps<typeof CaptureTools> = {
  tool: "mosaic",
  setTool: () => {},
  color: "#ee4e43",
  setColor: () => {},
  width: 4,
  setWidth: () => {},
  textStyle: { fontSize: 24, fontFamily: "Microsoft YaHei" },
  setTextStyle: () => {},
  canUndo: true,
  canRedo: false,
  undo: () => {},
  redo: () => {},
  busy: false,
  textActive: false,
  finish: () => {},
  cancel: () => {},
  panelRef: createRef(),
  position: { x: 10, y: 20 },
  maxWidth: 500,
  maxHeight: 180,
};
const markup = (patch: Partial<ComponentProps<typeof CaptureTools>> = {}) =>
  renderToStaticMarkup(<CaptureTools {...props} {...patch} />);

describe("capture inspector controls", () => {
  it("exposes all processing modes and announces actual mosaic size within the measured surface", () => {
    const html = markup();
    expect(html).toContain("max-width:500px;max-height:180px");
    expect(html).toContain('aria-label="马赛克" aria-pressed="true"');
    expect(html).toContain('aria-label="模糊" aria-pressed="false"');
    expect(html).toContain('aria-label="实色遮盖" aria-pressed="false"');
    expect(html).toContain('aria-valuetext="12 像素"');
    expect(html).toContain('aria-label="收起工具选项"');
    expect(html).not.toContain('aria-label="标注颜色"');
  });
  it("retains primary actions for every tool and separates fill colors from ineffective width controls", () => {
    for (const tool of Object.keys(TOOL_NAMES) as CaptureTool[]) {
      const html = markup({ tool });
      for (const action of [
        "移动选区",
        "撤销",
        "重做",
        "保存截图",
        "贴图",
        "取消截图",
        "复制截图",
      ]) {
        expect(html).toContain(`aria-label="${action}"`);
      }
    }
    const redact = markup({ tool: "redact" });
    expect(redact).toContain("填充颜色");
    expect(redact).toContain('aria-label="颜色 珊瑚红"');
    expect(redact).not.toContain('type="range"');
  });
  it("disables text and custom color inputs during export and shows no inspector for selection mode", () => {
    const html = markup({ tool: "text", busy: true });
    for (const name of ["文字字号", "自定义标注颜色"]) {
      const input = html.match(
        new RegExp(`<input[^>]*aria-label="${name}"[^>]*>`),
      )?.[0];
      expect(input).toContain('disabled=""');
    }
    expect(markup({ tool: null })).not.toContain("capture-tool-options");
  });
});
