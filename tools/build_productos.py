# -*- coding: utf-8 -*-
"""Genera /productos.html a partir de las fichas reales en producto/*.html.
Fuente de verdad: JSON-LD Product de cada ficha (nombre, precio, imagen, URL).
Uso (desde la raíz del repo): python3 tools/build_productos.py
Al agregar un producto nuevo, súmalo a GROUPS (el script avisa si falta)."""
import re, json, html, glob, os, sys, unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO)
cards = json.load(open('tools/product_cards.json', encoding='utf-8'))  # textos cortos e imágenes alt


def norm(t):
    t = unicodedata.normalize('NFD', t.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return ' ' + ' '.join(re.sub(r'[^a-z0-9]+', ' ', t).split()) + ' '

GROUPS = [
    ('placas', 'Arduino y placas', ['placa-uno-cable-usb', 'arduino-mega-2560-cable-usb']),
    ('kits', 'Kits y robótica', ['robot-arduino', 'kit-avanzado-arduino']),
    ('sensores', 'Sensores', ['sensor-de-distancia-ultrasonico', 'sensor-de-sonido-ky-038', 'sensor-flujo-de-agua-yf-s201', 'fotoresistencia-ldr-5mm']),
    ('modulos', 'Módulos, relés y pantallas', ['modulo-4-reles-arduino', 'modulo-rele-de-02-canales', 'display-lcd-16x2-con-i2c', 'modulo-rfid-rc522', 'modulo-de-reconocimiento-de-voz']),
    ('prototipado', 'Prototipado', ['protoboard-400-puntos', 'cables-dupont-macho-macho', 'potenciometro-10k']),
    ('energia', 'Energía y pilas', ['porta-bateria-18650-x-4', 'pila-recargable-via-usb-c-aaax4-2', 'cargador-de-pilas-universal-aa-aaa-4c-d']),
]
SHORT = {  # nombres cortos donde el del inicio no coincide con la ficha
    'pila-recargable-via-usb-c-aaax4-2': 'Pilas AAA Recargables USB-C ×4',
    'placa-uno-cable-usb': 'Placa compatible Arduino Uno + Cable USB',
    'arduino-mega-2560-cable-usb': 'Placa compatible Mega 2560 + Cable USB',
    'robot-arduino': 'Kit Robot Arduino 2WD',
}
GUIDES = [
    ('placas', 'primeros-pasos-con-arduino-uno-de-cero-a-tu-primer-sketch', 'Primeros pasos con Arduino Uno'),
    ('placas', 'raspberry-pi-vs-arduino-cual-elegir-para-tu-proyecto', 'Raspberry Pi vs Arduino: cuál elegir'),
    ('kits', 'mejores-kits-de-arduino-para-principiantes-guia-de-compra', 'Mejores kits de Arduino para principiantes'),
    ('kits', 'como-construir-un-robot-con-arduino-paso-a-paso', 'Cómo construir un robot con Arduino'),
    ('sensores', 'sensor-ultrasonico-hc-sr04-medicion-de-distancias-paso-a-paso', 'Sensor ultrasónico HC-SR04 paso a paso'),
    ('sensores', 'guia-esencial-de-sensores-para-arduino', 'Guía esencial de sensores para Arduino'),
    ('modulos', 'rele-ssr-contactor-arduino-esp32-220v', 'Relé, SSR o contactor para 220 V'),
    ('modulos', 'protocolo-i2c-arduino-esp32-pull-up-scanner', 'Protocolo I2C: pull-ups y scanner'),
    ('prototipado', 'proyectos-arduino-para-principiantes-los-mejores-para-empezar', 'Proyectos Arduino para empezar'),
    ('prototipado', 'como-soldar-con-estano-electronica-paso-a-paso', 'Cómo soldar con estaño'),
    ('energia', 'como-elegir-celdas-18650-y-21700-sin-caer-en-falsificaciones', 'Elegir celdas 18650 sin falsificaciones'),
    ('energia', 'como-armar-pack-baterias-18650-21700-paso-a-paso', 'Armar un pack de baterías 18650'),
]
for _, s, _ in GUIDES:
    assert os.path.exists(f'blog/{s}.html'), s


def product(slug):
    h = open(f'producto/{slug}.html', encoding='utf-8').read()
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        d = json.loads(b)
        for x in (d.get('@graph', [d]) if isinstance(d, dict) else d):
            if isinstance(x, dict) and x.get('@type') == 'Product':
                off = x.get('offers', {})
                off = off[0] if isinstance(off, list) else off
                img = x.get('image'); img = img[0] if isinstance(img, list) else img
                desc = re.split(r'(?<=[.!?])\s', x.get('description', ''))[0]
                return dict(slug=slug, name=x['name'], price=int(float(off['price'])), cur=off.get('priceCurrency', 'CLP'),
                            avail=off.get('availability'), img=img, desc=desc, full=x.get('description', ''))
    raise SystemExit('sin Product: ' + slug)


def clp(n):
    return '$' + f'{n:,}'.replace(',', '.')


allp = [s for _, _, ss in GROUPS for s in ss]
assert sorted(allp) == sorted(f[9:-5] for f in glob.glob('producto/*.html')), 'faltan productos en GROUPS'
P = {s: product(s) for s in allp}

# ---------------------------------------------------------------- tarjetas
grid = []
for key, label, slugs in GROUPS:
    for s in slugs:
        p, c = P[s], cards.get(s, {})
        local = p['img'].replace('https://www.ukrabot.cl/', '/')
        name = SHORT.get(s, c.get('h3') or p['name'].split(' — ')[0])
        hay = norm(' '.join([name, p['name'], p['full'], c.get('cat') or '', s.replace('-', ' ')]))
        grid.append(f'''      <a href="/producto/{s}" class="product-card" data-cat="{key}" data-q="{html.escape(hay, quote=True)}">
        <img src="{local}" alt="{html.escape(c.get('alt') or p['name'], quote=True)}" loading="lazy" width="400" height="180">
        <div class="product-card-body">
          <div class="product-card-cat">{html.escape(label)}</div>
          <h3>{html.escape(name)}</h3>
          <p>{html.escape(p['desc'])}</p>
          <div class="product-price">{clp(p['price'])} <span>CLP</span></div>
          <span class="product-cta">Ver producto →</span>
        </div>
      </a>''')

chips = ['<button type="button" class="chip" aria-pressed="true" data-filter="all">Todos <span>' + str(len(allp)) + '</span></button>']
chips += [f'<button type="button" class="chip" aria-pressed="false" data-filter="{k}">{html.escape(l)} <span>{len(ss)}</span></button>' for k, l, ss in GROUPS]

guides = '\n'.join(f'        <li><a href="/blog/{s}">{html.escape(t)}</a><span>{html.escape(dict((k, l) for k, l, _ in GROUPS)[k])}</span></li>' for k, s, t in GUIDES)

# ---------------------------------------------------------------- JSON-LD
items = []
for i, s in enumerate(allp, 1):
    p = P[s]
    offer = {"@type": "Offer", "price": str(p['price']), "priceCurrency": p['cur'], "url": f"https://www.ukrabot.cl/producto/{s}"}
    if p['avail']:
        offer['availability'] = p['avail']
    items.append({"@type": "ListItem", "position": i, "item": {"@type": "Product", "name": p['name'], "url": f"https://www.ukrabot.cl/producto/{s}", "image": p['img'], "offers": offer}})
ld = [
    {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Nuestros Productos — Componentes de electrónica y kits de robótica",
     "url": "https://www.ukrabot.cl/productos", "inLanguage": "es-CL",
     "isPartOf": {"@type": "WebSite", "name": "Blog de Ingeniería Robótica", "url": "https://www.ukrabot.cl"},
     "mainEntity": {"@type": "ItemList", "numberOfItems": len(items), "itemListElement": items}},
    {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://www.ukrabot.cl/"},
        {"@type": "ListItem", "position": 2, "name": "Productos", "item": "https://www.ukrabot.cl/productos"}]},
]
ldtxt = '\n'.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)

