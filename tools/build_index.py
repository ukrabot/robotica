# -*- coding: utf-8 -*-
"""Genera la portada (index.html) y el archivo de tutoriales (blog/index.html)
a partir de los artículos en blog/*.html.

Uso (desde la raíz del repo):
    python3 tools/make_thumbs.py     # miniaturas de artículos nuevos
    python3 tools/build_index.py     # portada + /blog/

La portada se reemplaza entre <!-- HOME:START --> y <!-- HOME:END -->; el resto
(head, menú, pie) se conserva. /blog/ usa el mismo esqueleto que about.html.
"""
import os, re, sys, json, glob, html, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from topics import TOPICS, classify  # noqa: E402

SITE = 'https://www.ukrabot.cl'
MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
TOPIC = {k: dict(key=k, name=n, desc=d, icon=i) for k, n, d, i in TOPICS}
CARD = json.load(open('tools/card_text.json', encoding='utf-8'))
esc = lambda s: html.escape(s or '', quote=True)

ICON = {
    'home': 'M-20 0 L0 -20 L20 0 M-14 -6 V20 H14 V-6 M-5 20 V8 H5 V20',
    'wifi': 'M-22 -6 A31 31 0 0 1 22 -6 M-14 3 A20 20 0 0 1 14 3 M-6 12 A9 9 0 0 1 6 12 M0 20 L0 20.5',
    'battery': 'M-20 -11 H16 V11 H-20 Z M16 -5 H21 V5 H16 M-15 -6 H-2 V6 H-15 Z',
    'bolt': 'M6 -24 L-14 4 H0 L-6 24 L14 -4 H0 Z',
    'cpu': 'M-13 -13 H13 V13 H-13 Z M-6 -6 H6 V6 H-6 Z M-7 -20 V-13 M7 -20 V-13 M-7 13 V20 M7 13 V20 M-20 -7 H-13 M-20 7 H-13 M13 -7 H20 M13 7 H20',
    'code': 'M-10 -12 L-22 0 L-10 12 M10 -12 L22 0 L10 12 M4 -18 L-4 18',
    'eye': 'M-24 0 Q0 -22 24 0 Q0 22 -24 0 Z M0 -8 A8 8 0 1 1 -0.1 -8 Z',
    'gear': 'M0 -10 A10 10 0 1 1 -0.1 -10 Z M0 -24 V-16 M0 16 V24 M-24 0 H-16 M16 0 H24 M-17 -17 L-11 -11 M11 11 L17 17 M17 -17 L11 -11 M-11 11 L-17 17',
    'shield': 'M0 -24 L18 -16 V0 C18 12 10 20 0 24 C-10 20 -18 12 -18 0 V-16 Z M-8 0 L-2 7 L10 -7',
    'target': 'M0 -22 A22 22 0 1 1 -0.1 -22 Z M0 -11 A11 11 0 1 1 -0.1 -11 Z',
    'check': 'M-14 0 L-4 10 L16 -12',
    'up': 'M-18 14 L-4 0 L4 8 L20 -12 M8 -12 H20 V0',
}


def icon(name):
    return (f'<svg viewBox="-28 -28 56 56" width="26" height="26" aria-hidden="true" focusable="false">'
            f'<path d="{ICON[name]}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')


def fecha(d):
    y, m, dd = d.split('-')
    return f'{int(dd)} {MONTHS[int(m) - 1]} {y}'


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


