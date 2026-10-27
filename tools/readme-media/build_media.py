#!/usr/bin/env python3
"""Turns the frames recorded by capture.mjs into the README's GIFs.

    python tools/readme-media/build_media.py [media.json]          # write the GIFs
    python tools/readme-media/build_media.py [media.json] --sheet  # contact sheet only

Writes into the config's "out" folder:
  banner.gif           still title on the left, recorded scenes cycling in the panel
  hero.gif             the opening view, then a slice of every scene
  clip_<scene>.gif     one per scene
  screenshot_<scene>.png  a full-size still from the middle of the first three scenes

--sheet writes <work>/contact.png instead: numbered thumbnails of the recording,
handy for checking that each scene fits its segment and for choosing the
banner crop. Needs Python 3 and Pillow (pip install pillow).
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is missing: run  pip install pillow")

HERE = Path(__file__).resolve().parent
PANEL_AT, PANEL = (860, 30), 340       # where banner.html leaves room for footage
LABEL_FILL, LABEL_TEXT, ACCENT = (15, 16, 21, 225), (242, 239, 255), (243, 154, 69)


def load(path):
    cfg_path = Path(path).resolve()
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    cfg["_dir"] = cfg_path.parent
    cfg["_work"] = (cfg_path.parent / cfg.get("work", ".work")).resolve()
    cfg["_out"] = (cfg_path.parent / cfg.get("out", "../../.github/readme")).resolve()
    return cfg


def frame(cfg, i):
    path = cfg["_work"] / "frames" / f"f{i:08d}.png"
    if not path.exists():
        sys.exit(f"missing {path}: run  npm run readme:capture  first")
    return Image.open(path).convert("RGB")


def scene_start(cfg, name):
    return cfg["first"] + cfg["scenes"].index(name) * cfg["segment"]


def frames_of(cfg, name, take, step):
    start = scene_start(cfg, name)
    return list(range(start + take[0], start + take[1], step))


def write_gif(path, images, ms, palette=None):
    if palette is None:
        quantized = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in images]
    else:
        quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
    quantized[0].save(path, save_all=True, append_images=quantized[1:], duration=ms, loop=0, optimize=True, disposal=1)
    print(f"{path.name}: {len(images)} frames, {path.stat().st_size // 1024} KB")


def label_font(cfg, size):
    font = ImageFont.truetype(str(HERE / "fonts" / "SpaceGrotesk-Variable.ttf"), size)
    try:
        font.set_variation_by_axes([700])
    except Exception:
        pass  # not a variable font, or Pillow built without that support
    return font


def build_banner(cfg):
    b = cfg["banner"]
    bg_path = cfg["_work"] / "banner_bg.png"
    if not bg_path.exists():
        sys.exit(f"missing {bg_path}: run  npm run readme:capture  first")
    bg = Image.open(bg_path).convert("RGB")
    font = label_font(cfg, 17)
    mask = Image.new("L", (PANEL, PANEL), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, PANEL - 1, PANEL - 1), radius=11, fill=255)
    images = []
    for name, label in b["scenes"].items():
        for i in frames_of(cfg, name, b["take"], b.get("step", 2)):
            shot = frame(cfg, i).crop(tuple(b["crop"])).resize((PANEL, PANEL), Image.LANCZOS)
            im = bg.copy()
            im.paste(shot, PANEL_AT, mask)
            draw = ImageDraw.Draw(im, "RGBA")
            text = label.upper()
            width = draw.textlength(text, font=font)
            x, y = PANEL_AT[0] + 12, PANEL_AT[1] + PANEL - 44
            draw.rounded_rectangle((x, y, x + width + 26, y + 32), radius=16, fill=LABEL_FILL, outline=ACCENT, width=2)
            draw.text((x + 13, y + 6), text, font=font, fill=LABEL_TEXT)
            images.append(im)
    # One shared palette, built from the background and a few frames, keeps the
    # still title from flickering between frames.
    sample = Image.new("RGB", (bg.width, bg.height * 5))
    sample.paste(bg, (0, 0))
    for n, im in enumerate(images[:: max(1, len(images) // 4)][:4]):
        sample.paste(im, (0, bg.height * (n + 1)))
    palette = sample.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    write_gif(cfg["_out"] / "banner.gif", images, b.get("ms", 110), palette)


def build_hero(cfg):
    h = cfg["hero"]
    size, step = tuple(h["size"]), h.get("step", 3)
    idx = list(range(h["title"][0], h["title"][1], step))
    for name in cfg["scenes"]:
        idx += frames_of(cfg, name, h["take"], step)
    write_gif(cfg["_out"] / "hero.gif", [frame(cfg, i).resize(size, Image.LANCZOS) for i in idx], h.get("ms", 160))


def build_clips(cfg):
    c = cfg["clips"]
    size = tuple(c["size"])
    for name in cfg["scenes"]:
        images = [frame(cfg, i).resize(size, Image.LANCZOS) for i in frames_of(cfg, name, c["take"], c.get("step", 2))]
        write_gif(cfg["_out"] / f"clip_{name}.gif", images, c.get("ms", 120))


def build_stills(cfg):
    for name, at in cfg.get("stills", {}).items():
        path = cfg["_out"] / f"screenshot_{name}.png"
        frame(cfg, scene_start(cfg, name) + at).quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
        print(f"{path.name}: {path.stat().st_size // 1024} KB")


def contact_sheet(cfg):
    files = sorted((cfg["_work"] / "frames").glob("f*.png"))
    if not files:
        sys.exit("no frames: run  npm run readme:capture  first")
    every = max(1, len(files) // 60)
    picks = files[::every]
    w0, h0 = Image.open(picks[0]).size
    tw, cols = 192, 10
    th = round(h0 * tw / w0)
    sheet = Image.new("RGB", (tw * cols, (th + 18) * ((len(picks) + cols - 1) // cols)), "black")
    draw = ImageDraw.Draw(sheet)
    for n, f in enumerate(picks):
        x, y = (n % cols) * tw, (n // cols) * (th + 18)
        sheet.paste(Image.open(f).convert("RGB").resize((tw, th)), (x, y))
        draw.text((x + 4, y + th + 2), str(int(f.stem[1:])), fill="white")
    out = cfg["_work"] / "contact.png"
    sheet.save(out)
    print(f"{out}  (every {every} frames)")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cfg = load(args[0] if args else HERE / "media.json")
    if "--sheet" in sys.argv:
        contact_sheet(cfg)
        return
    cfg["_out"].mkdir(parents=True, exist_ok=True)
    build_banner(cfg)
    build_hero(cfg)
    build_clips(cfg)
    build_stills(cfg)


if __name__ == "__main__":
    main()