# ---------------------------------------------------------------- piezas de about.html
ab = open('about.html', encoding='utf-8').read()
css = re.search(r'<style>(.*?)</style>', ab, re.S).group(1)
tracking = ab[ab.index('</style>') + len('</style>'):ab.index('</head>')]
footer = ab[ab.index('<footer'):]
lo, hi = min(P[s]['price'] for s in allp), max(P[s]['price'] for s in allp)

TITLE = 'Nuestros Productos — Componentes de Electrónica y Kits de Robótica | ukrabot.cl'
DESC = f'Catálogo de {len(allp)} productos de electrónica y robótica: placas Arduino, sensores, relés, kits de robot y pilas recargables. Precios en pesos chilenos y envíos a todo Chile.'

EXTRA_CSS = '''
.store{max-width:1200px;margin:auto;padding:0 24px 40px}
.store-tools{margin:4px 0 14px}
.store-search{display:flex;align-items:center;gap:10px;max-width:560px;background:#fff;border:1px solid rgba(30,25,15,.18);border-radius:999px;padding:0 18px}
.store-search:focus-within{border-color:var(--accent-2);box-shadow:0 0 0 3px rgba(47,111,176,.15)}
.store-search svg{flex:none;color:var(--text-muted)}
.store-search input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:1rem;padding:12px 0;color:var(--text-primary)}
.store-search input:focus{outline:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.store-count{font-size:.9rem;color:var(--text-muted);margin:0 0 14px}
.store-empty{padding:40px 26px;text-align:center;background:#fff;border:1px solid var(--border);border-radius:20px;color:var(--text-secondary)}
.store-empty p+p{margin-top:8px}
.store-reset{margin-top:16px;font:inherit;font-weight:700;font-size:.9rem;padding:10px 20px;border-radius:999px;border:0;background:var(--accent);color:#fff;cursor:pointer}
.store-reset:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
.product-grid[hidden]{display:none}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px}
.chip{font:inherit;font-size:.82rem;font-weight:600;padding:9px 16px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);cursor:pointer;transition:border-color .2s,color .2s,background .2s}
.chip span{color:var(--text-muted);font-weight:500;margin-left:4px}
.chip:hover{border-color:rgba(169,123,35,.45);color:var(--text-primary)}
.chip[aria-pressed=true]{background:var(--text-primary);border-color:var(--text-primary);color:#fff}
.chip[aria-pressed=true] span{color:rgba(255,255,255,.7)}
.chip:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.product-card{background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease;box-shadow:var(--shadow-card)}
.product-card[hidden]{display:none}
.product-card:hover{transform:translateY(-4px);box-shadow:0 20px 44px rgba(30,25,15,.14);border-color:rgba(169,123,35,.4)}
.product-card:focus-visible{outline:2px solid var(--accent-2);outline-offset:3px}
.product-card img{width:100%;height:180px;object-fit:cover;background:#fff}
.product-card-body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1;gap:6px}
.product-card-cat{font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--accent-2)}
.product-card h3{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:1.12rem;color:var(--text-primary);line-height:1.22;margin-top:2px}
.product-card p{color:var(--text-secondary);font-size:.84rem;line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.product-price{margin-top:auto;padding-top:12px;font-size:1.1rem;font-weight:700;color:var(--text-primary)}
.product-price span{font-size:.72rem;font-weight:500;color:var(--text-muted);margin-left:4px}
.product-cta{display:inline-block;align-self:flex-start;margin-top:12px;background:var(--accent);color:#fff;font-size:.78rem;font-weight:700;padding:8px 16px;border-radius:999px;transition:box-shadow .2s,transform .15s}
.product-card:hover .product-cta{box-shadow:0 6px 18px rgba(169,123,35,.38);transform:translateY(-1px)}
.buy{max-width:1200px;margin:24px auto 0;padding:0 24px}
.buy-inner{background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:36px;box-shadow:var(--shadow-card);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:36px;align-items:center}
.buy h2,.learn h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:1.7rem;line-height:1.2;margin-bottom:10px}
.buy p{color:var(--text-secondary)}
.steps{list-style:none;counter-reset:s;display:grid;gap:14px}
.steps li{counter-increment:s;display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:start;color:var(--text-secondary);font-size:.92rem}
.steps li::before{content:counter(s);width:36px;height:36px;border-radius:50%;background:#f3ecdd;color:var(--accent);font-weight:700;display:grid;place-items:center}
.steps strong{color:var(--text-primary)}
.buy-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.btn{display:inline-block;padding:11px 20px;border-radius:999px;font-weight:700;font-size:.86rem;text-decoration:none}
.btn-primary{background:var(--accent);color:#fff}
.btn-ghost{border:1px solid rgba(30,25,15,.25);color:var(--text-primary)}
.learn{max-width:1200px;margin:56px auto 90px;padding:0 24px}
.learn>p{color:var(--text-secondary);max-width:720px;margin-bottom:22px}
.guides{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.guides li{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;gap:2px}
.guides a{font-weight:600;text-decoration:none;color:var(--text-primary)}
.guides a:hover{color:var(--accent-2)}
.guides span{font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em}
@media (max-width:860px){.buy-inner{grid-template-columns:1fr;padding:28px 22px}}
@media (max-width:620px){.product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.product-card img{height:130px}.product-card-body{padding:14px}.product-card p{display:none}.product-card h3{font-size:.98rem}.chips{flex-wrap:nowrap;overflow-x:auto;margin-right:-24px;padding-right:24px;scrollbar-width:none}.chip{flex:none}}
@media (max-width:360px){.product-grid{grid-template-columns:1fr}}
'''