# ---------------------------------------------------------------- artículos
def load():
    out = []
    for f in sorted(glob.glob('blog/*.html')):
        slug = os.path.basename(f)[:-5]
        if slug == 'index':
            continue
        h = open(f, encoding='utf-8').read()
        ld = {}
        for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
            try:
                d = json.loads(b)
            except ValueError:
                continue
            for x in (d.get('@graph', [d]) if isinstance(d, dict) else d):
                if isinstance(x, dict) and x.get('@type') in ('TechArticle', 'Article', 'BlogPosting', 'HowTo'):
                    ld = x
        txt = lambda p: (html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip() if (m := re.search(p, h, re.S)) else '')
        h1 = txt(r'<h1[^>]*>(.*?)</h1>')
        eb = txt(r'class="eyebrow"[^>]*>(.*?)</div>')
        eb = re.split(r'\s*·\s*(?:Actualizado|Publicado)', eb)[0]
        mins = re.search(r'(\d+)\s*min de lectura', h)
        c = CARD.get(slug, {})
        title = c.get('title') or (h1.split(' — ')[0] if len(h1) > 70 and ' — ' in h1 else h1)
        desc = c.get('desc') or txt(r'<meta name="description" content="([^"]*)"')
        hero = re.search(r'<img[^>]*src="([^"]+)"', h).group(1)
        out.append(dict(slug=slug, title=title, full=h1, desc=desc, topic=classify(slug, eb),
                        date=(ld.get('datePublished') or '2026-01-01')[:10], mins=int(mins.group(1)) if mins else None,
                        hero='/blog/' + hero if not hero.startswith(('/', 'http')) else hero))
    out.sort(key=lambda a: (a['date'], a['slug']), reverse=True)
    return out


A = load()
BY = {a['slug']: a for a in A}
N = len(A)
COUNT = {k: sum(a['topic'] == k for a in A) for k in TOPIC}
thumb = lambda a: f'/blog/thumbs/{a["slug"]}.webp'
for a in A:
    assert os.path.exists(thumb(a).lstrip('/')), 'falta miniatura: ' + a['slug'] + ' (ejecuta tools/make_thumbs.py)'


def meta(a):
    m = f'<time datetime="{a["date"]}">{fecha(a["date"])}</time>'
    return m + (f', {a["mins"]} min de lectura' if a['mins'] else '')


def row(a, cls='row'):
    return (f'<li><a class="{cls}" href="/blog/{a["slug"]}">'
            f'<img src="{thumb(a)}" alt="" loading="lazy" width="480" height="270">'
            f'<span class="row-text"><span class="row-topic">{esc(TOPIC[a["topic"]]["name"])}</span>'
            f'<span class="row-title">{esc(a["title"])}</span><span class="row-meta">{meta(a)}</span></span></a></li>')


# ================================================================ PORTADA
import datetime
TODAY = datetime.date.today().isoformat()
PAST = [a for a in A if a['date'] <= TODAY]  # la portada no destaca fechas futuras
recent = PAST[:5]
used = {a['slug'] for a in recent}
buy = [a for a in PAST if a['slug'] not in used and re.search(r'guia-de-compra|cual-comprar|que-comprar', a['slug'])][:6]
PROJECTS = ['como-construir-un-robot-con-arduino-paso-a-paso', 'sistema-de-riego-automatico-con-sensor-de-humedad-de-suelo',
            'estacion-meteorologica-con-arduino-y-pantalla-oled', 'domotica-con-esp32-y-mqtt-controla-tu-casa-desde-el-celular',
            'construye-un-brazo-robotico-de-6-ejes-con-arduino', 'radar-con-sensor-ultrasonico-y-processing']
proj = [BY[s] for s in PROJECTS if s in BY]
f = recent[0]

drawers = '\n'.join(
    f'''      <a class="drawer" href="/blog/?tema={k}">
        <span class="drawer-icon">{icon(t["icon"])}</span>
        <span class="drawer-label">{esc(t["name"])}</span>
        <span class="drawer-count">{COUNT[k]} guías</span>
        <span class="drawer-pull" aria-hidden="true"></span>
      </a>''' for k, t in TOPIC.items())

