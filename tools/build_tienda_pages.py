# -*- coding: utf-8 -*-
"""Genera carrito.html y pedido.html con el esqueleto de about.html (sin AdSense, noindex).
Uso: python3 tools/build_tienda_pages.py"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
ab = open('about.html', encoding='utf-8').read()
css = re.search(r'<style>(.*?)</style>', ab, re.S).group(1)
tracking = ab[ab.index('</style>') + len('</style>'):ab.index('</head>')]
tracking = re.sub(r'<script async src="https://pagead2\.googlesyndication\.com[^>]*></script>\s*', '', tracking)
header = re.search(r'<header class="site-header">.*?</header>', ab, re.S).group(0).replace(' aria-current="page"', '')
footer = ab[ab.index('<footer'):]

PAGES = {
    'carrito.html': ('Carrito de compras | ukrabot.cl', 'Revisa tu carrito y paga con Flow.',
                     '<main class="ukr-page" id="main"><h1>Carrito</h1><p class="ukr-lede">Revisa los productos, completa los datos de despacho y paga de forma segura con Flow.</p>'
                     '<div id="ukr-checkout"><p class="ukr-lede">Cargando tu carrito…</p></div></main>'),
    'pedido.html': ('Estado del pedido | ukrabot.cl', 'Estado de tu pedido en ukrabot.cl.',
                    '<main class="ukr-page" id="main" style="max-width:760px"><div id="ukr-order"><p class="ukr-lede">Consultando tu pedido…</p></div></main>'),
}
for fn, (title, desc, body) in PAGES.items():
    page = f'''<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f4ee">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
<link rel="stylesheet" href="/tienda/tienda.css?v=1">
{tracking}</head>
<body>
<a class="skip-link" href="#main">Saltar al contenido</a>

{header}

{body}

<script src="/tienda/tienda.js?v=1" defer></script>
{footer}'''
    open(fn, 'w', encoding='utf-8').write(page)
    print('ok', fn, len(page))
