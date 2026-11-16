// Worker de ukrabot.cl: sirve el sitio estático y agrega la tienda.
//   /api/catalog            precios, stock y tarifas vigentes (público)
//   /api/checkout           crea el pedido y la orden de pago (Flow o Mercado Pago)
//   /api/flow/confirm       aviso servidor-a-servidor de Flow (urlConfirmation)
//   /api/flow/return        vuelta del cliente desde Flow (urlReturn)
//   /api/mp/notify          notificación (webhook) de Mercado Pago
//   /api/mp/return          vuelta del cliente desde Mercado Pago (back_urls)
//   /api/order              estado de un pedido (requiere su clave de acceso)
//   /admin, /api/admin/*    panel de administración (contraseña)
//   /producto/*, /productos se sirven con el precio y stock vigentes
//
// Secretos (Cloudflare > Worker > Settings > Variables and Secrets):
//   FLOW_API_KEY, FLOW_SECRET_KEY, ADMIN_PASSWORD
//   MP_ACCESS_TOKEN (Mercado Pago) y, opcional, MP_WEBHOOK_SECRET
import { Store, FULFILL } from './store.js';
import CATALOG from './catalog.json';
import ADMIN_HTML from './admin.html';

export { Store };

const BASE = Object.fromEntries(CATALOG.map(p => [p.slug, p]));
const REGIONS = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 'Valparaíso', 'Metropolitana de Santiago',
  "Libertador General Bernardo O'Higgins", 'Maule', 'Ñuble', 'Biobío', 'La Araucanía', 'Los Ríos', 'Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo', 'Magallanes y de la Antártica Chilena'];
const SESSION_HOURS = 12;

const store = env => env.STORE.get(env.STORE.idFromName('tienda'));

// ---------------------------------------------------------------- utilidades
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const fail = (msg, status = 400) => json({ error: msg }, status);
const fmtCLP = n => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}
const clientIP = req => req.headers.get('cf-connecting-ip') || 'local';

function merged(slug, overrides) {
  const b = BASE[slug], o = overrides[slug] || {};
  const price = Number.isInteger(o.price) ? o.price : b.price;
  const stock = o.stock === undefined ? null : o.stock;
  const active = o.active === undefined ? true : !!o.active;
  return { ...b, base_price: b.price, price, stock, active, available: active && (stock === null || stock > 0) };
}

