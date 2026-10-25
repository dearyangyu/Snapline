"""Analyze every recorded frame of the controlled capture board, without UI input.

The four colored rectangles are spatial fiducials. Their edges are detected with
brightness-independent color ratios, so the screenshot scrim cannot masquerade
as scaling. Preserve input PTS (no fps filter or duplicated output frames).
This can only assess frames the recorder actually sampled, not the intervals
between them. Output includes every frame's measurements, timing gaps and
unmodified PNGs/contact sheets around each detected brightness/geometry change.
"""

import argparse
import hashlib
import json
import re
import subprocess
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


COLORS = ("red", "blue", "green", "yellow")


def color_mask(rgb, color):
    r, g, b = (rgb[..., i].astype(np.uint16) for i in range(3))
    if color == "red":
        return (r > 35) & (r * 5 > g * 8) & (r * 5 > b * 8)
    if color == "blue":
        return (b > 30) & (b * 10 > g * 13) & (g * 5 > r * 6)
    if color == "green":
        return (g > 30) & (g * 2 > r * 3) & (g * 5 > b * 6)
    return (r > 40) & (r * 5 > g * 6) & (g * 5 > b * 9)


def longest_run(values):
    indexes = np.flatnonzero(values)
    if not len(indexes):
        return None
    groups = np.split(indexes, np.flatnonzero(np.diff(indexes) > 1) + 1)
    best = max(groups, key=len)
    return int(best[0]), int(best[-1]) + 1


