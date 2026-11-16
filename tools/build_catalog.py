# -*- coding: utf-8 -*-
"""Genera worker/catalog.json (catálogo base de la tienda) desde producto/*.html
y tools/digital_products.json.
El precio de la ficha es el precio base; el panel de admin puede sobrescribirlo.
Uso: python3 tools/build_catalog.py"""
import os, re, json, glob, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
cards = json.load(open('tools/product_cards.json', encoding='utf-8'))
SHORT = {
    'pila-recargable-via-usb-c-aaax4-2': 'Pilas AAA Recargables USB-C ×4',
    'placa-uno-cable-usb': 'Placa compatible Arduino Uno + Cable USB',
    'arduino-mega-2560-cable-usb': 'Placa compatible Mega 2560 + Cable USB',
    'robot-arduino': 'Kit Robot Arduino 2WD',
}

out = []
for f in sorted(glob.glob('producto/*.html')):
    slug = os.path.basename(f)[:-5]
    h = open(f, encoding='utf-8').read()
    prod = None
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try:
            d = json.loads(b)
        except ValueError:
            continue
        for x in (d.get('@graph', [d]) if isinstance(d, dict) else d):
            if isinstance(x, dict) and x.get('@type') == 'Product':
                prod = x
    assert prod, 'sin Product: ' + slug
    off = prod['offers'][0] if isinstance(prod['offers'], list) else prod['offers']
    img = prod.get('image'); img = img[0] if isinstance(img, list) else img
    c = cards.get(slug, {})
    out.append({
        'slug': slug,
        'name': prod['name'],
        'short': SHORT.get(slug, c.get('h3') or prod['name'].split(' — ')[0]),
        'price': int(float(off['price'])),
        'img': img.replace('https://www.ukrabot.cl', ''),
        'url': f'/producto/{slug}',
    })
# productos digitales (descarga inmediata): no tienen ficha en /producto/
out += json.load(open('tools/digital_products.json', encoding='utf-8'))
os.makedirs('worker', exist_ok=True)
json.dump(out, open('worker/catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'worker/catalog.json: {len(out)} productos')