HOME = f'''<!-- HOME:START (generado por tools/build_index.py; no editar a mano) -->
  <section class="hero" aria-label="Portada principal">
    <img class="hero-bg" src="robotic_arm_hero.jpg" alt="Brazo robótico industrial de 6 ejes soldando una pieza metálica con chispas, en un entorno de manufactura" loading="eager" fetchpriority="high" />
    <div class="hero-inner" id="main">
      <h1>Ingeniería robótica aplicada</h1>
      <p class="sub">Guías técnicas en español para construir robots, programar Arduino y ESP32, armar baterías y elegir bien qué comprar para la casa. Con fuentes primarias y precios de Chile.</p>
      <form class="home-search" action="/blog/" method="get" role="search">
        <label class="sr-only" for="home-q">Buscar una guía</label>
        <input id="home-q" name="q" type="search" placeholder="Busca entre {N} guías" autocomplete="off" enterkeyhint="search">
        <button type="submit">Buscar</button>
      </form>
      <p class="home-examples">Por ejemplo:
        <a href="/blog/?q=esp32">ESP32</a>
        <a href="/blog/?tema=hogar">electrodomésticos</a>
        <a href="/blog/?tema=energia">baterías y solar</a>
        <a href="/blog/?tema=fabricacion">impresión 3D</a>
      </p>
    </div>
  </section>

  <main>

  <section class="home-cabinet" id="temas" aria-labelledby="temas-title">
    <div class="home-wrap">
      <div class="home-head">
        <h2 id="temas-title">Explora por tema</h2>
        <p>{len(TOPIC)} cajones, {N} guías. Abre el que corresponde a tu proyecto.</p>
      </div>
      <div class="cabinet">
{drawers}
      </div>
    </div>
  </section>

  <section class="home-recent" id="latest" aria-labelledby="recent-title">
    <div class="home-head home-head-row">
      <h2 id="recent-title">Lo último publicado</h2>
      <a class="home-more" href="/blog/">Ver los {N} tutoriales</a>
    </div>
    <div class="recent-grid">
      <a class="feature" href="/blog/{f["slug"]}">
        <img src="{f["hero"]}" alt="" width="1408" height="768" loading="lazy">
        <span class="row-topic">{esc(TOPIC[f["topic"]]["name"])}</span>
        <span class="feature-title">{esc(f["title"])}</span>
        <span class="feature-desc">{esc(f["desc"])}</span>
        <span class="row-meta">{meta(f)}</span>
      </a>
      <ul class="rows">
        {"".join(row(a) for a in recent[1:])}
      </ul>
    </div>
  </section>

  <section class="home-columns" aria-label="Guías seleccionadas">
    <div class="home-col">
      <h2>Antes de comprar</h2>
      <p>Guías de compra con consumo real, qué mirar en la ficha y precios de referencia en Chile.</p>
      <ul class="rows rows-compact">
        {"".join(row(a) for a in buy)}
      </ul>
      <a class="home-more" href="/blog/?tema=hogar">Ver las {COUNT["hogar"]} guías de electrodomésticos</a>
    </div>
    <div class="home-col">
      <h2>Para armar este fin de semana</h2>
      <p>Proyectos paso a paso con lista de materiales, conexiones y código comentado.</p>
      <ul class="rows rows-compact">
        {"".join(row(a) for a in proj)}
      </ul>
      <a class="home-more" href="/blog/?tema=arduino">Ver las {COUNT["arduino"]} guías de Arduino, ESP32 y Raspberry Pi</a>
    </div>
  </section>

  <section class="home-archive" aria-labelledby="archive-title">
    <div class="home-archive-inner">
      <div>
        <h2 id="archive-title">Las {N} guías, en una sola página</h2>
        <p>Busca por palabra, filtra por tema y ordena por fecha o por nombre.</p>
      </div>
      <a class="home-button" href="/blog/">Ver todos los tutoriales</a>
    </div>
  </section>

  <div class="ad-slot" style="margin:34px auto;max-width:1200px;min-height:280px;text-align:center;">
    <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-7032484018692343" data-ad-slot="7434550690" data-ad-format="auto" data-full-width-responsive="true"></ins>
    <script>(adsbygoogle = window.adsbygoogle || []).push({{}});</script>
  </div>

  </main>
<!-- HOME:END -->'''

