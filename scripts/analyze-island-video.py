"""Measure actual recorded island frames; never synthesize frames or infer unsampled motion."""
import argparse
import hashlib
import json
import re
import subprocess
import threading
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def footprint(rgb, center, expected_width):
    # Connected black surface, seeded above the icon/text baseline. Run-length
    # flood fill preserves original pixel coordinates without scaling frames.
    x0 = max(0, center - expected_width // 2 - 32)
    x1 = min(rgb.shape[1], center + expected_width // 2 + 32)
    y1 = min(rgb.shape[0], 342)
    mask = rgb[:y1, x0:x1].max(axis=2) < 22
    rows = []
    for row in mask:
        delta = np.diff(np.pad(row.astype(np.int8), (1, 1)))
        rows.append(list(zip(np.flatnonzero(delta == 1).tolist(), np.flatnonzero(delta == -1).tolist())))
    seed_y, seed_x = min(20, y1 - 1), center - x0
    seed = next((i for i, (left, right) in enumerate(rows[seed_y]) if left <= seed_x < right), None)
    if seed is None:
        return {"bbox": None, "state": "absent-or-obscured"}
    pending = [(seed_y, seed)]
    visited = set()
    left, top, right, bottom = seed_x, seed_y, seed_x + 1, seed_y + 1
    pixels = 0
    while pending:
        y, i = pending.pop()
        if (y, i) in visited:
            continue
        visited.add((y, i))
        a, b = rows[y][i]
        left, right, top, bottom = min(left, a), max(right, b), min(top, y), max(bottom, y + 1)
        pixels += b - a
        for adjacent in (y - 1, y + 1):
            if 0 <= adjacent < y1:
                for j, (c, d) in enumerate(rows[adjacent]):
                    if c >= b:
                        break
                    if d > a and (adjacent, j) not in visited:
                        pending.append((adjacent, j))
    width, height = right - left, bottom - top
    ambiguous = left == 0 or right == x1 - x0 or bottom == y1 or width > expected_width + 4
    state = "background-ambiguous" if ambiguous else "compact" if 130 <= width <= 190 and 28 <= height <= 65 else "expanded" if expected_width - 8 <= width <= expected_width + 2 and 288 <= height <= 304 else "transition"
    return {"bbox": [x0 + left, top, x0 + right, bottom], "width": width, "height": height, "black_pixels": pixels, "state": state}


def decode(ffmpeg, video, width, height, callback, log_path=None):
    command = [str(ffmpeg), '-hide_banner', '-nostdin', '-i', str(video), '-map', '0:v:0', '-vf', 'showinfo', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stamps, lines = {}, []
    def reader():
        for raw in process.stderr:
            line = raw.decode('utf-8', errors='replace')
            lines.append(line)
            match = re.search(r'\bn:\s*(\d+)\s+pts:.*?pts_time:([\d.\-]+)', line)
            if match:
                stamps[int(match.group(1))] = float(match.group(2))
    worker = threading.Thread(target=reader, daemon=True)
    worker.start()
    frame_size, index = width * height * 3, 0
    while True:
        raw = process.stdout.read(frame_size)
        if not raw:
            break
        if len(raw) != frame_size:
            raise RuntimeError(f'Truncated frame {index}: {len(raw)}/{frame_size}')
        callback(index, np.frombuffer(raw, np.uint8).reshape(height, width, 3))
        index += 1
    process.stdout.close()
    code = process.wait()
    worker.join()
    if log_path:
        log_path.write_text(''.join(lines), encoding='utf-8')
    if code or len(stamps) != index:
        raise RuntimeError(f'Decode/PTS failure: exit={code} frames={index} stamps={len(stamps)}')
    return stamps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--ffmpeg', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--center', type=int, default=640, help='Island center in recording pixels, not desktop pixels')
    parser.add_argument('--expanded-width', type=int, default=720)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = subprocess.run([str(args.ffmpeg), '-hide_banner', '-i', str(args.video)], capture_output=True, text=True).stderr
    stream = next(line for line in metadata.splitlines() if 'Video:' in line)
    width, height = map(int, re.search(r'\b(\d{3,5})x(\d{3,5})\b', stream).groups())
    records = []
    def measure(index, rgb):
        result = footprint(rgb, args.center, args.expanded_width)
        result['frame'] = index
        result['mean_luma_outside_island'] = float(np.mean(rgb[:, :max(1, args.center - args.expanded_width // 2 - 40)]))
        records.append(result)
        if index % 600 == 0:
            print(f'Measured {index} frames', flush=True)
    stamps = decode(args.ffmpeg, args.video, width, height, measure, args.output / 'decode-showinfo.log')
    for row in records:
        row['pts_seconds'] = stamps[row['frame']]
    intervals = np.diff([row['pts_seconds'] for row in records])
    changes = []
    for index in range(1, len(records)):
        before, after = records[index-1], records[index]
        a, b = before.get('bbox'), after.get('bbox')
        if (a is None) != (b is None) or (a and b and max(abs(i-j) for i,j in zip(a,b)) >= 2):
            changes.append(index)
    windows = []
    for index in changes:
        start, end = max(stamps[0], stamps[index] - .16), min(stamps[len(records)-1], stamps[index] + .18)
        if windows and start <= windows[-1][1]:
            windows[-1][1] = max(windows[-1][1], end)
        else:
            windows.append([start,end])
    selected = sorted({row['frame'] for row in records if any(a <= row['pts_seconds'] <= b for a,b in windows)})
    if not selected:
        selected = [0, len(records)-1]
    destination = args.output / 'original-frames'
    destination.mkdir(exist_ok=True)
    selected_set = set(selected)
    def save(index, rgb):
        if index in selected_set:
            Image.fromarray(rgb).save(destination / f'frame-{index:06d}.png')
    decode(args.ffmpeg, args.video, width, height, save)
    font_path = Path('C:/Windows/Fonts/consola.ttf')
    font = ImageFont.truetype(str(font_path), 15) if font_path.exists() else ImageFont.load_default()
    sheets = []
    # Contact sheets are annotated copies for navigation; originals above are
    # unmodified lossless frame exports. No inserted/interpolated video frames.
    for page_start in range(0, len(selected), 16):
        page = selected[page_start:page_start + 16]
        tile_width, tile_height, columns = 640, 202, 2
        sheet = Image.new('RGB', (tile_width*columns, ((len(page)+columns-1)//columns)*tile_height), '#25252b')
        draw = ImageDraw.Draw(sheet)
        for offset, index in enumerate(page):
            frame = Image.open(destination / f'frame-{index:06d}.png')
            frame.thumbnail((tile_width, 180), Image.Resampling.LANCZOS)
            x, y = (offset % columns)*tile_width, (offset//columns)*tile_height
            sheet.paste(frame,(x,y+22))
            row = records[index]
            label = f"#{index}  {row['pts_seconds']:.3f}s  {row['state']}  {row.get('width','?')}x{row.get('height','?')}"
            draw.text((x+5,y+3),label,font=font,fill='white')
        path = args.output / f'contact-sheet-{page_start//16+1:02d}.jpg'
        sheet.save(path,quality=95,subsampling=0)
        sheets.append(str(path.resolve()))
    runs = []
    for row in records:
        if runs and runs[-1]['state'] == row['state']:
            runs[-1]['last_frame'] = row['frame']; runs[-1]['last_pts'] = row['pts_seconds']
        else:
            runs.append({'state':row['state'],'first_frame':row['frame'],'last_frame':row['frame'],'first_pts':row['pts_seconds'],'last_pts':row['pts_seconds']})
    duration = stamps[len(records)-1] - stamps[0]
    report = {
        'video':str(args.video.resolve()),'sha256':hashlib.file_digest(args.video.open('rb'),'sha256').hexdigest(),
        'dimensions':[width,height],'stream_metadata':stream.strip(),'decoded_frames':len(records),
        'first_pts_seconds':stamps[0],'last_pts_seconds':stamps[len(records)-1],
        'observed_samples_per_second':(len(records)-1)/duration if duration else 0,
        'interval_ms':{'minimum':float(intervals.min()*1000),'median':float(np.median(intervals)*1000),'p95':float(np.percentile(intervals,95)*1000),'maximum':float(intervals.max()*1000)},
        'gaps_over_50ms':[{'after_frame':i,'gap_ms':round(float(gap*1000),3)} for i,gap in enumerate(intervals) if gap>.0501],
        'state_runs':runs,'transition_windows_seconds':windows,'selected_original_frames':selected,'contact_sheets':sheets,
        'analysis_method':'Exact-pixel connected black component seeded at recording center,y20. Dark threshold maxRGB<22. Desktop/cursor content can obscure or join the component; ambiguous classifications require visual review.',
        'visual_review':'PENDING: inspect original frames before making any motion-quality claim.',
        'limits':'Recorded samples only. Requested60fps is not proven sampling. No proof about unsampled intervals, otherDPI/displayhardware, or screenshotstartup animation (this records the shelf island).'
    }
    (args.output/'frames.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    (args.output/'analysis.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['decoded_frames','observed_samples_per_second','interval_ms','transition_windows_seconds','contact_sheets']},indent=2))

if __name__ == '__main__':
    main()
