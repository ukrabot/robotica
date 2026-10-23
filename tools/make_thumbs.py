# -*- coding: utf-8 -*-
"""Genera blog/thumbs/<slug>.webp (480x270) desde la imagen de portada de cada artículo.
Uso: python3 tools/make_thumbs.py [--force]"""
import os, re, sys, glob, io
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'blog', 'thumbs')
TW, TH = 480, 270


def hero_src(path):
    h = open(path, encoding='utf-8').read()
    src = re.search(r'<img[^>]*src="([^"]+)"', h).group(1).split('?')[0]
    return os.path.join(ROOT, 'blog', src) if not src.startswith('/') else os.path.join(ROOT, src.lstrip('/'))


def cover(im):
    im = im.convert('RGB')
    r = max(TW / im.width, TH / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x, y = (im.width - TW) // 2, (im.height - TH) // 2
    return im.crop((x, y, x + TW, y + TH))


def main(force=False):
    os.makedirs(OUT, exist_ok=True)
    todo, svgs = [], []
    for f in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        slug = os.path.basename(f)[:-5]
        if slug == 'index':
            continue
        dst = os.path.join(OUT, slug + '.webp')
        src = hero_src(f)
        if not force and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            continue
        (svgs if src.endswith('.svg') else todo).append((src, dst))
    for src, dst in todo:
        cover(Image.open(src)).save(dst, 'WEBP', quality=74, method=6)
    if svgs:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1600, 'height': 900})
            for src, dst in svgs:
                head = open(src, encoding='utf-8').read(600)
                w = re.search(r'width="(\d+)', head); hh = re.search(r'height="(\d+)', head)
                pg.set_viewport_size({'width': int(w.group(1)) if w else 1600, 'height': int(hh.group(1)) if hh else 800})
                pg.goto('file://' + src)
                pg.wait_for_timeout(50)
                png = pg.screenshot(full_page=False)
                cover(Image.open(io.BytesIO(png))).save(dst, 'WEBP', quality=74, method=6)
            b.close()
    print(f'thumbs: {len(todo)} raster + {len(svgs)} svg generadas en {OUT}')


if __name__ == '__main__':
    main('--force' in sys.argv)