ROW_CSS = '''
.rows{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:center;padding:14px 0;border-top:1px solid var(--border);text-decoration:none;color:inherit}
.rows li:first-child .row{border-top:0;padding-top:0}
.row img{width:150px;aspect-ratio:16/9;height:auto;object-fit:cover;border-radius:10px;background:#e9e4d8;display:block}
.row-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.row-topic{font-size:.8rem;font-weight:600;color:var(--accent-2)}
.row-title{font-family:'DM Serif Display',Georgia,serif;font-size:1.14rem;line-height:1.25;color:var(--text-primary)}
.row-meta{font-size:.8rem;color:var(--text-muted)}
.row:hover .row-title,.feature:hover .feature-title{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.row:focus-visible,.feature:focus-visible,.drawer:focus-visible,.home-more:focus-visible,.home-button:focus-visible{outline:2px solid var(--accent-2);outline-offset:4px;border-radius:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
'''

HOME_CSS = '''<style id="home-v2">
.hero-inner{padding:110px 24px 90px}
.hero h1{font-size:clamp(2.2rem,6vw,4.4rem);max-width:760px}
.hero p.sub{max-width:600px}
.home-search{display:flex;gap:6px;max-width:620px;margin-top:32px;background:#fff;border-radius:999px;padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.35)}
.home-search input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:1rem;padding:12px 18px;color:#1e1b15;border-radius:999px}
.home-search input:focus{outline:none}
.home-search:focus-within{box-shadow:0 0 0 3px #e4c07a,0 18px 40px rgba(0,0,0,.35)}
.home-search button{border:0;border-radius:999px;background:#e4c07a;color:#241a06;font:inherit;font-weight:700;font-size:.95rem;padding:0 26px;cursor:pointer}
.home-search button:hover{background:#ecca8a}
.home-examples{margin-top:16px;color:rgba(245,243,238,.72);font-size:.9rem;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
.home-examples a{color:#fff;text-underline-offset:3px;text-decoration-color:rgba(255,255,255,.4)}
.home-examples a:hover{text-decoration-color:#e4c07a}
section.home-cabinet{max-width:none;padding:72px 24px 80px;background-color:#284a3f;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:32px 32px;color:#f3efe4}
.home-wrap{max-width:1200px;margin:0 auto}
.home-head h2,.home-col h2,.home-archive h2{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:clamp(1.7rem,3vw,2.2rem);line-height:1.15;letter-spacing:-.01em}
.home-head p{margin-top:6px;max-width:560px}
.home-cabinet .home-head p{color:rgba(243,239,228,.75)}
.cabinet{margin-top:30px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:14px;background:#1e3830;border-radius:18px;box-shadow:inset 0 2px 0 rgba(255,255,255,.06),inset 0 -3px 0 rgba(0,0,0,.25),0 30px 60px rgba(10,24,19,.35)}
.drawer{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;column-gap:14px;row-gap:4px;align-items:center;padding:16px 16px 28px;border-radius:10px;background:linear-gradient(180deg,#fbf9f3,#ece6d7);color:#1e1b15;text-decoration:none;box-shadow:inset 0 1px 0 #fff,inset 0 -5px 0 rgba(60,45,20,.08),0 3px 0 rgba(0,0,0,.28);transition:transform .16s ease,box-shadow .16s ease}
.drawer:hover{transform:translateY(-4px);box-shadow:inset 0 1px 0 #fff,inset 0 -5px 0 rgba(60,45,20,.08),0 10px 0 rgba(0,0,0,.22),0 18px 26px rgba(0,0,0,.28)}
.drawer-icon{grid-row:1/3;width:46px;height:46px;border-radius:10px;display:grid;place-items:center;background:#f2ead6;color:#a97b23;box-shadow:inset 0 0 0 1px rgba(169,123,35,.25)}
.drawer-label{font-weight:600;font-size:.96rem;line-height:1.25;padding:3px 8px;justify-self:start;background:#fffdf7;border:1px solid #cdb27a;border-radius:4px;box-shadow:inset 0 1px 2px rgba(0,0,0,.06)}
.drawer-count{font-size:.82rem;color:#6b665b;padding-left:9px}
.drawer-pull{position:absolute;left:50%;bottom:10px;width:46px;height:7px;margin-left:-23px;border-radius:4px;background:#bfa772;box-shadow:inset 0 1px 1px rgba(0,0,0,.25)}
section.home-recent{padding:80px 24px 30px}
.home-head-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px 24px;flex-wrap:wrap;margin-bottom:28px}
.home-more{color:var(--accent-2);font-weight:600;font-size:.92rem;text-underline-offset:3px}
.recent-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:40px;align-items:start}
.feature{display:flex;flex-direction:column;gap:8px;text-decoration:none;color:inherit}
.feature img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin-bottom:8px;background:#e9e4d8}
.feature-title{font-family:'DM Serif Display',Georgia,serif;font-size:clamp(1.5rem,2.6vw,2rem);line-height:1.15;color:var(--text-primary)}
.feature-desc{color:var(--text-secondary);max-width:62ch}
section.home-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:56px;padding:60px 24px 70px}
.home-col{display:flex;flex-direction:column}
.home-col>p{color:var(--text-secondary);margin:6px 0 22px;max-width:52ch}
.home-col .home-more{margin-top:18px}
.rows-compact .row{grid-template-columns:112px minmax(0,1fr)}
.rows-compact .row img{width:112px}
.rows-compact .row-title{font-size:1.04rem}
section.home-archive{padding:0 24px 30px}
.home-archive-inner{display:flex;justify-content:space-between;align-items:center;gap:20px 40px;flex-wrap:wrap;padding:34px 38px;border-radius:20px;background:#fff;border:1px solid var(--border)}
.home-archive p{color:var(--text-secondary);margin-top:6px}
.home-button{display:inline-block;background:var(--accent);color:#fff;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:999px}
.home-button:hover{background:#94691b}
@media (max-width:960px){.cabinet{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:860px){.recent-grid,section.home-columns{grid-template-columns:1fr}section.home-columns{gap:48px}}
@media (max-width:640px){
 .hero-inner{padding:72px 16px 56px}
 .hero::after{background:linear-gradient(180deg,rgba(12,15,20,.78) 0%,rgba(12,15,20,.86) 60%,rgba(12,15,20,.94) 100%)}
 .hero p.sub{color:rgba(245,243,238,.9)}
 .home-search{flex-direction:column;border-radius:18px;padding:8px}
 .home-search button{padding:12px;border-radius:12px}
 section.home-cabinet{padding:52px 16px 56px}
 .cabinet{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px;border-radius:14px}
 .drawer{grid-template-columns:1fr;padding:12px 10px 24px;row-gap:6px}
 .drawer-icon{grid-row:auto;width:38px;height:38px}
 .drawer-label{font-size:.82rem;padding:2px 6px;max-width:100%}
 .drawer-count{padding-left:0}
 section.home-recent{padding:56px 16px 20px}
 section.home-columns{padding:44px 16px 50px}
 section.home-archive{padding:0 16px 20px}
 .home-archive-inner{padding:26px 22px}
 .row{grid-template-columns:104px minmax(0,1fr);gap:12px}
 .row img,.rows-compact .row img{width:104px}
 .rows-compact .row{grid-template-columns:104px minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){.drawer{transition:none}.drawer:hover{transform:none}}
''' + ROW_CSS + '</style>\n'

