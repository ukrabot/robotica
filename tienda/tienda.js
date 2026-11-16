/* Tienda ukrabot.cl — carrito (en este navegador), ficha, /carrito y /pedido.
   Los precios, el stock y el total final siempre los decide el servidor. */
(function () {
  'use strict';
  var KEY = 'ukr_cart_v1', FORM_KEY = 'ukr_checkout_v1', ORDERS_KEY = 'ukr_orders_v1';
  var catalogPromise = null;

  // ------------------------------------------------------------ utilidades
  var PAY_NAME = { flow: 'Flow', mp: 'Mercado Pago' };
  var PAY_NOTE = {
    flow: 'Webpay, tarjetas de débito y crédito, transferencia y otros medios.',
    mp: 'Tarjetas, saldo de Mercado Pago y otros medios de esa plataforma.'
  };
  function clp(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }

  // ------------------------------------------------------------ carrito
  function read() {
    try {
      var v = JSON.parse(store(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (i) { return i && typeof i.slug === 'string' && Number.isInteger(i.qty) && i.qty > 0; }) : [];
    } catch (e) { return []; }
  }
  function write(items) { store(KEY, JSON.stringify(items)); badge(); document.dispatchEvent(new CustomEvent('ukr:cart')); }
  var Cart = {
    items: read,
    count: function () { return read().reduce(function (s, i) { return s + i.qty; }, 0); },
    qty: function (slug) { var it = read().filter(function (i) { return i.slug === slug; })[0]; return it ? it.qty : 0; },
    set: function (slug, qty) {
      var items = read().filter(function (i) { return i.slug !== slug; });
      if (qty > 0) { var old = read().map(function (i) { return i.slug; }).indexOf(slug); var it = { slug: slug, qty: Math.min(qty, 50) }; if (old < 0) items.push(it); else items.splice(old, 0, it); }
      write(items);
    },
    add: function (slug, qty) { Cart.set(slug, Cart.qty(slug) + qty); },
    clear: function () { write([]); },
  };
  window.UkrCart = Cart;

  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/api/catalog', { headers: { accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('catalog ' + r.status); return r.json(); })
        .then(function (d) { d.bySlug = {}; d.products.forEach(function (p) { d.bySlug[p.slug] = p; }); return d; });
      catalogPromise.catch(function () { catalogPromise = null; });
    }
    return catalogPromise;
  }

  // ------------------------------------------------------------ ícono en el menú
  var badgeEl = null;
  function mountBadge() {
    var bar = document.querySelector('.nav-inner');
    if (!bar || document.querySelector('.ukr-cart-link')) return;
    var a = el('a', { class: 'ukr-cart-link', href: '/carrito' },
      '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.2L21 8H6.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor"/><circle cx="17" cy="19.5" r="1.4" fill="currentColor"/></svg><span class="ukr-cart-count" hidden></span>');
    bar.appendChild(a);
    badgeEl = a;
    badge();
  }
  function badge() {
    if (!badgeEl) return;
    var n = Cart.count(), c = badgeEl.querySelector('.ukr-cart-count');
    c.textContent = n > 99 ? '99+' : String(n);
    c.hidden = n === 0;
    badgeEl.setAttribute('aria-label', n ? 'Carrito: ' + n + (n === 1 ? ' producto' : ' productos') : 'Carrito vacío');
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY) badge(); });

  var toastTimer;
  function toast(html) {
    var t = document.querySelector('.ukr-toast');
    if (!t) { t = el('div', { class: 'ukr-toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
    t.innerHTML = html;
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 4200);
  }

  // ------------------------------------------------------------ ficha de producto
  function mountBuy(box) {
    var slug = box.getAttribute('data-ukr-buy'), qty = 1;
    box.innerHTML =
      '<span class="ukr-qty" role="group" aria-label="Cantidad"><button type="button" data-d="-1" aria-label="Quitar uno">−</button><output aria-live="polite">1</output><button type="button" data-d="1" aria-label="Agregar uno">+</button></span>' +
      '<button type="button" class="ukr-add" disabled>Agregar al carrito</button>' +
      '<p class="ukr-stock">Consultando disponibilidad…</p><p class="ukr-added" hidden></p>';
    var out = box.querySelector('output'), add = box.querySelector('.ukr-add'), stock = box.querySelector('.ukr-stock'), added = box.querySelector('.ukr-added');
    var minus = box.querySelector('[data-d="-1"]'), plus = box.querySelector('[data-d="1"]'), max = 50, digital = false;
    function render() {
      out.textContent = qty;
      minus.disabled = qty <= 1;
      plus.disabled = qty >= max;
    }
    box.addEventListener('click', function (e) {
      var d = e.target.closest('[data-d]');
      if (d) { qty = Math.max(1, Math.min(max, qty + Number(d.getAttribute('data-d')))); render(); }
    });
    add.addEventListener('click', function () {
      var inCart = Cart.qty(slug);
      if (digital) {
        if (inCart) { location.href = '/carrito'; return; }
        Cart.set(slug, 1);
        added.hidden = false;
        added.innerHTML = 'Agregaste el pack a tu carrito. <a href="/carrito">Ver carrito y pagar</a>';
        toast('Pack agregado al carrito <a href="/carrito">Ver carrito</a>');
        add.innerHTML = 'Ya está en tu carrito · Pagar';
        return;
      }
      if (inCart + qty > max) { stock.textContent = 'Ya tienes ' + inCart + ' en el carrito; quedan ' + max + ' disponibles.'; stock.className = 'ukr-stock is-low'; return; }
      Cart.add(slug, qty);
      added.hidden = false;
      added.innerHTML = 'Agregaste ' + qty + (qty === 1 ? ' unidad' : ' unidades') + '. <a href="/carrito">Ver carrito y pagar</a>';
      toast('Producto agregado al carrito <a href="/carrito">Ver carrito</a>');
      qty = 1; render();
    });
    render();
    catalog().then(function (d) {
      var p = d.bySlug[slug];
      if (!p) { stock.textContent = 'Este producto no se puede comprar en línea. Escríbenos por WhatsApp.'; return; }
      var pay = d.methods && d.methods.length ? 'Pago seguro con ' + d.methods.map(function (m) { return PAY_NAME[m]; }).join(' o ') + '.' : '';
      if (p.digital) {
        digital = true; box.classList.add('is-digital');
        box.querySelector('.ukr-qty').style.display = 'none';
        if (!p.available) { add.disabled = true; add.textContent = 'No disponible por ahora'; stock.textContent = 'Estamos preparando la descarga. Escríbenos por WhatsApp y te avisamos.'; stock.className = 'ukr-stock is-out'; return; }
        add.disabled = false;
        add.innerHTML = Cart.qty(slug) ? 'Ya está en tu carrito · Pagar' : 'Comprar y descargar<span class="ukr-add-price"> · ' + clp(p.price) + '</span>';
        stock.textContent = 'Descarga inmediata después del pago. ' + pay;
        return;
      }
      if (!p.available) { add.disabled = true; minus.disabled = plus.disabled = true; add.textContent = 'Agotado'; stock.textContent = 'Sin stock por ahora. Escríbenos por WhatsApp y te avisamos cuando llegue.'; stock.className = 'ukr-stock is-out'; return; }
      max = p.stock === null ? 50 : Math.min(50, p.stock);
      add.disabled = false;
      add.innerHTML = 'Agregar al carrito<span class="ukr-add-price"> · ' + clp(p.price) + '</span>';
      if (p.stock !== null && p.stock <= 5) { stock.textContent = p.stock === 1 ? 'Queda 1 unidad.' : 'Quedan ' + p.stock + ' unidades.'; stock.className = 'ukr-stock is-low'; }
      else { stock.textContent = (pay ? pay.slice(0, -1) + ' · ' : '') + 'Envío a todo Chile.'; }
      render();
    }).catch(function () { stock.textContent = 'No pudimos cargar la disponibilidad. Recarga la página o escríbenos por WhatsApp.'; });
  }

  // ------------------------------------------------------------ /productos: etiqueta de agotado
  function markCatalog() {
    var prices = document.querySelectorAll('[data-price-slug]');
    if (!prices.length) return;
    catalog().then(function (d) {
      prices.forEach(function (pr) {
        var p = d.bySlug[pr.getAttribute('data-price-slug')];
        if (p && !p.available && !pr.querySelector('.ukr-out-badge')) pr.appendChild(el('span', { class: 'ukr-out-badge', text: 'Agotado' }));
      });
    }).catch(function () {});
  }

  // ------------------------------------------------------------ /carrito
  function mountCheckout(root) {
    var form, alertEl, data, mode = '';
    var FIELDS = ['nombre', 'email', 'telefono', 'region', 'comuna', 'direccion', 'notas'];
    function savedForm() { try { return JSON.parse(store(FORM_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function saveForm() {
      if (!form) return;
      var o = savedForm(); FIELDS.forEach(function (k) { if (form.elements[k]) o[k] = form.elements[k].value; });
      o.metodo = method();
      store(FORM_KEY, JSON.stringify(o));
    }
    // 'digital' cuando todo el carrito es descargable: no se pide dirección ni se cobra envío
    function digitalOnly(items) { return items.length > 0 && items.every(function (i) { return i.p.digital; }); }
    function methods() { return data.methods || []; }
    function method() {
      var r = root.querySelector('input[name="ukr-metodo"]:checked');
      return r ? r.value : (methods().length === 1 ? methods()[0] : '');
    }
    function lines() {
      var errs = [];
      var items = Cart.items().map(function (i) {
        var p = data.bySlug[i.slug];
        if (!p) { errs.push(i.slug); return null; }
        return { slug: i.slug, qty: p.digital ? 1 : i.qty, p: p };
      }).filter(Boolean);
      if (errs.length) write(Cart.items().filter(function (i) { return errs.indexOf(i.slug) < 0; }));
      else if (items.some(function (i) { return i.p.digital && Cart.qty(i.slug) > 1; })) {
        store(KEY, JSON.stringify(Cart.items().map(function (i) { return data.bySlug[i.slug] && data.bySlug[i.slug].digital ? { slug: i.slug, qty: 1 } : i; })));
        badge();
      }
      return items;
    }
    function totals(items) {
      var sub = items.reduce(function (s, i) { return s + i.p.price * i.qty; }, 0);
      if (digitalOnly(items)) return { sub: sub, ship: 0, total: sub, digital: true };
      var region = form && form.elements.region ? form.elements.region.value : '';
      var ship = region ? (region === 'Metropolitana de Santiago' ? data.shipping.rm : data.shipping.regiones) : null;
      return { sub: sub, ship: ship, total: ship === null ? null : sub + ship };
    }
    function render() {
      var items = lines();
      if (!items.length) {
        var recent = []; try { recent = JSON.parse(store(ORDERS_KEY) || '[]'); } catch (e) {}
        root.innerHTML = '<div class="ukr-box ukr-empty"><h2>Tu carrito está vacío</h2><p>Revisa el catálogo y agrega lo que necesitas para tu proyecto.</p><a class="ukr-btn" href="/productos">Ver productos</a>' +
          (recent.length ? '<div class="ukr-recent"><h3>Tus compras recientes</h3><ul>' + recent.map(function (r) {
            return '<li><a href="/pedido?o=' + encodeURIComponent(r.o) + '&k=' + encodeURIComponent(r.k) + '">Pedido ' + esc(r.o) + '</a> <span class="ukr-item-meta">' + new Date(r.t).toLocaleDateString('es-CL') + '</span></li>';
          }).join('') + '</ul></div>' : '') + '</div>';
        form = null; return;
      }
      var problems = items.filter(function (i) { return !i.p.available || (i.p.stock !== null && i.qty > i.p.stock); });
      var m0 = (digitalOnly(items) ? 'digital' : 'fisico') + (items.some(function (i) { return i.p.digital; }) ? '+d' : '');
      if (form && m0 !== mode) { saveForm(); form = null; }
      if (!form) { mode = m0; build(); }
      var list = root.querySelector('.ukr-items');
      list.innerHTML = items.map(function (i) {
        var warn = !i.p.available ? (i.p.digital ? 'No disponible por ahora: quítalo para continuar.' : 'Agotado: quítalo para continuar.') : (i.p.stock !== null && i.qty > i.p.stock ? 'Solo quedan ' + i.p.stock + '. Ajusta la cantidad.' : '');
        var max = i.p.stock === null ? 50 : Math.min(50, i.p.stock);
        var qtyCtl = i.p.digital ? '<span class="ukr-item-meta">Descarga digital</span>' :
          '<span class="ukr-qty" role="group" aria-label="Cantidad de ' + esc(i.p.short) + '"><button type="button" data-d="-1" aria-label="Quitar uno"' + (i.qty <= 1 ? ' disabled' : '') + '>−</button><output>' + i.qty + '</output><button type="button" data-d="1" aria-label="Agregar uno"' + (i.qty >= max ? ' disabled' : '') + '>+</button></span>';
        return '<li class="ukr-item" data-slug="' + esc(i.slug) + '"><img src="' + esc(i.p.img) + '" alt="" width="72" height="72" loading="lazy">' +
          '<div><a class="ukr-item-name" href="' + esc(i.p.url) + '">' + esc(i.p.short) + '</a><div class="ukr-item-meta">' + (i.p.digital ? 'Descarga inmediata · ' + clp(i.p.price) : clp(i.p.price) + ' c/u') + '</div></div>' +
          '<div class="ukr-item-side">' + qtyCtl +
          '<span class="ukr-line">' + clp(i.p.price * i.qty) + '</span><button type="button" class="ukr-remove">Quitar</button></div>' +
          (warn ? '<p class="ukr-item-warn">' + warn + '</p>' : '') + '</li>';
      }).join('');
      var t = totals(items);
      root.querySelector('[data-sum="sub"]').textContent = clp(t.sub);
      root.querySelector('[data-sum="ship"]').textContent = t.digital ? 'No aplica' : t.ship === null ? 'Elige tu región' : (t.ship === 0 ? 'Gratis' : clp(t.ship));
      root.querySelector('[data-sum="total"]').textContent = t.total === null ? '—' : clp(t.total);
      var pay = root.querySelector('.ukr-pay');
      var m = method();
      pay.disabled = problems.length > 0 || !methods().length;
      pay.textContent = !methods().length ? 'Pago en línea no disponible' : 'Pagar ' + (t.total === null ? '' : clp(t.total) + ' ') + (m ? 'con ' + PAY_NAME[m] : '');
      root.querySelector('[data-pay-note]').textContent = m ? 'Te llevaremos a ' + PAY_NAME[m] + ' para completar el pago. ' + PAY_NAME[m] + ' te envía el comprobante a tu correo.' : '';
    }
    function build() {
      var f = savedForm(), dig = mode.indexOf('digital') === 0, hasDig = mode.indexOf('+d') > 0;
      var regions = data.regions.map(function (r) { return '<option' + (f.region === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('');
      root.innerHTML =
        '<div class="ukr-grid"><div>' +
        '<section class="ukr-box" aria-labelledby="ukr-items-t"><h2 id="ukr-items-t">Productos</h2><ul class="ukr-items"></ul></section>' +
        '<section class="ukr-box" aria-labelledby="ukr-ship-t"><h2 id="ukr-ship-t">' + (dig ? 'Tus datos' : 'Datos de despacho') + '</h2>' +
        (dig ? '<p class="ukr-note" style="margin:-6px 0 14px">Es una descarga: no necesitamos tu dirección. Al pagar verás el botón para descargar.</p>' : '') +
        '<form class="ukr-form" novalidate>' +
        field('nombre', 'Nombre y apellido', '<input id="f-nombre" name="nombre" autocomplete="name" maxlength="80" required>') +
        field('email', 'Correo', '<input id="f-email" name="email" type="email" autocomplete="email" maxlength="120" required>') +
        field('telefono', dig ? 'Teléfono (opcional)' : 'Teléfono', '<input id="f-telefono" name="telefono" type="tel" autocomplete="tel" maxlength="20" placeholder="+56 9 1234 5678"' + (dig ? '' : ' required') + '>') +
        (dig ? '' :
        field('region', 'Región', '<select id="f-region" name="region" autocomplete="address-level1" required><option value="">Elige tu región</option>' + regions + '</select>') +
        field('comuna', 'Comuna', '<input id="f-comuna" name="comuna" autocomplete="address-level2" maxlength="60" required>') +
        field('direccion', 'Dirección', '<input id="f-direccion" name="direccion" autocomplete="street-address" maxlength="160" placeholder="Calle, número, depto." required>', true) +
        field('notas', 'Notas para el despacho (opcional)', '<textarea id="f-notas" name="notas" maxlength="300"></textarea>', true)) +
        '</form></section></div>' +
        '<aside class="ukr-box ukr-sum" aria-labelledby="ukr-sum-t"><h2 id="ukr-sum-t">Resumen</h2>' +
        '<dl><dt>Productos</dt><dd data-sum="sub"></dd><dt>Envío</dt><dd data-sum="ship"></dd><div class="ukr-total"><dt>Total</dt><dd data-sum="total"></dd></div></dl>' +
        '<p class="ukr-alert" role="alert" hidden></p>' +
        payBlock(f.metodo) +
        '<label class="ukr-check"><input type="checkbox" id="f-acepta"> <span>Acepto las <a href="/terms#compras" target="_blank" rel="noopener">condiciones de compra</a>' +
        (hasDig ? '. Entiendo que los productos digitales se entregan como descarga inmediata y no tienen derecho a retracto.' : ', incluido el derecho a retracto.') + '</span></label>' +
        '<button type="button" class="ukr-pay">Pagar</button>' +
        '<p class="ukr-note" data-pay-note></p>' +
        (dig ? '' : '<p class="ukr-note">Envío a la Región Metropolitana: ' + clp(data.shipping.rm) + '. Resto de Chile: ' + clp(data.shipping.regiones) + '.</p>') + '</aside></div>';
      form = root.querySelector('form'); alertEl = root.querySelector('.ukr-alert');
      ['nombre', 'email', 'telefono', 'comuna', 'direccion', 'notas'].forEach(function (k) { if (f[k] && form.elements[k]) form.elements[k].value = f[k]; });
      form.addEventListener('input', function (e) { saveForm(); clearErr(e.target.name); });
      if (form.elements.region) form.elements.region.addEventListener('change', render);
      root.querySelectorAll('input[name="ukr-metodo"]').forEach(function (r) { r.addEventListener('change', function () { saveForm(); showAlert(''); render(); }); });
      root.querySelector('.ukr-items').addEventListener('click', function (e) {
        var li = e.target.closest('.ukr-item'); if (!li) return;
        var slug = li.getAttribute('data-slug');
        if (e.target.closest('.ukr-remove')) { Cart.set(slug, 0); return; }
        var d = e.target.closest('[data-d]');
        if (d) Cart.set(slug, Math.max(1, Cart.qty(slug) + Number(d.getAttribute('data-d'))));
      });
      root.querySelector('.ukr-pay').addEventListener('click', pay);
    }
    function payBlock(saved) {
      var ms = methods();
      if (!ms.length) return '<p class="ukr-alert">El pago en línea no está disponible en este momento. Escríbenos por WhatsApp para comprar.</p>';
      var pick = ms.indexOf(saved) >= 0 ? saved : (ms.length === 1 ? ms[0] : '');
      return '<fieldset class="ukr-methods"><legend>Medio de pago</legend>' + ms.map(function (m) {
        return '<label class="ukr-method"><input type="radio" name="ukr-metodo" value="' + m + '"' + (m === pick ? ' checked' : '') + '>' +
          '<span><strong>' + PAY_NAME[m] + '</strong><small>' + PAY_NOTE[m] + '</small></span></label>';
      }).join('') + '</fieldset>';
    }
    function field(name, label, input, wide) {
      return '<div class="ukr-field' + (wide ? ' is-wide' : '') + '" data-field="' + name + '"><label for="f-' + name + '">' + label + '</label>' + input + '<p class="ukr-err" hidden></p></div>';
    }
    function setErr(name, msg) {
      var f = root.querySelector('[data-field="' + name + '"]'); if (!f) return;
      f.classList.add('has-error'); var p = f.querySelector('.ukr-err'); p.textContent = msg; p.hidden = false;
      f.querySelector('input,select,textarea').setAttribute('aria-invalid', 'true');
    }
    function clearErr(name) {
      var f = root.querySelector('[data-field="' + name + '"]'); if (!f) return;
      f.classList.remove('has-error'); f.querySelector('.ukr-err').hidden = true; f.querySelector('input,select,textarea').removeAttribute('aria-invalid');
    }
    function showAlert(msg) { alertEl.textContent = msg; alertEl.hidden = !msg; }
    function pay() {
      showAlert('');
      var v = {}; FIELDS.forEach(function (k) { v[k] = form.elements[k] ? form.elements[k].value.trim() : ''; });
      var errs = {}, dig = mode.indexOf('digital') === 0;
      if (v.nombre.length < 3) errs.nombre = 'Escribe tu nombre y apellido.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errs.email = 'Revisa el correo: ahí te llega el comprobante del pago.';
      if (dig ? v.telefono && v.telefono.replace(/\D/g, '').length < 8 : v.telefono.replace(/\D/g, '').length < 8) errs.telefono = dig ? 'Revisa el teléfono o déjalo en blanco.' : 'Escribe un teléfono de al menos 8 dígitos.';
      if (!dig) {
        if (!v.region) errs.region = 'Elige tu región.';
        if (v.comuna.length < 2) errs.comuna = 'Escribe tu comuna.';
        if (v.direccion.length < 5) errs.direccion = 'Escribe calle, número y depto. si corresponde.';
      }
      Object.keys(errs).forEach(function (k) { setErr(k, errs[k]); });
      if (Object.keys(errs).length) { var first = root.querySelector('.has-error input, .has-error select'); if (first) first.focus(); return; }
      var m = method();
      if (!m) { showAlert('Elige un medio de pago.'); var fs = root.querySelector('.ukr-methods input'); if (fs) fs.focus(); return; }
      if (!root.querySelector('#f-acepta').checked) { showAlert('Para continuar, acepta las condiciones de compra.'); return; }
      var t = totals(lines()), items = Cart.items();
      var btn = root.querySelector('.ukr-pay'); btn.disabled = true; btn.textContent = 'Conectando con ' + PAY_NAME[m] + '…';
      fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items, customer: v, acepta: true, expected_total: t.total, method: m }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (r) {
          if (r.ok && r.d.url) { location.href = r.d.url; return; }
          if (r.d.fields) Object.keys(r.d.fields).forEach(function (k) { setErr(k, r.d.fields[k]); });
          showAlert(r.d.error || 'No pudimos iniciar el pago. Intenta de nuevo.');
          if (r.status === 409 || r.status === 400 || r.status === 503) { catalogPromise = null; return catalog().then(function (d) { data = d; form = null; render(); showAlert(r.d.error || ''); }); }
          render();
        })
        .catch(function () { showAlert('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.'); render(); });
    }
    catalog().then(function (d) { data = d; render(); document.addEventListener('ukr:cart', render); })
      .catch(function () { root.innerHTML = '<div class="ukr-box ukr-empty"><h2>No pudimos cargar el carrito</h2><p>Recarga la página. Si el problema sigue, escríbenos por WhatsApp.</p><a class="ukr-btn" href="https://wa.me/56993514970">Escribir por WhatsApp</a></div>'; });
  }

  // ------------------------------------------------------------ /pedido
  function mountOrder(root) {
    var q = new URLSearchParams(location.search), code = q.get('o'), key = q.get('k'), tries = 0;
    var STATES = {
      pagado: ['is-ok', '✓', 'Pago recibido', 'Gracias por tu compra. {P} te envió el comprobante por correo y nosotros te contactaremos para coordinar el despacho.'],
      preparando: ['is-ok', '✓', 'Estamos preparando tu pedido', 'Tu pago está confirmado y el pedido se está preparando para el envío.'],
      enviado: ['is-ok', '✓', 'Tu pedido va en camino', 'Ya lo entregamos a la empresa de transporte.'],
      entregado: ['is-ok', '✓', 'Pedido entregado', 'Gracias por comprar en ukrabot.cl.'],
      revisar: ['is-wait', '…', 'Estamos verificando tu pago', 'Recibimos el aviso de {P} y lo estamos revisando. Te contactaremos por correo.'],
      pendiente_pago: ['is-wait', '…', 'Esperando la confirmación de {P}', 'Esto suele tardar unos segundos. Si pagaste con un medio que se acredita más tarde, puede demorar más: este enlace mostrará el estado actualizado.'],
      rechazado: ['is-bad', '!', 'El pago no se completó', '{P} rechazó el pago y no se hizo ningún cargo. Tu carrito sigue guardado para que intentes de nuevo.'],
      anulado: ['is-bad', '!', 'El pago fue anulado', 'No se hizo ningún cargo. Tu carrito sigue guardado para que intentes de nuevo.'],
      error_flow: ['is-bad', '!', 'No pudimos conectar con {P}', 'No se hizo ningún cargo. Intenta de nuevo en unos minutos.'],
      cancelado: ['is-bad', '!', 'Pedido cancelado', 'Si tienes dudas sobre la devolución, escríbenos.'],
    };
    function show(o) {
      var P = PAY_NAME[o.provider] || 'Flow';
      var st = STATES[o.status] || STATES.pendiente_pago, paid = ['pagado', 'preparando', 'enviado', 'entregado', 'revisar'].indexOf(o.status) >= 0;
      var dl = o.downloads && o.downloads.length;
      if (o.zone === 'digital' && dl) st = ['is-ok', '✓', '¡Listo! Ya puedes descargar', 'Gracias por tu compra. {P} te envió el comprobante por correo. Descarga tus archivos aquí abajo.'];
      else if (o.has_digital && o.status === 'revisar') st = ['is-wait', '…', 'Estamos verificando tu pago', 'Recibimos el aviso de {P} y lo estamos revisando. Habilitaremos tu descarga apenas se confirme y te avisaremos por correo.'];
      var s = st.map(function (x) { return x.replace(/\{P\}/g, P); });
      if (paid) Cart.clear();
      remember(o.code);
      var dlBox = dl ? '<section class="ukr-box ukr-dl" aria-labelledby="ukr-dl-t"><h2 id="ukr-dl-t">Tus descargas</h2><ul>' +
        o.downloads.map(function (f) { return '<li><a class="ukr-btn" href="' + esc(f.url) + '" download>Descargar ' + esc(f.name) + '</a><span class="ukr-item-meta">' + esc(f.product) + ' · ' + size(f.size) + '</span></li>'; }).join('') +
        '</ul><p class="ukr-note"><strong>Guarda este enlace</strong> (agrégalo a favoritos): te permite volver a descargar tus archivos. Si lo pierdes, escríbenos con tu número de pedido. <button type="button" class="ukr-remove" data-copy-link>Copiar enlace</button></p></section>' : '';
      root.innerHTML = '<div class="ukr-status"><div class="ukr-status-icon ' + s[0] + '" aria-hidden="true">' + s[1] + '</div><div><h1>' + s[2] + '</h1><p>' + s[3] + '</p></div></div>' + dlBox +
        '<section class="ukr-box"><h2>Pedido ' + esc(o.code) + '</h2><p class="ukr-order-meta">Comprobante enviado a ' + esc(o.email) + '</p><ul class="ukr-items">' +
        o.items.map(function (i) { return '<li class="ukr-item" style="grid-template-columns:minmax(0,1fr) auto"><div><span class="ukr-item-name">' + esc(i.name) + '</span><div class="ukr-item-meta">Cantidad: ' + i.qty + '</div></div><span class="ukr-line">' + clp(i.line) + '</span></li>'; }).join('') +
        '</ul><div class="ukr-sum" style="position:static;margin-top:14px"><dl><dt>Productos</dt><dd>' + clp(o.subtotal) + '</dd><dt>Envío (' + (o.zone === 'digital' ? 'no aplica' : o.zone === 'rm' ? 'Región Metropolitana' : 'regiones') + ')</dt><dd>' + clp(o.shipping) + '</dd><div class="ukr-total"><dt>Total</dt><dd>' + clp(o.total) + '</dd></div></dl></div>' +
        (o.tracking ? '<p class="ukr-note">Seguimiento: <strong>' + esc((o.courier ? o.courier + ' · ' : '') + o.tracking) + '</strong></p>' : '') +
        '</section><div class="ukr-actions">' + (paid ? '<a class="ukr-btn" href="/productos">Seguir comprando</a>' : '<a class="ukr-btn" href="/carrito">Volver al carrito</a>') +
        '<a class="ukr-btn is-ghost" href="https://wa.me/56993514970?text=' + encodeURIComponent('Hola, tengo una consulta sobre mi pedido ' + o.code) + '">Escribir por WhatsApp</a></div>';
      var cp = root.querySelector('[data-copy-link]');
      if (cp) cp.addEventListener('click', function () {
        var url = location.href;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { cp.textContent = 'Enlace copiado'; }, function () { prompt('Copia este enlace:', url); });
      });
      if (o.status === 'pendiente_pago' && tries < 30) setTimeout(load, 4000);
    }
    function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function remember(c) {
      try {
        var list = JSON.parse(store(ORDERS_KEY) || '[]').filter(function (x) { return x && x.o !== c; });
        list.unshift({ o: c, k: key, t: Date.now() });
        store(ORDERS_KEY, JSON.stringify(list.slice(0, 8)));
      } catch (e) {}
    }
    function notFound() {
      root.innerHTML = '<div class="ukr-box ukr-empty"><h2>No encontramos este pedido</h2><p>Revisa que el enlace esté completo. Si ya pagaste, escríbenos con el número de tu pedido.</p><a class="ukr-btn" href="https://wa.me/56993514970">Escribir por WhatsApp</a></div>';
    }
    function load() {
      tries++;
      fetch('/api/order?o=' + encodeURIComponent(code) + '&k=' + encodeURIComponent(key)).then(function (r) { if (!r.ok) throw r; return r.json(); }).then(show).catch(notFound);
    }
    if (!code || !key) notFound(); else load();
  }

  // ------------------------------------------------------------ arranque
  function start() {
    mountBadge();
    document.querySelectorAll('[data-ukr-buy]').forEach(mountBuy);
    markCatalog();
    var c = document.getElementById('ukr-checkout'); if (c) mountCheckout(c);
    var o = document.getElementById('ukr-order'); if (o) mountOrder(o);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