// ---------------------------------------------------------------- Flow
function flowConf(env) {
  if (!env.FLOW_API_KEY || !env.FLOW_SECRET_KEY) throw new Error('Faltan FLOW_API_KEY o FLOW_SECRET_KEY en Cloudflare');
  return { url: (env.FLOW_API_URL || 'https://www.flow.cl/api').replace(/\/$/, ''), key: env.FLOW_API_KEY, secret: env.FLOW_SECRET_KEY };
}
async function flowSign(params, secret) {
  const toSign = Object.keys(params).sort().map(k => k + params[k]).join('');
  return hmacHex(secret, toSign);
}
async function flowCall(env, method, path, params) {
  const c = flowConf(env);
  const p = { apiKey: c.key, ...params };
  p.s = await flowSign(p, c.secret);
  const body = new URLSearchParams(p).toString();
  const res = method === 'GET'
    ? await fetch(`${c.url}${path}?${body}`)
    : await fetch(`${c.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`Flow ${path} ${res.status}: ${data.message || data.code || 'error'}`);
  return data;
}
async function syncFromFlow(env, token) {
  const st = await flowCall(env, 'GET', '/payment/getStatus', { token });
  return store(env).applyFlowStatus(token, st);
}

// ---------------------------------------------------------------- Mercado Pago
const MP_NAME = { flow: 'Flow', mp: 'Mercado Pago' };
function mpConf(env) {
  if (!env.MP_ACCESS_TOKEN) throw new Error('Falta MP_ACCESS_TOKEN en Cloudflare');
  return { url: (env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/$/, ''), token: env.MP_ACCESS_TOKEN.trim() };
}
async function mpCall(env, method, path, body, extraHeaders = {}) {
  const c = mpConf(env);
  const res = await fetch(c.url + path, {
    method,
    headers: { authorization: `Bearer ${c.token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) { const e = new Error(`Mercado Pago ${path.split('?')[0]} ${res.status}: ${data.message || data.error || 'error'}`); e.status = res.status; throw e; }
  return data;
}
/** Consulta un pago por id y lo aplica a su pedido (si es de esta tienda). */
async function syncMpPayment(env, id) {
  const pay = await mpCall(env, 'GET', `/v1/payments/${encodeURIComponent(id)}`);
  if (!/^UKR-\d+$/.test(String(pay.external_reference || ''))) return { pay, order: null };
  return { pay, order: await store(env).applyMpPayment(pay) };
}
/** Busca todos los pagos de un pedido y los aplica en orden cronológico. */
async function syncMpOrder(env, code) {
  const r = await mpCall(env, 'GET', `/v1/payments/search?external_reference=${encodeURIComponent(code)}&sort=date_created&criteria=asc&limit=50`);
  let order = await store(env).orderByCode(code);
  for (const pay of r.results || []) {
    if (pay.external_reference === code) order = (await store(env).applyMpPayment(pay)) || order;
  }
  return order;
}
/** Valida la firma x-signature de una notificación (si se configuró la clave secreta). */
async function mpSignatureOk(req, env, dataId) {
  const secret = env.MP_WEBHOOK_SECRET, header = req.headers.get('x-signature');
  if (!secret || !header) return true; // sin clave: igual se consulta el pago con el Access Token
  const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=').map(x => x.trim())));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = '';
  if (id) manifest += `id:${id};`;
  const rid = req.headers.get('x-request-id');
  if (rid) manifest += `request-id:${rid};`;
  manifest += `ts:${parts.ts};`;
  return safeEqual(await hmacHex(secret, manifest), parts.v1);
}

/** Medios de pago activos: con credenciales cargadas y habilitados en el panel. */
function payMethods(env, settings) {
  const m = [];
  if (env.FLOW_API_KEY && env.FLOW_SECRET_KEY && settings.pay_flow !== 0) m.push('flow');
  if (env.MP_ACCESS_TOKEN && settings.pay_mp !== 0) m.push('mp');
  return m;
}

// ---------------------------------------------------------------- sesión admin
async function sessionKey(env) { return hmacHex(env.ADMIN_PASSWORD, 'ukrabot-admin-session-v1'); }
async function makeSession(env) {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return payload + '.' + await hmacHex(await sessionKey(env), payload);
}
async function isAdmin(req, env) {
  if (!adminReady(env)) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)ukr_admin=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  if (!(await safeEqual(sig, await hmacHex(await sessionKey(env), payload)))) return false;
  try { return JSON.parse(unb64u(payload)).exp > Date.now(); } catch { return false; }
}
const adminReady = env => typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= 12;
const cookie = (v, maxAge) => `ukr_admin=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
function sameOrigin(req) {
  const o = req.headers.get('origin');
  return !o || o === new URL(req.url).origin;
}

// ---------------------------------------------------------------- validación del checkout
function validCustomer(c) {
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const out = {
    nombre: s(c.nombre), email: s(c.email).toLowerCase(), telefono: s(c.telefono),
    region: s(c.region), comuna: s(c.comuna), direccion: s(c.direccion), notas: s(c.notas),
  };
  const errors = {};
  if (out.nombre.length < 3 || out.nombre.length > 80) errors.nombre = 'Escribe tu nombre y apellido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email) || out.email.length > 120) errors.email = 'Revisa el correo: ahí te llega el comprobante del pago.';
  if (out.telefono.replace(/\D/g, '').length < 8 || out.telefono.length > 20) errors.telefono = 'Escribe un teléfono de al menos 8 dígitos.';
  if (!REGIONS.includes(out.region)) errors.region = 'Elige tu región.';
  if (out.comuna.length < 2 || out.comuna.length > 60) errors.comuna = 'Escribe tu comuna.';
  if (out.direccion.length < 5 || out.direccion.length > 160) errors.direccion = 'Escribe calle, número y depto. si corresponde.';
  if (out.notas.length > 300) errors.notas = 'Máximo 300 caracteres.';
  return { customer: out, errors };
}

// ---------------------------------------------------------------- handlers públicos
async function catalog(env) {
  const { overrides, settings } = await store(env).storefront();
  const methods = payMethods(env, settings);
  return json({
    products: CATALOG.map(p => {
      const m = merged(p.slug, overrides);
      return { slug: m.slug, name: m.name, short: m.short, price: m.price, img: m.img, url: m.url, stock: m.stock, available: m.available };
    }),
    shipping: { rm: settings.ship_rm, regiones: settings.ship_regiones },
    regions: REGIONS,
    methods,
  });
}

async function checkout(req, env) {
  if (!sameOrigin(req)) return fail('Origen no permitido', 403);
  let body; try { body = await req.json(); } catch { return fail('Solicitud no válida'); }
  const st = store(env);
  const bucket = 'checkout:' + clientIP(req);
  if (await st.limited(bucket, 10, 600, false)) return fail('Demasiados pedidos seguidos. Espera unos minutos y vuelve a intentar.', 429);
  if (body.acepta !== true) return fail('Debes aceptar las condiciones de compra.');
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length || raw.length > 30) return fail('El carrito está vacío.');
  const { overrides, settings } = await st.storefront();
  const methods = payMethods(env, settings);
  if (!methods.length) return fail('Los pagos en línea no están disponibles en este momento. Escríbenos por WhatsApp para comprar.', 503);
  const method = body.method === undefined && methods.length === 1 ? methods[0] : String(body.method || '');
  if (!methods.includes(method)) return fail('Elige un medio de pago.');
  const items = [], qty = {};
  for (const it of raw) {
    const slug = String(it.slug || ''), q = Number(it.qty);
    if (!BASE[slug]) return fail('Uno de los productos ya no existe. Actualiza el carrito.');
    if (!Number.isInteger(q) || q < 1 || q > 50) return fail('Cantidad no válida.');
    qty[slug] = (qty[slug] || 0) + q;
  }
  for (const [slug, q] of Object.entries(qty)) {
    const m = merged(slug, overrides);
    if (!m.active) return json({ error: `${m.short} ya no está disponible.`, slug }, 409);
    if (m.stock !== null && q > m.stock) return json({ error: m.stock ? `Solo quedan ${m.stock} unidades de ${m.short}.` : `${m.short} está agotado.`, slug, stock: m.stock }, 409);
    items.push({ slug, name: m.short, qty: q, price: m.price, line: m.price * q });
  }
  const { customer, errors } = validCustomer(body.customer || {});
  if (Object.keys(errors).length) return json({ error: 'Revisa los datos marcados.', fields: errors }, 422);
  const zone = customer.region === 'Metropolitana de Santiago' ? 'rm' : 'regiones';
  const subtotal = items.reduce((s, i) => s + i.line, 0);
  const shipping = zone === 'rm' ? settings.ship_rm : settings.ship_regiones;
  const total = subtotal + shipping;
  if (Number.isInteger(body.expected_total) && body.expected_total !== total) {
    return json({ error: 'Los precios cambiaron mientras comprabas. Revisa el total actualizado.', total }, 409);
  }

  // solo cuentan para el límite los pedidos que de verdad se envían al medio de pago
  if (await st.limited(bucket, 10, 600, true)) return fail('Demasiados pedidos seguidos. Espera unos minutos y vuelve a intentar.', 429);
  const order = await st.createOrder({ items, subtotal, shipping, total, zone, customer, provider: method });
  const site = (env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
  try {
    if (method === 'mp') return json({ url: await mpPreference(env, site, order, { items, shipping, zone, customer }), code: order.code });
    const r = await flowCall(env, 'POST', '/payment/create', {
      commerceOrder: order.code,
      subject: `Pedido ${order.code} en ukrabot.cl`,
      currency: 'CLP',
      amount: String(total),
      email: customer.email,
      paymentMethod: '9',
      urlConfirmation: `${site}/api/flow/confirm`,
      urlReturn: `${site}/api/flow/return`,
      timeout: '3600',
    });
    await st.attachFlow(order.code, r.token, r.flowOrder);
    return json({ url: `${r.url}?token=${r.token}`, code: order.code });
  } catch (e) {
    await st.failOrder(order.code, String(e.message || e));
    console.error('checkout', method, order.code, e);
    return fail(`No pudimos iniciar el pago con ${MP_NAME[method]}. Intenta de nuevo en unos minutos, prueba otro medio de pago o escríbenos por WhatsApp.`, 502);
  }
}

async function mpPreference(env, site, order, { items, shipping, zone, customer }) {
  const back = `${site}/api/mp/return?o=${encodeURIComponent(order.code)}&k=${order.access_key}`;
  const lines = items.map(i => ({ id: i.slug, title: i.name.slice(0, 120), quantity: i.qty, unit_price: i.price, currency_id: 'CLP' }));
  if (shipping > 0) lines.push({ id: 'despacho', title: zone === 'rm' ? 'Despacho Región Metropolitana' : 'Despacho a regiones', quantity: 1, unit_price: shipping, currency_id: 'CLP' });
  const iso = d => d.toISOString().replace('Z', '+00:00');
  const pref = {
    items: lines,
    payer: { email: customer.email, name: customer.nombre },
    external_reference: order.code,
    notification_url: `${site}/api/mp/notify`,
    back_urls: { success: back, pending: back, failure: back },
    auto_return: 'approved',
    statement_descriptor: 'UKRABOT',
    metadata: { pedido: order.code },
    expires: true,
    expiration_date_from: iso(new Date(Date.now() - 60e3)),
    expiration_date_to: iso(new Date(Date.now() + 3600e3)),
  };
  let r;
  try {
    r = await mpCall(env, 'POST', '/checkout/preferences', pref, { 'x-idempotency-key': order.code + '-' + order.access_key.slice(0, 8) });
  } catch (e) {
    if (e.status !== 400) throw e;
    // si Mercado Pago no acepta el vencimiento, se reintenta sin él
    delete pref.expires; delete pref.expiration_date_from; delete pref.expiration_date_to;
    console.warn('mp preference retry sin vencimiento', e.message);
    r = await mpCall(env, 'POST', '/checkout/preferences', pref, { 'x-idempotency-key': order.code + '-' + order.access_key.slice(0, 8) + '-2' });
  }
  await store(env).attachMp(order.code, r.id);
  const url = mpConf(env).token.startsWith('TEST-') && r.sandbox_init_point ? r.sandbox_init_point : r.init_point;
  if (!url) throw new Error('Mercado Pago no devolvió init_point');
  return url;
}

async function mpNotify(req, env) {
  const u = new URL(req.url);
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch {} }
  const type = String(body.type || u.searchParams.get('type') || u.searchParams.get('topic') || '');
  const id = String(u.searchParams.get('data.id') || body?.data?.id || (u.searchParams.get('topic') === 'payment' ? u.searchParams.get('id') : '') || '');
  if (type !== 'payment' || !/^\d{1,20}$/.test(id)) return new Response('ignorado', { status: 200 });
  if (!(await mpSignatureOk(req, env, id))) { console.warn('mp notify: firma no válida', id); return new Response('firma no válida', { status: 401 }); }
  try {
    const { order } = await syncMpPayment(env, id);
    if (!order) console.warn('mp notify: pago sin pedido de la tienda', id);
  } catch (e) {
    if (e.status === 404) return new Response('pago no encontrado', { status: 200 }); // p. ej. la prueba del panel de MP
    console.error('mp notify', id, e);
    return new Response('error', { status: 500 }); // Mercado Pago reintenta
  }
  return new Response('OK', { status: 200 });
}

async function mpReturn(req, env) {
  const u = new URL(req.url), code = u.searchParams.get('o') || '', key = u.searchParams.get('k') || '';
  const o = code ? await store(env).orderByCode(code) : null;
  if (!o || !key || !(await safeEqual(key, o.access_key))) {
    return new Response(null, { status: 303, headers: { location: '/pedido?error=1', 'cache-control': 'no-store' } });
  }
  const pid = u.searchParams.get('payment_id') || u.searchParams.get('collection_id') || '';
  try {
    if (/^\d{1,20}$/.test(pid)) {
      const pay = await mpCall(env, 'GET', `/v1/payments/${pid}`);
      if (pay.external_reference === o.code) await store(env).applyMpPayment(pay);
    } else if (o.status === 'pendiente_pago') {
      await syncMpOrder(env, o.code);
    }
  } catch (e) { console.error('mp return', o.code, e); }
  return new Response(null, { status: 303, headers: { location: `/pedido?o=${encodeURIComponent(o.code)}&k=${o.access_key}`, 'cache-control': 'no-store' } });
}

async function flowToken(req) {
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) return String((await req.formData()).get('token') || '');
    if (ct.includes('application/json')) return String((await req.json()).token || '');
  }
  return new URL(req.url).searchParams.get('token') || '';
}

async function flowConfirm(req, env) {
  const token = await flowToken(req);
  if (!token) return new Response('token requerido', { status: 400 });
  try {
    const o = await syncFromFlow(env, token);
    if (!o) console.warn('confirm: token desconocido');
  } catch (e) {
    console.error('confirm', e);
    return new Response('error', { status: 500 }); // Flow reintenta
  }
  return new Response('OK', { status: 200 });
}

async function flowReturn(req, env) {
  const token = await flowToken(req);
  let o = token ? await store(env).orderByToken(token) : null;
  if (o) { try { o = (await syncFromFlow(env, token)) || o; } catch (e) { console.error('return', e); } }
  const to = o ? `/pedido?o=${encodeURIComponent(o.code)}&k=${o.access_key}` : '/pedido?error=1';
  return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });
}

async function orderStatus(req, env) {
  const u = new URL(req.url), code = u.searchParams.get('o') || '', key = u.searchParams.get('k') || '';
  const o = code ? await store(env).orderByCode(code) : null;
  if (!o || !key || !(await safeEqual(key, o.access_key))) return fail('Pedido no encontrado', 404);
  return json({ code: o.code, status: o.status, provider: o.provider || 'flow', total: o.total, subtotal: o.subtotal, shipping: o.shipping, zone: o.zone,
    items: o.items.map(i => ({ name: i.name, qty: i.qty, line: i.line })), created_at: o.created_at,
    courier: o.courier, tracking: o.tracking, email: o.customer.email.replace(/^(.).*(@.*)$/, '$1***$2') });
}

// ---------------------------------------------------------------- precios vigentes en las páginas
async function storePage(req, env, url) {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  let html = await res.text();
  const { overrides } = await store(env).storefront();
  const m = url.pathname.match(/^\/producto\/([a-z0-9-]+?)(?:\.html)?\/?$/);
  const slugs = m ? [m[1]] : CATALOG.map(p => p.slug);
  for (const slug of slugs) {
    if (!BASE[slug]) continue;
    const p = merged(slug, overrides);
    if (m) {
      if (p.price !== p.base_price) {
        const from = fmtCLP(p.base_price).slice(1), to = fmtCLP(p.price).slice(1);
        const esc = from.replace(/\./g, '\\.');
        html = html.replace(new RegExp(`(\\$|%24)${esc}(?!\\.?\\d)`, 'g'), `$1${to}`)
                   .replace(new RegExp(`("price"\\s*:\\s*"?)${p.base_price}(?!\\d)`, 'g'), `$1${p.price}`);
      }
      if (!p.available) {
        if (html.includes('schema.org/InStock')) html = html.replace(/https:\/\/schema\.org\/InStock/g, 'https://schema.org/OutOfStock');
        else html = html.replace(/("price"\s*:\s*"?\d+"?)/, '$1,"availability":"https://schema.org/OutOfStock"');
      }
    } else {
      // /productos: tarjeta y datos estructurados de cada producto
      html = html.replace(new RegExp(`(data-price-slug="${slug}"[^>]*>)[^<]*`, 'g'), `$1${fmtCLP(p.price)} `)
                 .replace(new RegExp(`("url": "https://www\\.ukrabot\\.cl/producto/${slug}"[^}]*?"price": ")\\d+`, 'g'), `$1${p.price}`);
    }
  }
  const h = new Headers(res.headers); h.delete('content-length'); h.set('cache-control', 'public, max-age=0, must-revalidate');
  return new Response(html, { status: res.status, headers: h });
}