ITEMLIST = json.dumps({"@context": "https://schema.org", "@type": "ItemList", "name": "Últimos artículos del blog",
                       "itemListOrder": "https://schema.org/ItemListOrderDescending", "numberOfItems": 12,
                       "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE}/blog/{a['slug']}", "name": a['title']} for i, a in enumerate(PAST[:12])]},
                      ensure_ascii=False)

idx = open('index.html', encoding='utf-8').read()
if '<!-- HOME:START' in idx:
    i, j = idx.index('<!-- HOME:START'), idx.index('<!-- HOME:END -->') + len('<!-- HOME:END -->')
else:
    i = idx.index('<section class="hero"'); i = idx.rindex('\n', 0, i) + 1
    j = idx.index('</main>') + len('</main>')
idx = idx[:i] + HOME + idx[j:]
idx = re.sub(r'<style id="home-v2">.*?</style>\n', '', idx, flags=re.S).replace('</head>', HOME_CSS + '</head>', 1)
idx = re.sub(r'<script type="application/ld\+json">\s*\{\s*"@context": "https://schema.org",\s*"@type": "ItemList".*?</script>',
             lambda m: f'<script type="application/ld+json">{ITEMLIST}</script>', idx, count=1, flags=re.S)
idx = idx.replace('<a href="#latest">Tutoriales</a>', '<a href="/blog/">Tutoriales</a>')
open('index.html', 'w', encoding='utf-8').write(idx)