page = f'''<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f4ee">

<title>{TITLE}</title>
<meta name="description" content="{DESC}">
<meta name="author" content="Alberto Gallardo">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="https://www.ukrabot.cl/productos">
<link rel="icon" href="/favicon.ico" sizes="any">

<meta property="og:type" content="website">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
<meta property="og:url" content="https://www.ukrabot.cl/productos">
<meta property="og:image" content="{P['kit-avanzado-arduino']['img']}">
<meta property="og:locale" content="es_CL">
<meta property="og:site_name" content="Blog de Ingeniería Robótica">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{TITLE}">
<meta name="twitter:description" content="{DESC}">

{ldtxt}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

<style>{css}{EXTRA_CSS}</style>
{tracking}</head>
<body>
<a class="skip-link" href="#main">Saltar al contenido</a>

<header class="site-header">
  <div class="nav-inner">
    <a href="/" class="logo" aria-label="Inicio Blog de Ingeniería Robótica">Robótica <span>Ingeniería</span></a>
    <nav class="nav-links" aria-label="Navegación principal">
      <a href="/">Inicio</a>
      <a href="/#categories">Tutoriales</a>
      <a href="/productos" aria-current="page">Productos</a>
      <a href="/about">Quiénes Somos</a>
      <a href="/contact">Contacto</a>
    </nav>
  </div>
</header>

<section class="page-hero">
  <div class="eyebrow">Tienda · Componentes y kits</div>
  <h1>Nuestros Productos</h1>
  <p class="lede">Placas Arduino, sensores, módulos, kits de robótica y pilas recargables para los mismos proyectos que explicamos en el blog. Precios en pesos chilenos, con atención directa y envíos a todo Chile.</p>
  <p class="meta">{len(allp)} productos · desde {clp(lo)} hasta {clp(hi)} CLP · compra por WhatsApp, teléfono o correo</p>
</section>

<main class="store" id="main">
  <div class="store-tools">
    <label class="store-search"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span class="sr-only">Buscar productos</span>
      <input id="pq" type="search" placeholder="Buscar: relé, sensor, pilas AAA, Arduino Uno…" autocomplete="off" enterkeyhint="search">
    </label>
  </div>
  <div class="chips" role="group" aria-label="Filtrar por categoría">
    {"".join(chips)}
  </div>
  <p class="store-count" id="count" aria-live="polite">{len(allp)} productos</p>
  <div class="product-grid" id="pgrid" aria-label="Catálogo de productos">
{chr(10).join(grid)}
  </div>
  <div class="store-empty" id="pempty" hidden>
    <p id="pempty-msg">No hay productos que coincidan.</p>
    <p>¿Buscas algo que no está en el catálogo? <a href="https://wa.me/56993514970" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> y te confirmamos si lo tenemos.</p>
    <button type="button" class="store-reset" id="preset">Quitar filtros</button>
  </div>
</main>

<section class="buy" aria-labelledby="buy-title">
  <div class="buy-inner">
    <div>
      <h2 id="buy-title">Cómo comprar</h2>
      <p>No hay carrito: atendemos cada pedido de forma directa, en español, de lunes a viernes entre 09:00 y 19:00 (Santiago, Chile).</p>
      <div class="buy-actions">
        <a class="btn btn-primary" href="https://wa.me/56993514970" target="_blank" rel="noopener">Escribir por WhatsApp</a>
        <a class="btn btn-ghost" href="mailto:contacto@ukrabot.cl">contacto@ukrabot.cl</a>
      </div>
    </div>
    <ol class="steps">
      <li><span><strong>Elige el producto</strong> y abre su ficha para revisar especificaciones y precio.</span></li>
      <li><span><strong>Escríbenos</strong> por WhatsApp, teléfono o correo con el producto y tu comuna.</span></li>
      <li><span><strong>Coordinamos el pago y el despacho</strong> a cualquier región de Chile.</span></li>
    </ol>
  </div>
</section>

<section class="learn" aria-labelledby="learn-title">
  <h2 id="learn-title">Guías para usar estos productos</h2>
  <p>Cada producto tiene guías técnicas en el blog: cómo conectarlo, programarlo y evitar los errores típicos.</p>
  <ul class="guides">
{guides}
  </ul>
</section>

<script>
(function(){{
  var chips=[].slice.call(document.querySelectorAll('.chip')),cards=[].slice.call(document.querySelectorAll('.product-card')),
      q=document.getElementById('pq'),count=document.getElementById('count'),grid=document.getElementById('pgrid'),
      empty=document.getElementById('pempty'),emsg=document.getElementById('pempty-msg'),cat='all';
  function norm(s){{return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ');}}
  function label(){{var c=chips.filter(function(b){{return b.getAttribute('data-filter')===cat;}})[0];return c?c.firstChild.textContent.trim():'';}}
  function apply(push){{
    var words=norm(q.value).split(/\s+/).filter(Boolean),n=0;
    cards.forEach(function(c){{
      var ok=(cat==='all'||c.getAttribute('data-cat')===cat)&&words.every(function(w){{return c.getAttribute('data-q').indexOf(' '+w)>-1;}});
      c.hidden=!ok; if(ok) n++;
    }});
    chips.forEach(function(b){{b.setAttribute('aria-pressed',b.getAttribute('data-filter')===cat?'true':'false');}});
    count.textContent=n===1?'1 producto':n+' productos';
    grid.hidden=n===0; empty.hidden=n>0;
    if(!n) emsg.textContent='No hay productos que coincidan con "'+q.value.trim()+'"'+(cat!=='all'?' en '+label():'')+'.';
    if(push!==false){{
      var p=new URLSearchParams(); if(cat!=='all') p.set('cat',cat); if(q.value.trim()) p.set('q',q.value.trim());
      history.replaceState(null,'',location.pathname+(p.toString()?'?'+p:''));
    }}
  }}
  chips.forEach(function(b){{b.addEventListener('click',function(){{cat=b.getAttribute('data-filter');apply();}});}});
  q.addEventListener('input',function(){{apply();}});
  document.getElementById('preset').addEventListener('click',function(){{q.value='';cat='all';apply();q.focus();}});
  var p=new URLSearchParams(location.search);
  if(p.get('q')) q.value=p.get('q');
  if(p.get('cat')&&chips.some(function(b){{return b.getAttribute('data-filter')===p.get('cat');}})) cat=p.get('cat');
  if(p.get('q')||p.get('cat')) apply(false);
}})();
</script>

{footer}'''
open('productos.html', 'w', encoding='utf-8').write(page)
print('productos.html', len(page), 'bytes;', len(allp), 'productos; rango', clp(lo), clp(hi))
