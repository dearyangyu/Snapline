"""Generate Snapline's original vector logo and Windows icons. Requires Pillow.

The same geometric primitives produce the SVG and a supersampled raster: no
upstream icon, fonts, downloaded art, or image generation is involved.
Usage: python scripts/make-icons.py [--preview path/to/contact-sheet.png]
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
UNITS = 64
RASTER = 1024
SCALE = RASTER / UNITS
BLUE = "#2258D4"


class Drawing:
    def __init__(self):
        self.image = Image.new("RGBA", (RASTER, RASTER))
        self.draw = ImageDraw.Draw(self.image)
        self.svg = []

    def rect(self, x, y, width, height, radius, fill):
        self.svg.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}"/>')
        self.draw.rounded_rectangle(tuple(v * SCALE for v in (x, y, x + width, y + height)), radius=radius * SCALE, fill=fill)

    def circle(self, x, y, radius, fill):
        self.svg.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}"/>')
        self.draw.ellipse(tuple(v * SCALE for v in (x - radius, y - radius, x + radius, y + radius)), fill=fill)

    def polygon(self, points, fill):
        coordinates = " ".join(f"{x},{y}" for x, y in points)
        self.svg.append(f'<polygon points="{coordinates}" fill="{fill}"/>')
        self.draw.polygon([(x * SCALE, y * SCALE) for x, y in points], fill=fill)

    def rope(self):
        self.svg.append('<path d="M12 18 Q32 24 52 18" fill="none" stroke="#BDD3FF" stroke-width="2.5" stroke-linecap="round"/>')
        points = []
        for i in range(81):
            t = i / 80
            points.append(((12 + 40 * t) * SCALE, (18 + 12 * t * (1 - t)) * SCALE))
        self.draw.line(points, fill="#BDD3FF", width=round(2.5 * SCALE), joint="curve")
        for x in (12, 52):
            self.draw.ellipse(tuple(v * SCALE for v in (x - 1.25, 16.75, x + 1.25, 19.25)), fill="#BDD3FF")


def make_logo():
    base = Drawing()
    base.rect(2, 2, 60, 60, 14, BLUE)
    base.rope()
    photo = Drawing()
    photo.rect(17, 24, 31, 29, 3.5, "#FFFFFF")
    photo.rect(21, 29, 23, 18.5, 1.8, "#E4EDFF")
    photo.circle(39, 32, 1.9, BLUE)
    photo.polygon([(21, 44.5), (28, 36.5), (33, 41), (37.5, 35), (44, 43), (44, 47.5), (21, 47.5)], BLUE)
    # A single card tilts around its suspension point; the clasp stays vertical.
    base.svg.append('<g transform="rotate(-7 32 24)">' + "".join(photo.svg) + '</g>')
    base.image.alpha_composite(photo.image.rotate(7, Image.Resampling.BICUBIC, center=(32 * SCALE, 24 * SCALE)))
    base.draw = ImageDraw.Draw(base.image)
    base.rect(29.5, 15, 5, 14, 1.8, "#BFD5FF")
    base.rect(31.35, 18, 1.3, 6, 0.65, "#2258D4")
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n'
           '<title>Snapline — a photo on a line</title>\n' + "\n".join(base.svg) + '\n</svg>\n')
    return svg, base.image


def preview(image, target):
    sheet = Image.new("RGB", (880, 430), "#F6F7FA")
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((440, 0, 880, 430), fill="#17191D")
    for offset, ink in [(0, "#252A33"), (440, "#E4E8F0")]:
        draw.text((offset + 24, 18), "SNAPLINE / original geometric logo", fill=ink)
        large = image.resize((208, 208), Image.Resampling.LANCZOS)
        sheet.paste(large, (offset + 116, 58), large)
        x = offset + 28
        for size in [16, 24, 32, 48, 64]:
            icon = image.resize((size, size), Image.Resampling.LANCZOS)
            sheet.paste(icon, (x, 322 + (64 - size) // 2), icon)
            draw.text((x, 397), f"{size}px", fill=ink)
            x += size + 29
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()
    icons, assets = ROOT / "src-tauri/icons", ROOT / "docs/assets"
    icons.mkdir(parents=True, exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)
    svg, image = make_logo()
    (assets / "logo.svg").write_text(svg, encoding="utf-8")
    image.save(assets / "logo.png")
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (256, "icon.png")]:
        image.resize((size, size), Image.Resampling.LANCZOS).save(icons / name)
    image.save(icons / "icon.ico", sizes=[(size, size) for size in [16, 24, 32, 48, 64, 128, 256]])
    if args.preview:
        preview(image, args.preview)
    print(f"Original SVG/PNG: {assets}; Windows PNG/ICO: {icons}")


if __name__ == "__main__":
    main()