# ================================================================ /blog/
ab = open('about.html', encoding='utf-8').read()
css = re.search(r'<style>(.*?)</style>', ab, re.S).group(1)
tracking = ab[ab.index('</style>') + len('</style>'):ab.index('</head>')]
footer = ab[ab.index('<footer'):]

chips = [f'<button type="button" class="chip" data-topic="" aria-pressed="true">Todos <span>{N}</span></button>']
chips += [f'<button type="button" class="chip" data-topic="{k}" aria-pressed="false">{esc(t["name"])} <span>{COUNT[k]}</span></button>' for k, t in TOPIC.items()]

items = []
for a in A:
    hay = norm(' '.join([a['title'], a['full'], a['desc'], TOPIC[a['topic']]['name'], a['slug'].replace('-', ' ')]))
    items.append(f'''    <li data-topic="{a["topic"]}" data-date="{a["date"]}" data-title="{esc(norm(a["title"]))}" data-q="{esc(hay)}"><a class="row" href="/blog/{a["slug"]}">'''
                 f'''<img src="{thumb(a)}" alt="" loading="lazy" width="480" height="270"><span class="row-text">'''
                 f'''<span class="row-topic">{esc(TOPIC[a["topic"]]["name"])}</span><span class="row-title">{esc(a["title"])}</span>'''
                 f'''<span class="row-desc">{esc(a["desc"])}</span><span class="row-meta">{meta(a)}</span></span></a></li>''')

ld = [
    {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Todos los tutoriales", "url": f"{SITE}/blog/", "inLanguage": "es-CL",
     "isPartOf": {"@type": "WebSite", "name": "Blog de Ingeniería Robótica", "url": SITE + "/"},
     "mainEntity": {"@type": "ItemList", "numberOfItems": N, "itemListOrder": "https://schema.org/ItemListOrderDescending",
                    "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE}/blog/{a['slug']}", "name": a['title']} for i, a in enumerate(A)]}},
    {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Blog", "item": SITE + "/blog/"}]},
]
TITLE = f'Todos los tutoriales: {N} guías de electrónica, robótica y hogar | ukrabot.cl'
DESC = f'Las {N} guías técnicas del blog en una sola página: Arduino, ESP32, brazos robóticos, baterías, impresión 3D, domótica y guías de compra para la casa. Busca y filtra por tema.'

