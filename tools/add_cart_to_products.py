# -*- coding: utf-8 -*-
"""Inserta el bloque "Agregar al carrito" y los recursos de la tienda en producto/*.html.
Idempotente. Uso: python3 tools/add_cart_to_products.py"""
import os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
CSS = '<link rel="stylesheet" href="/tienda/tienda.css?v=2">\n'
JS = '<script src="/tienda/tienda.js?v=2" defer></script>\n'


def close_div(h, start):
    """Índice justo después del </div> que cierra el <div ...> que empieza en start."""
    depth, i = 0, start
    for m in re.finditer(r'<div\b|</div>', h[start:]):
        depth += 1 if m.group(0) == '<div' else -1
        if depth == 0:
            return start + m.end()
    raise ValueError('div sin cierre')


for f in sorted(glob.glob('producto/*.html')):
    slug = os.path.basename(f)[:-5]
    h = open(f, encoding='utf-8').read()
    changed = False
    if 'data-ukr-buy=' not in h:
        i = h.index('<div class="price-panel"')
        j = close_div(h, i)
        h = h[:j] + f'\n    <div class="ukr-buy" id="comprar-online" data-ukr-buy="{slug}" aria-label="Comprar en línea"></div>' + h[j:]
        changed = True
    if '/tienda/tienda.css' not in h:
        h = h.replace('</head>', CSS + '</head>', 1); changed = True
    if '/tienda/tienda.js' not in h:
        k = h.rindex('</body>'); h = h[:k] + JS + h[k:]; changed = True
    if changed:
        open(f, 'w', encoding='utf-8').write(h)
    print(('ok   ' if changed else 'skip ') + f)
