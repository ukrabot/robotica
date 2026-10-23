# -*- coding: utf-8 -*-
"""Agrega el menú hamburguesa (celular) a páginas que no lo tienen.
Idempotente: no duplica si la página ya tiene id="mnav-btn" o nav-toggle.
Uso: python3 tools/mobile_nav.py archivo.html [...]"""
import re, sys

BUTTON = ('<button type="button" class="mnav-btn" id="mnav-btn" aria-expanded="false" aria-controls="nav-links" '
          'aria-label="Abrir menú"><span></span><span></span><span></span></button>')

CSS = '''<style id="mnav-css">
.mnav-btn{display:none;width:44px;height:44px;flex:none;padding:0;border:1px solid rgba(30,25,15,.14);border-radius:10px;background:#fffdf8;cursor:pointer;flex-direction:column;align-items:center;justify-content:center;gap:5px}
.mnav-btn span{display:block;width:20px;height:2px;border-radius:2px;background:#1e1b15;transition:transform .2s,opacity .2s}
.mnav-btn[aria-expanded=true] span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.mnav-btn[aria-expanded=true] span:nth-child(2){opacity:0}
.mnav-btn[aria-expanded=true] span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
.mnav-btn:focus-visible{outline:2px solid #2f6fb0;outline-offset:2px}
.site-nav.mnav-host{position:relative}
@media (max-width:760px){
 .mnav-btn{display:flex}
 .nav-inner{flex-wrap:nowrap!important}
 .nav-links.mnav{display:none!important;position:absolute;left:0;right:0;top:100%;z-index:300;flex-direction:column;align-items:stretch;gap:0!important;padding:4px 24px 12px;background:#f6f4ee;border-bottom:1px solid rgba(30,25,15,.12);box-shadow:0 14px 28px rgba(30,25,15,.1)}
 .nav-links.mnav.is-open{display:flex!important}
 .nav-links.mnav a{display:block;padding:13px 0;font-size:1rem!important;border-bottom:1px solid rgba(30,25,15,.07)}
 .nav-links.mnav a:last-child{border-bottom:0}
}
@media (prefers-reduced-motion:reduce){.mnav-btn span{transition:none}}
</style>
'''

JS = '''<script id="mnav-js">
(function(){
  var b=document.getElementById('mnav-btn'),n=document.getElementById('nav-links');
  if(!b||!n) return;
  function set(open){n.classList.toggle('is-open',open);b.setAttribute('aria-expanded',open?'true':'false');b.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');}
  b.addEventListener('click',function(){set(!n.classList.contains('is-open'));});
  n.addEventListener('click',function(e){if(e.target.closest('a')) set(false);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&n.classList.contains('is-open')){set(false);b.focus();}});
})();
</script>
'''


def patch(h):
    if 'id="mnav-btn"' in h or 'nav-toggle' in h:
        return h, False
    m = re.search(r'<(div|nav)([^>]*class="[^"]*nav-links[^"]*"[^>]*)>', h)
    attrs = m.group(2)
    attrs = re.sub(r'class="([^"]*)"', lambda c: f'class="{c.group(1)} mnav"', attrs, count=1)
    if 'id=' not in attrs:
        attrs = ' id="nav-links"' + attrs
    else:
        attrs = re.sub(r'id="[^"]*"', 'id="nav-links"', attrs)
    h = h[:m.start()] + BUTTON + f'<{m.group(1)}{attrs}>' + h[m.end():]
    if '<nav class="site-nav"' in h:  # 404: la barra no es sticky, necesita contenedor posicionado
        h = h.replace('<nav class="site-nav"', '<nav class="site-nav mnav-host"', 1)
    if 'id="mnav-css"' not in h:
        h = h.replace('</head>', CSS + '</head>', 1)
    if 'id="mnav-js"' not in h:
        i = h.rindex('</body>')
        h = h[:i] + JS + h[i:]
    return h, True


if __name__ == '__main__':
    for f in sys.argv[1:]:
        h = open(f, encoding='utf-8').read()
        h2, changed = patch(h)
        if changed:
            open(f, 'w', encoding='utf-8').write(h2)
        print(('ok   ' if changed else 'skip ') + f)