ARCH_CSS = '''
.arch{max-width:1200px;margin:auto;padding:0 24px 90px}
.arch-tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
.arch-search{flex:1;min-width:240px;max-width:560px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid rgba(30,25,15,.18);border-radius:999px;padding:0 18px}
.arch-search:focus-within{border-color:var(--accent-2);box-shadow:0 0 0 3px rgba(47,111,176,.15)}
.arch-search svg{flex:none;color:var(--text-muted)}
.arch-search input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:1rem;padding:12px 0;color:var(--text-primary)}
.arch-search input:focus{outline:none}
.arch-sort{font:inherit;font-size:.9rem;padding:11px 14px;border-radius:999px;border:1px solid rgba(30,25,15,.18);background:#fff;color:var(--text-primary)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 20px}
.chip{font:inherit;font-size:.84rem;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--border);background:#fff;color:var(--text-secondary);cursor:pointer}
.chip span{color:var(--text-muted);font-weight:500;margin-left:3px}
.chip:hover{border-color:rgba(169,123,35,.45);color:var(--text-primary)}
.chip[aria-pressed=true]{background:#284a3f;border-color:#284a3f;color:#fff}
.chip[aria-pressed=true] span{color:rgba(255,255,255,.72)}
.chip:focus-visible,.arch-sort:focus-visible,.arch-reset:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
.arch-count{font-size:.9rem;color:var(--text-muted);margin-bottom:6px}
.arch-list{list-style:none;background:#fff;border:1px solid var(--border);border-radius:20px;padding:0 26px;box-shadow:var(--shadow-card);overflow:hidden}
.arch-list .row{margin-top:-1px}
.arch-list .row{grid-template-columns:168px minmax(0,1fr);gap:20px;padding:18px 0}
.arch-list .row img{width:168px}
.arch-list li[hidden]{display:none}
.row-desc{color:var(--text-secondary);font-size:.9rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.arch-empty{padding:40px 26px;text-align:center;background:#fff;border:1px solid var(--border);border-radius:20px;color:var(--text-secondary)}
.arch-reset{margin-top:14px;font:inherit;font-weight:700;font-size:.9rem;padding:10px 20px;border-radius:999px;border:0;background:var(--accent);color:#fff;cursor:pointer}
@media (max-width:640px){
 .arch{padding:0 16px 70px}
 .chips{flex-wrap:nowrap;overflow-x:auto;margin-right:-16px;padding-right:16px;scrollbar-width:none}
 .chip{flex:none}
 .arch-list{padding:0 16px;border-radius:16px}
 .arch-list .row{grid-template-columns:104px minmax(0,1fr);gap:12px;padding:14px 0}
 .arch-list .row img{width:104px}
 .row-desc{display:none}
}
'''

SEARCH_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'