// ---------------------------------------------------------------- admin
async function admin(req, env, url) {
  const p = url.pathname.replace(/^\/api\/admin/, '');
  const st = store(env);
  if (p === '/login' && req.method === 'POST') {
    if (!adminReady(env)) return fail('El panel no está activo: falta configurar ADMIN_PASSWORD (12 caracteres o más) en Cloudflare.', 503);
    if (!sameOrigin(req)) return fail('Origen no permitido', 403);
    const bucket = 'login:' + clientIP(req);
    if (await st.limited(bucket, 5, 900, false)) return fail('Demasiados intentos. Espera 15 minutos.', 429);
    let pw = ''; try { pw = String((await req.json()).password || ''); } catch {}
    if (!(await safeEqual(pw, env.ADMIN_PASSWORD))) { await st.limited(bucket, 5, 900, true); return fail('Contraseña incorrecta.', 401); }
    await st.clearHits(bucket);
    return json({ ok: true }, 200, { 'set-cookie': cookie(await makeSession(env), SESSION_HOURS * 3600) });
  }
  if (p === '/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  if (p === '/me') return json({ admin: await isAdmin(req, env), ready: adminReady(env), flow: !!(env.FLOW_API_KEY && env.FLOW_SECRET_KEY), flow_url: env.FLOW_API_URL || 'https://www.flow.cl/api',
    mp: !!env.MP_ACCESS_TOKEN, mp_test: !!env.MP_ACCESS_TOKEN && env.MP_ACCESS_TOKEN.trim().startsWith('TEST-'), mp_signed: !!env.MP_WEBHOOK_SECRET });
  if (!(await isAdmin(req, env))) return fail('Sesión expirada. Vuelve a entrar.', 401);
  if (req.method !== 'GET' && !sameOrigin(req)) return fail('Origen no permitido', 403);

  if (p === '/orders' && req.method === 'GET') {
    return json(await st.listOrders({ status: url.searchParams.get('status') || '', q: (url.searchParams.get('q') || '').slice(0, 60), page: Number(url.searchParams.get('page')) || 1 }));
  }
  let m = p.match(/^\/orders\/(UKR-\d+)$/);
  if (m && req.method === 'GET') { const o = await st.orderByCode(m[1]); return o ? json({ order: o }) : fail('Pedido no encontrado', 404); }
  if (m && req.method === 'POST') {
    let patch; try { patch = await req.json(); } catch { return fail('Solicitud no válida'); }
    const r = await st.updateOrder(m[1], patch);
    return r.error ? fail(r.error) : json(r);
  }
  m = p.match(/^\/orders\/(UKR-\d+)\/sync$/);
  if (m && req.method === 'POST') {
    const o = await st.orderByCode(m[1]);
    if (!o) return fail('Pedido no encontrado', 404);
    if (o.provider === 'mp') {
      try { return json({ order: await syncMpOrder(env, o.code) }); } catch (e) { return fail('Mercado Pago no respondió: ' + e.message, 502); }
    }
    if (!o.flow_token) return fail('Este pedido no tiene orden en Flow.');
    try { return json({ order: await syncFromFlow(env, o.flow_token) }); } catch (e) { return fail('Flow no respondió: ' + e.message, 502); }
  }
  if (p === '/products' && req.method === 'GET') {
    const { overrides } = await st.storefront();
    return json({ products: CATALOG.map(b => ({ ...merged(b.slug, overrides), updated_at: overrides[b.slug]?.updated_at || null })) });
  }
  m = p.match(/^\/products\/([a-z0-9-]+)$/);
  if (m && req.method === 'POST') {
    if (!BASE[m[1]]) return fail('Producto no encontrado', 404);
    let b; try { b = await req.json(); } catch { return fail('Solicitud no válida'); }
    const price = Number(b.price);
    if (!Number.isInteger(price) || price < 350 || price > 10000000) return fail('El precio debe ser un número entero entre $350 y $10.000.000.');
    let stock = b.stock === '' || b.stock === null || b.stock === undefined ? null : Number(b.stock);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) return fail('El stock debe ser un entero de 0 o más, o vacío para no controlarlo.');
    await st.saveProduct(m[1], { price, stock, active: !!b.active });
    const { overrides } = await st.storefront();
    return json({ product: merged(m[1], overrides) });
  }
  if (p === '/settings' && req.method === 'GET') return json({ ...(await st.getSettings()), configured: { flow: !!(env.FLOW_API_KEY && env.FLOW_SECRET_KEY), mp: !!env.MP_ACCESS_TOKEN } });
  if (p === '/settings' && req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return fail('Solicitud no válida'); }
    const rm = Number(b.ship_rm), rg = Number(b.ship_regiones);
    if (![rm, rg].every(v => Number.isInteger(v) && v >= 0 && v <= 200000)) return fail('Las tarifas deben ser números enteros entre $0 y $200.000.');
    const patch = { ship_rm: rm, ship_regiones: rg };
    for (const k of ['pay_flow', 'pay_mp']) if (b[k] !== undefined) patch[k] = b[k] ? 1 : 0;
    return json(await st.saveSettings(patch));
  }
  return fail('No encontrado', 404);
}

const ADMIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// ---------------------------------------------------------------- router
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === '/admin' || path === '/admin/') return new Response(ADMIN_HTML, { headers: ADMIN_HEADERS });
      if (path.startsWith('/api/admin/')) return await admin(req, env, url);
      if (path === '/api/catalog' && req.method === 'GET') return await catalog(env);
      if (path === '/api/checkout' && req.method === 'POST') return await checkout(req, env);
      if (path === '/api/flow/confirm') return await flowConfirm(req, env);
      if (path === '/api/flow/return') return await flowReturn(req, env);
      if (path === '/api/mp/notify') return await mpNotify(req, env);
      if (path === '/api/mp/return') return await mpReturn(req, env);
      if (path === '/api/order' && req.method === 'GET') return await orderStatus(req, env);
      if (path.startsWith('/api/')) return fail('No encontrado', 404);
      if ((path.startsWith('/producto/') || /^\/productos(\.html)?\/?$/.test(path)) && req.method === 'GET') return await storePage(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(path, e);
      if (path.startsWith('/api/')) return fail('Error interno. Intenta de nuevo.', 500);
      return env.ASSETS.fetch(req);
    }
  },
};
