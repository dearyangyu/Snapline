"""Measure an actual red QA photo's top edge in a native desktop recording.

No synthesized or interpolated frames. The supplied crop must isolate the red
photo, and original frames must also be visually inspected before a verdict.
"""
import argparse
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from importlib.util import module_from_spec, spec_from_file_location


def red_edge(rgb, roi):
    x, y, w, h = roi
    patch = rgb[y:y + h, x:x + w].astype(np.int16)
    r, g, b = patch[:, :, 0], patch[:, :, 1], patch[:, :, 2]
    mask = (r > 130) & (r > g * 1.5) & (r > b * 1.35) & (g < 150)
    yy, xx = np.nonzero(mask)
    if len(xx) < 700 or np.ptp(xx) < 35:
        return {"pixels": len(xx), "angle_degrees": None}
    lo, hi = np.quantile(xx, [0.25, 0.75])
    columns, tops = [], []
    for column in range(math.ceil(lo), math.floor(hi) + 1):
        rows = np.flatnonzero(mask[:, column])
        if len(rows) >= 5:
            columns.append(column)
            tops.append(rows[0])
    if len(columns) < 20:
        return {"pixels": len(xx), "angle_degrees": None}
    columns, tops = np.array(columns), np.array(tops)
    slope, intercept = np.polyfit(columns, tops, 1)
    raw_residual = float(np.sqrt(np.mean((tops - (slope * columns + intercept)) ** 2)))
    # The silver peg occludes a few middle columns of the red top edge. Reject
    # those occluded columns rather than treating the bottom of the peg as the
    # photo edge. Retain diagnostics and original frames for visual inspection.
    keep = np.ones(len(columns), dtype=bool)
    for _ in range(3):
        errors = tops - (slope * columns + intercept)
        keep = np.abs(errors - np.median(errors)) <= max(1.5, 3 * np.median(np.abs(errors - np.median(errors))))
        if keep.sum() < 20:
            return {"pixels": len(xx), "angle_degrees": None}
        slope, intercept = np.polyfit(columns[keep], tops[keep], 1)
    residual = float(np.sqrt(np.mean((tops[keep] - (slope * columns[keep] + intercept)) ** 2)))
    return {"pixels": len(xx), "angle_degrees": math.degrees(math.atan(slope)),
            "edge_fit_rmse_px": residual,
            "raw_edge_fit_rmse_px": raw_residual, "occluded_columns_rejected": int((~keep).sum()),
            "edge_clipped_at_top": bool(yy.min() == 0),
            "bbox": [int(xx.min()) + x, int(yy.min()) + y, int(xx.max()) + x + 1, int(yy.max()) + y + 1]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video", type=Path)
    ap.add_argument("--ffmpeg", type=Path, required=True)
    ap.add_argument("--roi", type=int, nargs=4, required=True, metavar=("X", "Y", "W", "H"))
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--start", type=float, help="Observed opening time; omitted = first detected red photo frame")
    ap.add_argument("--seconds", type=float, default=5)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    info = subprocess.run([str(args.ffmpeg), "-hide_banner", "-i", str(args.video)], capture_output=True, text=True).stderr
    stream = next(line for line in info.splitlines() if "Video:" in line)
    width, height = map(int, re.search(r"\b(\d{3,5})x(\d{3,5})\b", stream).groups())
    spec = spec_from_file_location("actual_video_decoder", Path(__file__).with_name("analyze-island-video.py"))
    decoder = module_from_spec(spec)
    spec.loader.exec_module(decoder)
    records = []
    def measure(index, rgb):
        records.append({"frame": index, **red_edge(rgb, args.roi)})
    stamps = decoder.decode(args.ffmpeg, args.video, width, height, measure, args.output / "decode-showinfo.log")
    for row in records:
        row["pts"] = stamps[row["frame"]]
    inferred_start = args.start is None
    if inferred_start:
        args.start = next(row["pts"] for row in records if row["angle_degrees"] is not None)
    selected = [r for r in records if args.start - 0.15 <= r["pts"] <= args.start + args.seconds]
    # Sample contact sheet evenly in *time*, while retaining original frame IDs.
    target_times = np.linspace(args.start - 0.1, args.start + args.seconds, 24)
    ids = sorted({min(selected, key=lambda r: abs(r["pts"] - float(t)))["frame"] for t in target_times})
    wanted = set(ids)
    originals = args.output / "original-frames"
    originals.mkdir(exist_ok=True)
    entry_ids = {row["frame"] for row in records if args.start - .3 <= row["pts"] <= args.start + .45}
    entry = args.output / "consecutive-entry-frames"
    entry.mkdir(exist_ok=True)
    cells = {}
    def save(index, rgb):
        if index in entry_ids:
            Image.fromarray(rgb).save(entry / f"frame-{index:05d}.png")
        if index not in wanted:
            return
        im = Image.fromarray(rgb)
        im.save(originals / f"frame-{index:05d}.png")
        x, y, w, h = args.roi
        tile = Image.new("RGB", (320, 240), "#e7e7e7")
        crop = im.crop((max(0, x - 30), max(0, y - 10), min(width, x + w + 30), min(height, y + h + 20)))
        crop.thumbnail((320, 205))
        tile.paste(crop, ((320 - crop.width) // 2, 25))
        draw = ImageDraw.Draw(tile)
        angle = records[index]["angle_degrees"]
        draw.text((8, 5), f"frame {index}  t={stamps[index]:.3f}s  angle={angle:.2f}" if angle is not None else f"frame {index}  t={stamps[index]:.3f}s  no edge", fill="black")
        cells[index] = tile
    decoder.decode(args.ffmpeg, args.video, width, height, save)
    sheet = Image.new("RGB", (320 * 4, 240 * math.ceil(len(ids) / 4)), "white")
    for n, index in enumerate(ids):
        sheet.paste(cells[index], ((n % 4) * 320, (n // 4) * 240))
    sheet.save(args.output / "contact-sheet.jpg", quality=94)
    distinct = np.array(sorted(set(stamps.values())))
    gaps = np.diff(distinct)
    valid = [r for r in selected if r["angle_degrees"] is not None and r["edge_fit_rmse_px"] < 1.5 and not r["edge_clipped_at_top"]]
    report = {"video": str(args.video.resolve()), "sha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
              "roi": args.roi, "decoded_frames": len(records), "distinct_pts": len(distinct),
              "duration_last_pts": float(distinct[-1]), "distinct_pts_per_second": (len(distinct) - 1) / (distinct[-1] - distinct[0]),
              "max_gap_ms": float(gaps.max() * 1000), "median_gap_ms": float(np.median(gaps) * 1000),
              "selected_window": [args.start - 0.15, args.start + args.seconds], "contact_sheet_original_frame_ids": ids,
              "window_origin": "first_detected_red_photo" if inferred_start else "manually_observed_opening_time",
              "consecutive_entry_frame_ids": sorted(entry_ids),
              "valid_measured_frames": len(valid), "selected_frames": selected,
              "limitations": ["A thresholded red photo edge is a proxy for its observed rotation, not a browser animation value.",
                              "Verify crop isolation, visibility and original frames visually; do not infer correctness from metrics alone.",
                              "Repeated PTS and capture gaps cannot establish display refresh-rate coverage."]}
    (args.output / "analysis.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("selected_frames", "limitations")}, indent=2))


if __name__ == "__main__":
    main()