page = f'''<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f4ee">
<title>{esc(TITLE)}</title>
<meta name="description" content="{esc(DESC)}">
<meta name="author" content="Alberto Gallardo">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="{SITE}/blog/">
<link rel="icon" href="/favicon.ico" sizes="any">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(TITLE)}">
<meta property="og:description" content="{esc(DESC)}">
<meta property="og:url" content="{SITE}/blog/">
<meta property="og:image" content="{SITE}/robotic_arm_hero.jpg">
<meta property="og:locale" content="es_CL">
<meta property="og:site_name" content="Blog de Ingeniería Robótica">
<meta name="twitter:card" content="summary_large_image">
{"".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>{css}{ROW_CSS}{ARCH_CSS}</style>
{tracking}</head>
<body>
<a class="skip-link" href="#main">Saltar al contenido</a>

<header class="site-header">
  <div class="nav-inner">
    <a href="/" class="logo" aria-label="Inicio Blog de Ingeniería Robótica">Robótica <span>Ingeniería</span></a>
    <nav class="nav-links" aria-label="Navegación principal">
      <a href="/">Inicio</a>
      <a href="/blog/" aria-current="page">Tutoriales</a>
      <a href="/productos">Productos</a>
      <a href="/about">Quiénes Somos</a>
      <a href="/contact">Contacto</a>
    </nav>
  </div>
</header>

<section class="page-hero">
  <h1>Todos los tutoriales</h1>
  <p class="lede">Las {N} guías del blog en una sola página. Escribe lo que buscas o elige un tema; la lista se filtra al instante.</p>
</section>

<main class="arch" id="main">
  <div class="arch-tools">
    <label class="arch-search">{SEARCH_ICON}<span class="sr-only">Buscar</span>
      <input id="aq" type="search" placeholder="Buscar: ESP32, LiFePO4, refrigerador…" autocomplete="off" enterkeyhint="search">
    </label>
    <label><span class="sr-only">Ordenar</span>
      <select id="asort" class="arch-sort">
        <option value="new">Más recientes primero</option>
        <option value="old">Más antiguas primero</option>
        <option value="az">Por nombre (A–Z)</option>
      </select>
    </label>
  </div>
  <div class="chips" role="group" aria-label="Filtrar por tema">
    {"".join(chips)}
  </div>
  <p class="arch-count" id="acount" aria-live="polite">{N} tutoriales</p>
  <ul class="arch-list rows" id="alist">
{chr(10).join(items)}
  </ul>
  <div class="arch-empty" id="aempty" hidden>
    <p id="aempty-msg">No hay guías que coincidan.</p>
    <button type="button" class="arch-reset" id="areset">Quitar filtros</button>
  </div>
</main>

<script>
(function(){{
  var list=document.getElementById('alist'),items=[].slice.call(list.children),q=document.getElementById('aq'),
      sort=document.getElementById('asort'),chips=[].slice.call(document.querySelectorAll('.chip')),
      count=document.getElementById('acount'),empty=document.getElementById('aempty'),emsg=document.getElementById('aempty-msg'),topic='';
  function norm(s){{return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}}
  function names(){{var c=chips.filter(function(b){{return b.dataset.topic===topic;}})[0];return c?c.firstChild.textContent.trim():'';}}
  function apply(push){{
    var words=norm(q.value).split(/\\s+/).filter(Boolean),n=0;
    items.forEach(function(li){{
      var ok=(!topic||li.dataset.topic===topic)&&words.every(function(w){{return li.dataset.q.indexOf(w)>-1;}});
      li.hidden=!ok; if(ok) n++;
    }});
    chips.forEach(function(b){{b.setAttribute('aria-pressed',b.dataset.topic===topic?'true':'false');}});
    count.textContent=n===1?'1 tutorial':n+' tutoriales';
    empty.hidden=n>0; list.hidden=n===0;
    if(!n) emsg.textContent='No hay guías que coincidan con "'+q.value.trim()+'"'+(topic?' en '+names():'')+'. Prueba con otra palabra o quita el filtro.';
    if(push!==false){{
      var p=new URLSearchParams(); if(topic) p.set('tema',topic); if(q.value.trim()) p.set('q',q.value.trim());
      history.replaceState(null,'',location.pathname+(p.toString()?'?'+p:''));
    }}
  }}
  function order(){{
    var v=sort.value,s=items.slice().sort(function(a,b){{
      if(v==='az') return a.dataset.title.localeCompare(b.dataset.title,'es');
      return v==='old'?a.dataset.date.localeCompare(b.dataset.date):b.dataset.date.localeCompare(a.dataset.date);
    }});
    s.forEach(function(li){{list.appendChild(li);}});
  }}
  chips.forEach(function(b){{b.addEventListener('click',function(){{topic=b.dataset.topic;apply();}});}});
  q.addEventListener('input',function(){{apply();}});
  sort.addEventListener('change',order);
  document.getElementById('areset').addEventListener('click',function(){{q.value='';topic='';apply();q.focus();}});
  var p=new URLSearchParams(location.search);
  if(p.get('q')) q.value=p.get('q');
  if(p.get('tema')&&chips.some(function(b){{return b.dataset.topic===p.get('tema');}})) topic=p.get('tema');
  if(p.get('q')||p.get('tema')) apply(false);
}})();
</script>

{footer}'''
open('blog/index.html', 'w', encoding='utf-8').write(page)
print(f'portada y /blog/ generadas: {N} artículos; temas:', COUNT)
