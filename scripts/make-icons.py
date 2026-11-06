"""Generates Vibuzz brand icons (run: python3 scripts/make-icons.py)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

INK = (10, 10, 15, 255)
LIME = (200, 255, 77, 255)
LILAC = (157, 140, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "apps/mobile/assets/images"
OUT.mkdir(parents=True, exist_ok=True)


def mark(size: int, fg=LIME, wave=LILAC, bg=None, scale=1.0) -> Image.Image:
    """The Vibuzz mark: a bold V with two buzz arcs on its right side."""
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    w = S * 0.46 * scale
    top = c - w * 0.62
    bottom = c + w * 0.70
    stroke = w * 0.30
    cx0 = c - w * 0.08  # optical centre (arcs sit on the right)
    left_x = cx0 - w * 0.62
    right_x = cx0 + w * 0.40
    tip_x = cx0 - w * 0.11
    d.line([(left_x, top), (tip_x, bottom)], fill=fg, width=int(stroke), joint="curve")
    d.line([(tip_x, bottom), (right_x, top)], fill=fg, width=int(stroke), joint="curve")
    r = stroke / 2
    for x, y in [(left_x, top), (tip_x, bottom), (right_x, top)]:
        d.ellipse([x - r, y - r, x + r, y + r], fill=fg)
    # buzz arcs
    cx, cy = right_x + w * 0.05, top + w * 0.10
    for i, rad in enumerate([w * 0.34, w * 0.58]):
        bbox = [cx - rad, cy - rad, cx + rad, cy + rad]
        d.arc(bbox, start=-70, end=20, fill=wave, width=int(stroke * (0.42 - i * 0.08)))
    return img.resize((size, size), Image.LANCZOS)


def solid(size, color):
    return Image.new("RGBA", (size, size), color)


def glow_bg(size):
    bg = solid(size, INK)
    g = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    gd.ellipse([size * 0.15, size * 0.1, size * 0.95, size * 0.9], fill=(157, 140, 255, 70))
    g = g.filter(ImageFilter.GaussianBlur(size * 0.12))
    bg.alpha_composite(g)
    return bg


# App icon (iOS / generic)
icon = glow_bg(1024)
icon.alpha_composite(mark(1024, scale=0.72))
icon.convert("RGB").save(OUT / "icon.png")

# Android adaptive
glow_bg(1024).convert("RGB").save(OUT / "android-icon-background.png")
mark(1024, scale=0.5).save(OUT / "android-icon-foreground.png")
mono = mark(1024, fg=(255, 255, 255, 255), wave=(255, 255, 255, 255), scale=0.62)
mono.save(OUT / "android-icon-monochrome.png")

# Splash + favicon
mark(512, scale=0.8).save(OUT / "splash-icon.png")
fav = solid(96, INK)
fav.alpha_composite(mark(96, scale=0.8))
fav.save(OUT / "favicon.png")
print("icons written to", OUT)