def rectangle(rgb, color):
    # Find the sizeable colored component, excluding small taskbar/cursor marks.
    sampled = color_mask(rgb[::2, ::2], color)
    rows = longest_run(sampled.sum(axis=1) >= 25)
    if rows is None:
        return None
    cols = longest_run(sampled[rows[0]:rows[1]].sum(axis=0) >= max(12, (rows[1] - rows[0]) * 0.4))
    if cols is None:
        return None
    x0, y0 = max(0, cols[0] * 2 - 3), max(0, rows[0] * 2 - 3)
    x1, y1 = min(rgb.shape[1], cols[1] * 2 + 3), min(rgb.shape[0], rows[1] * 2 + 3)
    exact = color_mask(rgb[y0:y1, x0:x1], color)
    ys, xs = np.nonzero(exact)
    if not len(xs):
        return None
    bbox = [x0 + int(xs.min()), y0 + int(ys.min()), x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1]
    left, top, right, bottom = bbox
    sample = rgb[top + (bottom - top) // 2:bottom - 8, right - 55:right - 8]
    median = np.median(sample.reshape(-1, 3), axis=0).astype(int).tolist()
    return {"bbox_xyxy_exclusive": bbox, "width": right - left, "height": bottom - top, "median_rgb": median}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--radius", type=float, default=0.4, help="Seconds of all neighboring recorded frames per event")
    return parser.parse_args()


def main():
    args = parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    metadata = subprocess.run([str(args.ffmpeg), "-hide_banner", "-i", str(args.video)], capture_output=True, text=True).stderr
    stream = next(line for line in metadata.splitlines() if "Video:" in line)
    width, height = map(int, re.search(r"\b(\d{3,5})x(\d{3,5})\b", stream).groups())
    command = [str(args.ffmpeg), "-hide_banner", "-nostdin", "-i", str(args.video), "-map", "0:v:0", "-vf", "showinfo", "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    timestamps = {}
    stderr_lines = []

    def read_stderr():
        for raw in process.stderr:
            line = raw.decode("utf-8", errors="replace")
            stderr_lines.append(line)
            match = re.search(r"\bn:\s*(\d+)\s+pts:.*?pts_time:([\d.\-]+)", line)
            if match:
                timestamps[int(match.group(1))] = float(match.group(2))

    worker = threading.Thread(target=read_stderr, daemon=True)
    worker.start()
    rows = []
    frame_size = width * height * 3
    reference_sample = None
    while True:
        raw = process.stdout.read(frame_size)
        if not raw:
            break
        if len(raw) != frame_size:
            raise RuntimeError(f"Truncated frame {len(rows)}: {len(raw)} / {frame_size}")
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
        patches = {name: rectangle(frame, name) for name in COLORS}
        probes = [[width * 3 // 4, height // 4], [width * 3 // 4, height * 3 // 4], [width // 2, height // 2], [width // 8, height * 3 // 4]]
        background = [frame[y - 2:y + 3, x - 2:x + 3].mean(axis=(0, 1)).round(2).tolist() for x, y in probes]
        # Use broad spatial evidence as well as the four large colored patches:
        # an expanding central overlay could leave the original outer patches
        # visible beneath it. A 16 x 9 grid detects nonuniform center-out dimming.
        sampled = frame[::8, ::8].astype(np.float32)
        if reference_sample is None:
            reference_sample = sampled.copy()
            bright_reference = (sampled.min(axis=2) > 210) & (sampled.max(axis=2) - sampled.min(axis=2) < 40)
            bright_reference[:4] = False
            bright_reference[-7:] = False  # Exclude title bar and taskbar.
            valid_height = sampled.shape[0] // 9 * 9
            valid_width = sampled.shape[1] // 16 * 16
        ratios = sampled.sum(axis=2) / np.maximum(1, reference_sample.sum(axis=2))
        bright_ratios = np.where(bright_reference, ratios, np.nan)[:valid_height, :valid_width]
        tiles = bright_ratios.reshape(9, valid_height // 9, 16, valid_width // 16).transpose(0, 2, 1, 3).reshape(9, 16, -1)
        gains = np.nanmedian(tiles, axis=2)
        global_gain = float(np.nanmedian(gains))
        residual = np.abs(sampled[4:-7] - reference_sample[4:-7] * global_gain).max(axis=2)
        rows.append({
            "frame": len(rows), "patches": patches, "background_rgb": background,
            "spatial_brightness": {
                "median_gain": round(global_gain, 5),
                "tile_gain_p05": round(float(np.nanpercentile(gains, 5)), 5),
                "tile_gain_p95": round(float(np.nanpercentile(gains, 95)), 5),
                "tile_gain_min": round(float(np.nanmin(gains)), 5),
                "tile_gain_max": round(float(np.nanmax(gains)), 5),
                "gains_16_by_9": np.around(gains, 5).tolist(),
                "fraction_sampled_pixels_different_after_gain_correction": round(float((residual > 8).mean()), 6),
            },
        })
        if len(rows) % 300 == 0:
            print(f"Analyzed {len(rows)} decoded frames", flush=True)
    process.stdout.close()
    code = process.wait()
    worker.join()
    (output / "decode-showinfo.log").write_text("".join(stderr_lines), encoding="utf-8")
    if code or len(timestamps) != len(rows):
        raise RuntimeError(f"Decode failed or PTS mismatch: code={code}, frames={len(rows)}, timestamps={len(timestamps)}")
    for row in rows:
        row["pts_seconds"] = timestamps[row["frame"]]

    reference = rows[0]["patches"]
    if any(value is None for value in reference.values()):
        raise RuntimeError("The first recorded frame must show all four controlled board rectangles")
    anomalies, events = [], []
    for index, row in enumerate(rows):
        changes = {name: row["patches"][name] for name in COLORS if row["patches"][name] is None or row["patches"][name]["bbox_xyxy_exclusive"] != reference[name]["bbox_xyxy_exclusive"]}
        if changes:
            anomalies.append({"frame": index, "pts_seconds": row["pts_seconds"], "changed_patches": changes})
        if index:
            previous = rows[index - 1]
            delta = float(np.abs(np.array(row["background_rgb"]) - np.array(previous["background_rgb"])).max())
            geometry_changed = any(row["patches"][name] is None or previous["patches"][name] is None or row["patches"][name]["bbox_xyxy_exclusive"] != previous["patches"][name]["bbox_xyxy_exclusive"] for name in COLORS)
            if delta >= 5 or geometry_changed:
                events.append({"frame": index, "pts_seconds": row["pts_seconds"], "maximum_probe_channel_change": delta, "geometry_changed": geometry_changed})
    for event in events:
        surrounding = [row for row in rows if abs(row["pts_seconds"] - event["pts_seconds"]) <= args.radius]
        event["neighboring_frame_count"] = len(surrounding)
        event["neighboring_geometry_anomaly_frames"] = [row["frame"] for row in surrounding if any(row["patches"][name] is None or row["patches"][name]["bbox_xyxy_exclusive"] != reference[name]["bbox_xyxy_exclusive"] for name in COLORS)]
        event["neighboring_spatial_gain_spread_p95_p05_max"] = max(row["spatial_brightness"]["tile_gain_p95"] - row["spatial_brightness"]["tile_gain_p05"] for row in surrounding)
        event["neighboring_pixel_difference_fraction_max"] = max(row["spatial_brightness"]["fraction_sampled_pixels_different_after_gain_correction"] for row in surrounding)
    intervals = np.diff([row["pts_seconds"] for row in rows])
    duration = rows[-1]["pts_seconds"] - rows[0]["pts_seconds"]
    summary = {
        "video": str(args.video.resolve()),
        "sha256": hashlib.file_digest(args.video.open("rb"), "sha256").hexdigest(),
        "stream_metadata": stream.strip(), "dimensions": [width, height],
        "decoded_frame_count": len(rows), "first_pts_seconds": rows[0]["pts_seconds"], "last_pts_seconds": rows[-1]["pts_seconds"],
        "observed_average_samples_per_second": (len(rows) - 1) / duration,
        "pts_interval_ms": {"minimum": float(intervals.min() * 1000), "median": float(np.median(intervals) * 1000), "p95": float(np.percentile(intervals, 95) * 1000), "maximum": float(intervals.max() * 1000)},
        "gaps_over_50ms": [{"after_frame": i, "after_pts_seconds": rows[i]["pts_seconds"], "gap_ms": round(float(value * 1000), 3)} for i, value in enumerate(intervals) if value > 0.0501],
        "reference_patches": reference, "geometry_anomaly_frame_count": len(anomalies), "geometry_anomalies": anomalies, "events": events,
        "interpretation_limit": "Only actual decoded frames and PTS are analyzed. Nominal stream fps is not capture sampling rate. Unobserved intervals, other desktops, hardware/DPI layouts and future captures are not proven. Global scrim brightness changes are not geometric scaling.",
    }
    (output / "frames.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    # Merge nearby events into windows, retaining every recorded frame in each.
    windows = []
    for event in events:
        start, end = event["pts_seconds"] - args.radius, event["pts_seconds"] + args.radius
        if windows and start <= windows[-1][1]:
            windows[-1][1] = max(end, windows[-1][1])
        else:
            windows.append([max(0, start), end])
    selected = sorted({row["frame"] for row in rows for start, end in windows if start <= row["pts_seconds"] <= end})
    if not selected:
        selected = [0, len(rows) - 1]
    frame_dir = output / "selected-frames"
    frame_dir.mkdir(exist_ok=True)
    expression = "+".join(f"eq(n\\,{index})" for index in selected)
    extraction = subprocess.run([str(args.ffmpeg), "-hide_banner", "-nostdin", "-y", "-i", str(args.video), "-vf", f"select='{expression}'", "-fps_mode", "passthrough", str(frame_dir / "selected-%04d.png")], capture_output=True, text=True)
    if extraction.returncode:
        raise RuntimeError(extraction.stderr)
    font_path = Path("C:/Windows/Fonts/consola.ttf")
    font = ImageFont.truetype(str(font_path), 20) if font_path.exists() else ImageFont.load_default()
    sheets = []
    for page in range(0, len(selected), 24):
        page_frames = selected[page:page + 24]
        columns = 4
        tile_width, tile_height = 640, 390
        sheet = Image.new("RGB", (columns * tile_width, ((len(page_frames) + columns - 1) // columns) * tile_height), "#1d2028")
        draw = ImageDraw.Draw(sheet)
        for offset, index in enumerate(page_frames):
            image = Image.open(frame_dir / f"selected-{page + offset + 1:04d}.png").convert("RGB")
            image.thumbnail((640, 360), Image.Resampling.LANCZOS)
            x, y = offset % columns * tile_width, offset // columns * tile_height
            sheet.paste(image, (x, y + 30))
            draw.text((x + 8, y + 4), f"Frame {index:04d}  PTS {rows[index]['pts_seconds']:.3f} s", fill="white", font=font)
        destination = output / f"contact-sheet-{page // 24 + 1:02d}.jpg"
        sheet.save(destination, quality=94, subsampling=0)
        sheets.append(str(destination))
    summary["selected_frames"] = [{"frame": index, "pts_seconds": rows[index]["pts_seconds"], "png": str(frame_dir / f"selected-{order + 1:04d}.png")} for order, index in enumerate(selected)]
    summary["contact_sheets"] = sheets
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("decoded_frame_count", "observed_average_samples_per_second", "pts_interval_ms", "geometry_anomaly_frame_count", "events", "contact_sheets")}, indent=2))


if __name__ == "__main__":
    main()
