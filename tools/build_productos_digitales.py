# -*- coding: utf-8 -*-
"""Genera productos-digitales.html (listado de productos de descarga) con el esqueleto
de about.html, desde tools/digital_products.json. Sin AdSense: es una página de venta.
Uso: python3 tools/build_productos_digitales.py"""
import os, re, json, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
ab = open('about.html', encoding='utf-8').read()
css = re.search(r'<style>(.*?)</style>', ab, re.S).group(1)
tracking = ab[ab.index('</style>') + len('</style>'):ab.index('</head>')]
tracking = re.sub(r'<script async src="https://pagead2\.googlesyndication\.com[^>]*></script>\s*', '', tracking)
header = re.search(r'<header class="site-header">.*?</header>', ab, re.S).group(0).replace(' aria-current="page"', '')
header = header.replace('<a href="/productos-digitales">', '<a href="/productos-digitales" aria-current="page">')
footer = ab[ab.index('<footer'):]
products = json.load(open('tools/digital_products.json', encoding='utf-8'))
esc = lambda s: html.escape(s, quote=True)
fmt = lambda n: '$' + f'{n:,}'.replace(',', '.')

cards = []
for p in products:
    inc = ''.join(f'<li>{esc(i)}</li>' for i in p.get('includes', []))
    cards.append(f'''<article class="dp-card" id="{esc(p['slug'])}">
  <a class="dp-img" href="{esc(p['url'])}"><img src="{esc(p.get('cover', p['img']))}" alt="Portada de {esc(p['short'])}" width="1200" height="800" loading="lazy"></a>
  <div class="dp-body">
    <span class="dp-tag">Descarga inmediata</span>
    <h2><a href="{esc(p['url'])}">{esc(p['name'])}</a></h2>
    <p>{esc(p.get('desc', ''))}</p>
    <ul>{inc}</ul>
    <div class="dp-price"><strong data-price-slug="{esc(p['slug'])}">{fmt(p['price'])}</strong><span>Pago único</span></div>
    <div class="ukr-buy" data-ukr-buy="{esc(p['slug'])}" aria-label="Comprar {esc(p['short'])}"></div>
    <a class="dp-more" href="{esc(p['url'])}">Ver detalles y la guía completa →</a>
  </div>
</article>''')

page_css = '''
.dp-hero{max-width:1120px;margin:0 auto;padding:56px 24px 12px}
.dp-eyebrow{font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#a97b23}
.dp-hero h1{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(2.2rem,5vw,3.4rem);line-height:1.08;margin:10px 0 14px}
.dp-hero p{max-width:640px;color:#57534a;font-size:1.08rem;margin:0}
.dp-wrap{max-width:1120px;margin:0 auto;padding:28px 24px 30px;display:grid;gap:28px}
.dp-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:32px;background:#fff;border:1px solid rgba(30,25,15,.1);border-radius:20px;padding:28px;align-items:start}
.dp-img img{display:block;width:100%;height:auto;border-radius:14px}
.dp-tag{display:inline-block;padding:3px 10px;border-radius:999px;background:#e7f0e4;color:#3f7a4b;font-size:.75rem;font-weight:700}
.dp-card h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:1.8rem;line-height:1.15;margin:10px 0 10px}
.dp-card h2 a{color:inherit;text-decoration:none}
.dp-card h2 a:hover{text-decoration:underline}
.dp-card p{color:#57534a;margin:0 0 12px}
.dp-card ul{margin:0 0 16px;padding-left:20px;color:#1e1b15}
.dp-card li{margin-bottom:6px}
.dp-price{display:flex;align-items:baseline;gap:12px}
.dp-price strong{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:2rem}
.dp-price span{color:#57534a;font-size:.9rem}
.dp-more{display:inline-block;margin-top:14px;color:#2f6fb0;font-weight:600;text-decoration:none}
.dp-more:hover{text-decoration:underline}
.dp-steps{max-width:1120px;margin:0 auto;padding:10px 24px 70px}
.dp-steps h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:1.7rem;margin:0 0 16px}
.dp-steps ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;counter-reset:s}
.dp-steps li{background:#fff;border:1px solid rgba(30,25,15,.1);border-radius:16px;padding:20px;counter-increment:s}
.dp-steps li:before{content:counter(s);display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#a97b23;color:#fff;font-weight:700;margin-bottom:10px}
.dp-steps b{display:block;margin-bottom:4px}
.dp-steps li span{color:#57534a;font-size:.95rem}
.dp-fine{color:#8b8577;font-size:.86rem;margin:18px 0 0}
@media (max-width:860px){.dp-card{grid-template-columns:1fr;padding:20px;gap:20px}.dp-steps ol{grid-template-columns:1fr}}
'''

body = f'''<main id="main">
<section class="dp-hero">
  <div class="dp-eyebrow">Tienda digital</div>
  <h1>Productos digitales</h1>
  <p>Planillas, guías y herramientas para tus proyectos de electrónica y movilidad eléctrica. Pagas en línea y descargas al instante.</p>
</section>
<section class="dp-wrap" aria-label="Productos">
{chr(10).join(cards)}
</section>
<section class="dp-steps" aria-labelledby="dp-steps-t">
  <h2 id="dp-steps-t">Cómo funciona</h2>
  <ol>
    <li><b>Elige y paga</b><span>Agrega el producto al carrito y paga con Flow o Mercado Pago. Solo te pedimos nombre y correo.</span></li>
    <li><b>Descarga al instante</b><span>Apenas se confirma el pago, la página de tu pedido muestra el botón para descargar.</span></li>
    <li><b>Vuelve cuando quieras</b><span>Guarda el enlace de tu pedido: te permite volver a descargar tus archivos.</span></li>
  </ol>
  <p class="dp-fine">Licencia de uso personal. Por ser contenido digital de descarga inmediata, no tiene derecho a retracto; si un archivo llega dañado o no abre, te lo reponemos o devolvemos el dinero. Detalles en los <a href="/terms#compras">términos de compra</a>. ¿Dudas? Escríbenos a <a href="mailto:contacto@ukrabot.cl">contacto@ukrabot.cl</a>.</p>
</section>
</main>'''

page = f'''<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f4ee">
<title>Productos digitales: planillas y guías descargables | ukrabot.cl</title>
<meta name="description" content="Planillas Excel y guías en PDF para proyectos de electrónica y conversión a eléctrico en Chile. Pago con Flow o Mercado Pago y descarga inmediata.">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="https://www.ukrabot.cl/productos-digitales">
<meta property="og:type" content="website">
<meta property="og:title" content="Productos digitales | ukrabot.cl">
<meta property="og:description" content="Planillas y guías descargables para tus proyectos. Descarga inmediata.">
<meta property="og:image" content="https://www.ukrabot.cl{products[0].get('cover', products[0]['img'])}">
<meta property="og:url" content="https://www.ukrabot.cl/productos-digitales">
<meta property="og:locale" content="es_CL">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>{css}{page_css}</style>
<link rel="stylesheet" href="/tienda/tienda.css?v=5">
{tracking}</head>
<body>
<a class="skip-link" href="#main">Saltar al contenido</a>

{header}

{body}

<script src="/tienda/tienda.js?v=5" defer></script>
{footer}'''
open('productos-digitales.html', 'w', encoding='utf-8').write(page)
print('ok productos-digitales.html', len(page))
