// Worker de ukrabot.cl: sirve el sitio estático y agrega la tienda.
//   /api/catalog            precios, stock y tarifas vigentes (público)
//   /api/checkout           crea el pedido y la orden de pago (Flow o Mercado Pago)
//   /api/flow/confirm       aviso servidor-a-servidor de Flow (urlConfirmation)
//   /api/flow/return        vuelta del cliente desde Flow (urlReturn)
//   /api/mp/notify          notificación (webhook) de Mercado Pago
//   /api/mp/return          vuelta del cliente desde Mercado Pago (back_urls)
//   /api/paypal/return      vuelta del cliente desde PayPal: se captura el pago
//   /api/paypal/cancel      el cliente canceló en PayPal (sin cargo)
//   /api/paypal/webhook     eventos de PayPal (firma verificada con la API de PayPal)
//   /api/order              estado de un pedido (requiere su clave de acceso)
//   /api/download           descarga de un archivo digital de un pedido pagado
//   /admin, /api/admin/*    panel de administración (contraseña)
//   /producto/*, /productos se sirven con el precio y stock vigentes
//   /blog/*                  artículos; se les quita AdSense si se desactiva en el panel
//
// Secretos (Cloudflare > Worker > Settings > Variables and Secrets):
//   FLOW_API_KEY, FLOW_SECRET_KEY, ADMIN_PASSWORD
//   MP_ACCESS_TOKEN (Mercado Pago) y, opcional, MP_WEBHOOK_SECRET
//   PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET (PayPal) y, opcional, PAYPAL_WEBHOOK_ID.
//   PAYPAL_API_URL solo para pruebas: https://api-m.sandbox.paypal.com
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

// Estado de la tienda leído en cada página del blog: se guarda 30 s en memoria
// para no consultar el Durable Object en cada visita.
let frontCache = null;
async function cachedFront(env) {
  if (frontCache && Date.now() - frontCache.t < 30e3) return frontCache.v;
  const v = await store(env).storefront();
  frontCache = { v, t: Date.now() };
  return v;
}
const PAID_OK = ['pagado', 'preparando', 'enviado', 'entregado'];

// ---------------------------------------------------------------- AdSense
/** Quita el script de AdSense y los bloques de anuncios de una página HTML. */
function stripAds(res) {
  const drop = { element(e) { e.remove(); } };
  const h = new Headers(res.headers); h.delete('content-length');
  return new HTMLRewriter()
    .on('script[src*="googlesyndication.com"]', drop)
    .on('.ad-slot', drop)
    .on('ins.adsbygoogle', drop)
    .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }));
}
const isHtml = res => (res.headers.get('content-type') || '').includes('text/html');

async function blogPage(req, env, adsKey = 'ads_blog') {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !isHtml(res)) return res;
  let front;
  try { front = await cachedFront(env); } catch (e) { console.error('ajustes blog', e); return res; }
  let out = res;
  // precio vigente de productos ofrecidos dentro de un artículo
  out = new HTMLRewriter().on('[data-price-slug]', {
    element(e) {
      const slug = e.getAttribute('data-price-slug');
      if (BASE[slug]) e.setInnerContent(fmtCLP(merged(slug, front.overrides, front.files, front.settings).price));
    },
  }).transform(out);
  return !adsKey || front.settings[adsKey] !== 0 ? out : stripAds(out);
}

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

function merged(slug, overrides, files = {}, settings = {}) {
  const b = BASE[slug], o = overrides[slug] || {};
  const digital = !!b.digital;
  // precio general de los productos digitales (Ajustes del panel); 0 = cada uno con su precio
  const general = digital && settings.digital_price > 0;
  const price = general ? settings.digital_price : Number.isInteger(o.price) ? o.price : b.price;
  const stock = digital || o.stock === undefined ? null : o.stock;
  const active = o.active === undefined ? true : !!o.active;
  const nfiles = files[slug] || 0;
  // un producto digital solo se vende cuando tiene archivos cargados
  return { ...b, base_price: b.price, price, ...(digital ? { own_price: Number.isInteger(o.price) ? o.price : b.price, general_price: general } : {}),
    stock, active, digital, files: nfiles,
    available: active && (stock === null || stock > 0) && (!digital || nfiles > 0) };
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
const MP_NAME = { flow: 'Flow', mp: 'Mercado Pago', paypal: 'PayPal' };
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

// ---------------------------------------------------------------- PayPal
// PayPal no acepta pesos chilenos: se cobra en dólares (USD) con el tipo de
// cambio y el recargo definidos en el panel. El pedido guarda el monto en USD
// y el tipo de cambio usado; solo una captura COMPLETED por ese monto lo paga.
const PP_LIVE = 'https://api-m.paypal.com';
function ppConf(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET en Cloudflare');
  return { url: (env.PAYPAL_API_URL || PP_LIVE).replace(/\/$/, ''), id: env.PAYPAL_CLIENT_ID.trim(), secret: env.PAYPAL_CLIENT_SECRET.trim() };
}
const ppSandbox = env => /sandbox/i.test(env.PAYPAL_API_URL || '');
let ppTok = null;
async function ppToken(env) {
  const c = ppConf(env);
  if (ppTok && ppTok.key === c.url + c.id && ppTok.exp > Date.now() + 60e3) return ppTok.token;
  const res = await fetch(c.url + '/v1/oauth2/token', {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(c.id + ':' + c.secret), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  let d = {}; try { d = await res.json(); } catch {}
  if (!res.ok || !d.access_token) throw new Error(`PayPal token ${res.status}: ${d.error_description || d.error || 'credenciales no válidas'}`);
  ppTok = { key: c.url + c.id, token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 300) * 1000 };
  return ppTok.token;
}
async function ppCall(env, method, path, body, { requestId, raw } = {}) {
  const c = ppConf(env);
  const headers = { authorization: 'Bearer ' + (await ppToken(env)), prefer: 'return=representation' };
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  if (requestId) headers['paypal-request-id'] = requestId;
  const res = await fetch(c.url + path, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) {
    const issue = (data.details && data.details[0] && data.details[0].issue) || data.name || '';
    const e = new Error(`PayPal ${path.split('?')[0]} ${res.status}: ${issue || data.message || 'error'}`);
    e.status = res.status; e.issue = issue; e.data = data;
    throw e;
  }
  return data;
}
/** Monto en dólares (2 decimales, hacia arriba) para un total en pesos. */
function usdAmount(clp, settings) {
  const rate = Number(settings.pp_rate), mk = Number(settings.pp_markup) || 0;
  return (Math.ceil(Math.round(clp * (1 + mk / 100) / rate * 1e6) / 1e4) / 100).toFixed(2);
}
async function ppCreate(env, site, order, total, settings) {
  const usd = usdAmount(total, settings);
  const q = `o=${encodeURIComponent(order.code)}&k=${order.access_key}`;
  const r = await ppCall(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: order.code,
      custom_id: order.code,
      invoice_id: `${order.code}-${order.access_key.slice(0, 6)}`,
      description: `Pedido ${order.code} en ukrabot.cl (${fmtCLP(total)} CLP)`,
      amount: { currency_code: 'USD', value: usd },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: 'ukrabot.cl', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
      return_url: `${site}/api/paypal/return?${q}`, cancel_url: `${site}/api/paypal/cancel?${q}`,
    } } },
  }, { requestId: `crear-${order.code}-${order.access_key.slice(0, 8)}` });
  const link = (r.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
  if (!r.id || !link) throw new Error('PayPal no devolvió el enlace de pago');
  await store(env).attachPaypal(order.code, r.id, usd, Number(settings.pp_rate));
  return link.href;
}
/** Captura una orden aprobada. Si ya estaba capturada, la consulta. */
async function ppCapture(env, o) {
  try {
    const r = await ppCall(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(o.pp_order)}/capture`, {}, { requestId: `capturar-${o.code}-${crypto.randomUUID().slice(0, 8)}` });
    return { order: await store(env).applyPaypal(r) };
  } catch (e) {
    if (e.issue === 'ORDER_ALREADY_CAPTURED') return { order: await store(env).applyPaypal(await ppCall(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(o.pp_order)}`)) };
    if (e.issue === 'INSTRUMENT_DECLINED') {
      // PayPal recomienda devolver al cliente para que elija otro medio dentro de PayPal
      const d = await ppCall(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(o.pp_order)}`);
      const link = (d.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
      if (link) return { retry: link.href };
    }
    throw e;
  }
}
/** Consulta la orden en PayPal; si el cliente ya aprobó y falta capturar, captura. */
async function syncPaypal(env, o) {
  const d = await ppCall(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(o.pp_order)}`);
  if (d.status === 'APPROVED' && o.status === 'pendiente_pago') return (await ppCapture(env, o)).order || o;
  return store(env).applyPaypal(d);
}
async function ppOrderFromQuery(req, env) {
  const u = new URL(req.url), code = u.searchParams.get('o') || '', key = u.searchParams.get('k') || '';
  const o = code ? await store(env).orderByCode(code) : null;
  if (!o || o.provider !== 'paypal' || !key || !(await safeEqual(key, o.access_key))) return { u, o: null };
  return { u, o };
}
const see = to => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });
const orderUrl = o => `/pedido?o=${encodeURIComponent(o.code)}&k=${o.access_key}`;

async function ppReturn(req, env) {
  const { u, o } = await ppOrderFromQuery(req, env);
  if (!o) return see('/pedido?error=1');
  const token = u.searchParams.get('token') || '';
  if (o.pp_order && token === o.pp_order && o.status === 'pendiente_pago') {
    try {
      const r = await ppCapture(env, o);
      if (r.retry) return see(r.retry);
    } catch (e) { console.error('paypal return', o.code, e.message); }
  }
  return see(orderUrl(o));
}
async function ppCancel(req, env) {
  const { o } = await ppOrderFromQuery(req, env);
  if (!o) return see('/pedido?error=1');
  let cur = o;
  try { if (o.pp_order) cur = (await syncPaypal(env, o)) || o; } catch (e) { console.error('paypal cancel', o.code, e.message); }
  if (cur.status === 'pendiente_pago') await store(env).cancelPaypal(o.code);
  return see(orderUrl(o));
}
async function ppWebhook(req, env) {
  if (req.method !== 'POST') return new Response('ok');
  const raw = await req.text();
  let ev; try { ev = JSON.parse(raw); } catch { return new Response('json', { status: 400 }); }
  if (!env.PAYPAL_WEBHOOK_ID) return new Response('webhook sin configurar', { status: 200 });
  const h = n => JSON.stringify(req.headers.get(n) || '');
  try {
    const body = `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},"transmission_id":${h('paypal-transmission-id')},` +
      `"transmission_sig":${h('paypal-transmission-sig')},"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(env.PAYPAL_WEBHOOK_ID.trim())},"webhook_event":${raw}}`;
    const v = await ppCall(env, 'POST', '/v1/notifications/verify-webhook-signature', undefined, { raw: body });
    if (v.verification_status !== 'SUCCESS') { console.warn('paypal webhook: firma no válida', ev.id); return new Response('firma no válida', { status: 401 }); }
  } catch (e) { console.error('paypal webhook verify', e.message); return new Response('error', { status: 500 }); }
  const r = ev.resource || {};
  const ppId = ev.event_type === 'CHECKOUT.ORDER.APPROVED' ? r.id : r.supplementary_data && r.supplementary_data.related_ids && r.supplementary_data.related_ids.order_id;
  if (!ppId) return new Response('ignorado', { status: 200 });
  const o = await store(env).orderByPaypal(String(ppId));
  if (!o) return new Response('sin pedido', { status: 200 });
  try { await syncPaypal(env, o); } catch (e) { console.error('paypal webhook', o.code, e.message); return new Response('error', { status: 500 }); }
  return new Response('OK', { status: 200 });
}

/** Medios de pago activos: con credenciales cargadas y habilitados en el panel. */
function payMethods(env, settings) {
  const m = [];
  if (env.FLOW_API_KEY && env.FLOW_SECRET_KEY && settings.pay_flow !== 0) m.push('flow');
  if (env.MP_ACCESS_TOKEN && settings.pay_mp !== 0) m.push('mp');
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && settings.pay_pp !== 0 && settings.pp_rate > 0) m.push('paypal');
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
function validCustomer(c, digitalOnly = false) {
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const out = {
    nombre: s(c.nombre), email: s(c.email).toLowerCase(), telefono: s(c.telefono),
    region: s(c.region), comuna: s(c.comuna), direccion: s(c.direccion), notas: s(c.notas),
  };
  const errors = {};
  if (out.nombre.length < 3 || out.nombre.length > 80) errors.nombre = 'Escribe tu nombre y apellido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email) || out.email.length > 120) errors.email = 'Revisa el correo: ahí te llega el comprobante del pago.';
  if (digitalOnly) {
    // descarga: basta nombre y correo; el teléfono es opcional
    if (out.telefono && (out.telefono.replace(/\D/g, '').length < 8 || out.telefono.length > 20)) errors.telefono = 'Revisa el teléfono o déjalo en blanco.';
    out.region = ''; out.comuna = ''; out.direccion = ''; out.notas = '';
    return { customer: out, errors };
  }
  if (out.telefono.replace(/\D/g, '').length < 8 || out.telefono.length > 20) errors.telefono = 'Escribe un teléfono de al menos 8 dígitos.';
  if (!REGIONS.includes(out.region)) errors.region = 'Elige tu región.';
  if (out.comuna.length < 2 || out.comuna.length > 60) errors.comuna = 'Escribe tu comuna.';
  if (out.direccion.length < 5 || out.direccion.length > 160) errors.direccion = 'Escribe calle, número y depto. si corresponde.';
  if (out.notas.length > 300) errors.notas = 'Máximo 300 caracteres.';
  return { customer: out, errors };
}

// ---------------------------------------------------------------- handlers públicos
async function catalog(env) {
  const { overrides, settings, files } = await store(env).storefront();
  const methods = payMethods(env, settings);
  return json({
    products: CATALOG.map(p => {
      const m = merged(p.slug, overrides, files, settings);
      return { slug: m.slug, name: m.name, short: m.short, price: m.price, img: m.img, url: m.url, stock: m.stock, available: m.available, digital: m.digital };
    }),
    shipping: { rm: settings.ship_rm, regiones: settings.ship_regiones },
    fx: methods.includes('paypal') ? { rate: settings.pp_rate, markup: settings.pp_markup } : null,
    promo: settings.pack_popup === 0 ? null : { delay: settings.pack_popup_secs },
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
  const { overrides, settings, files } = await st.storefront();
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
    const m = merged(slug, overrides, files, settings);
    if (!m.active || (m.digital && !m.files)) return json({ error: `${m.short} ya no está disponible.`, slug }, 409);
    if (m.digital && q > 1) return json({ error: `${m.short} es una descarga: se compra una sola unidad.`, slug }, 409);
    if (m.stock !== null && q > m.stock) return json({ error: m.stock ? `Solo quedan ${m.stock} unidades de ${m.short}.` : `${m.short} está agotado.`, slug, stock: m.stock }, 409);
    items.push({ slug, name: m.short, qty: q, price: m.price, line: m.price * q, ...(m.digital ? { digital: true } : {}) });
  }
  const digitalOnly = items.every(i => i.digital);
  const { customer, errors } = validCustomer(body.customer || {}, digitalOnly);
  if (Object.keys(errors).length) return json({ error: 'Revisa los datos marcados.', fields: errors }, 422);
  const zone = digitalOnly ? 'digital' : customer.region === 'Metropolitana de Santiago' ? 'rm' : 'regiones';
  const subtotal = items.reduce((s, i) => s + i.line, 0);
  const shipping = zone === 'digital' ? 0 : zone === 'rm' ? settings.ship_rm : settings.ship_regiones;
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
    if (method === 'paypal') return json({ url: await ppCreate(env, site, order, total, settings), code: order.code });
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
  const digital = o.items.filter(i => i.digital);
  let downloads = [];
  if (digital.length && PAID_OK.includes(o.status)) {
    for (const it of digital) {
      for (const f of await store(env).listFiles(it.slug)) {
        downloads.push({ name: f.name, size: f.size, product: it.name, url: `/api/download?o=${encodeURIComponent(o.code)}&k=${o.access_key}&f=${f.id}` });
      }
    }
  }
  return json({ code: o.code, status: o.status, provider: o.provider || 'flow', ...(o.provider === 'paypal' ? { usd_total: o.usd_total } : {}), total: o.total, subtotal: o.subtotal, shipping: o.shipping, zone: o.zone,
    items: o.items.map(i => ({ name: i.name, qty: i.qty, line: i.line, digital: !!i.digital })), created_at: o.created_at,
    courier: o.courier, tracking: o.tracking, email: o.customer.email.replace(/^(.).*(@.*)$/, '$1***$2'),
    has_digital: digital.length > 0, downloads });
}

async function download(req, env) {
  const u = new URL(req.url), code = u.searchParams.get('o') || '', key = u.searchParams.get('k') || '', fid = Number(u.searchParams.get('f'));
  const st = store(env);
  const o = code ? await st.orderByCode(code) : null;
  if (!o || !key || !(await safeEqual(key, o.access_key)) || !Number.isInteger(fid)) return fail('Descarga no encontrada', 404);
  if (!PAID_OK.includes(o.status)) return fail('La descarga se habilita cuando el pago está confirmado.', 403);
  const f = await st.getFile(fid);
  if (!f || !o.items.some(i => i.digital && i.slug === f.product)) return fail('Descarga no encontrada', 404);
  if (await st.limited('dl:' + o.code, 40, 86400)) return fail('Alcanzaste el límite de descargas de hoy para este pedido. Escríbenos si necesitas ayuda.', 429);
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return new Response(f.data, { headers: {
    'content-type': f.type || 'application/octet-stream',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff',
  } });
}

// ---------------------------------------------------------------- precios vigentes en las páginas
async function storePage(req, env, url) {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  let html = await res.text();
  const { overrides, settings, files } = await store(env).storefront();
  const m = url.pathname.match(/^\/producto\/([a-z0-9-]+?)(?:\.html)?\/?$/);
  const slugs = m ? [m[1]] : CATALOG.map(p => p.slug);
  for (const slug of slugs) {
    if (!BASE[slug]) continue;
    const p = merged(slug, overrides, files, settings);
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
  const out = new Response(html, { status: res.status, headers: h });
  return settings.ads_productos === 0 ? stripAds(out) : out;
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
    mp: !!env.MP_ACCESS_TOKEN, mp_test: !!env.MP_ACCESS_TOKEN && env.MP_ACCESS_TOKEN.trim().startsWith('TEST-'), mp_signed: !!env.MP_WEBHOOK_SECRET,
    pp: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), pp_sandbox: ppSandbox(env), pp_webhook: !!env.PAYPAL_WEBHOOK_ID });
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
    if (o.provider === 'paypal') {
      if (!o.pp_order) return fail('Este pedido no tiene orden en PayPal.');
      try { return json({ order: (await syncPaypal(env, o)) || o }); } catch (e) { return fail('PayPal no respondió: ' + e.message, 502); }
    }
    if (!o.flow_token) return fail('Este pedido no tiene orden en Flow.');
    try { return json({ order: await syncFromFlow(env, o.flow_token) }); } catch (e) { return fail('Flow no respondió: ' + e.message, 502); }
  }
  if (p === '/products' && req.method === 'GET') {
    const { overrides, files, settings } = await st.storefront();
    return json({ digital_price: settings.digital_price, products: CATALOG.map(b => ({ ...merged(b.slug, overrides, files, settings), updated_at: overrides[b.slug]?.updated_at || null })) });
  }
  if (p === '/files' && req.method === 'GET') {
    const prod = url.searchParams.get('product') || '';
    if (!BASE[prod]?.digital) return fail('Producto digital no encontrado', 404);
    return json({ files: await st.listFiles(prod) });
  }
  if (p === '/files' && req.method === 'POST') {
    const prod = url.searchParams.get('product') || '';
    if (!BASE[prod]?.digital) return fail('Producto digital no encontrado', 404);
    const name = (url.searchParams.get('name') || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 120);
    if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) return fail('El archivo necesita un nombre con extensión (por ejemplo, guia.pdf).');
    const data = await req.arrayBuffer();
    if (!data.byteLength) return fail('El archivo está vacío.');
    if (data.byteLength > 20 * 1024 * 1024) return fail('El archivo supera 20 MB.');
    const type = FILE_TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
    const sha = hex(await crypto.subtle.digest('SHA-256', data));
    const saved = await st.saveFile(prod, name, type, data, sha);
    frontCache = null;
    return json({ file: saved });
  }
  m = p.match(/^\/files\/(\d+)\/delete$/);
  if (m && req.method === 'POST') {
    const ok = await st.deleteFile(Number(m[1]));
    frontCache = null;
    return ok ? json({ ok: true }) : fail('Archivo no encontrado', 404);
  }
  m = p.match(/^\/products\/([a-z0-9-]+)$/);
  if (m && req.method === 'POST') {
    if (!BASE[m[1]]) return fail('Producto no encontrado', 404);
    let b; try { b = await req.json(); } catch { return fail('Solicitud no válida'); }
    const price = Number(b.price);
    if (!Number.isInteger(price) || price < 350 || price > 10000000) return fail('El precio debe ser un número entero entre $350 y $10.000.000.');
    let stock = b.stock === '' || b.stock === null || b.stock === undefined ? null : Number(b.stock);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) return fail('El stock debe ser un entero de 0 o más, o vacío para no controlarlo.');
    await st.saveProduct(m[1], { price, stock: BASE[m[1]].digital ? null : stock, active: !!b.active });
    const { overrides, files, settings } = await st.storefront();
    frontCache = null;
    return json({ product: merged(m[1], overrides, files, settings) });
  }
  if (p === '/settings' && req.method === 'GET') return json({ ...(await st.getSettings()), configured: { flow: !!(env.FLOW_API_KEY && env.FLOW_SECRET_KEY), mp: !!env.MP_ACCESS_TOKEN, paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) }, pp_sandbox: ppSandbox(env) });
  if (p === '/fx' && req.method === 'GET') {
    // dólar observado publicado por el Banco Central (vía mindicador.cl)
    try {
      const r = await fetch(env.FX_API_URL || 'https://mindicador.cl/api/dolar', { headers: { accept: 'application/json' } });
      const d = await r.json();
      const s0 = d && d.serie && d.serie[0];
      if (!r.ok || !s0 || !(Number(s0.valor) > 0)) throw new Error('respuesta sin valor');
      return json({ valor: Number(s0.valor), fecha: s0.fecha });
    } catch (e) { return fail('No pudimos consultar el dólar observado (' + e.message + '). Escribe el valor a mano.', 502); }
  }
  if (p === '/settings' && req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return fail('Solicitud no válida'); }
    const patch = {};
    if (b.ship_rm !== undefined || b.ship_regiones !== undefined) {
      const rm = Number(b.ship_rm), rg = Number(b.ship_regiones);
      if (![rm, rg].every(v => Number.isInteger(v) && v >= 0 && v <= 200000)) return fail('Las tarifas deben ser números enteros entre $0 y $200.000.');
      patch.ship_rm = rm; patch.ship_regiones = rg;
    }
    for (const k of ['pay_flow', 'pay_mp', 'pay_pp', 'ads_productos', 'ads_blog', 'pack_popup']) if (b[k] !== undefined) patch[k] = b[k] ? 1 : 0;
    if (b.pp_rate !== undefined) {
      const v = Math.round(Number(b.pp_rate) * 100) / 100;
      if (!(v >= 100 && v <= 10000)) return fail('El tipo de cambio debe estar entre $100 y $10.000 por dólar.');
      patch.pp_rate = v; patch.pp_rate_at = Date.now();
    }
    if (b.pp_markup !== undefined) {
      const v = Math.round(Number(b.pp_markup) * 10) / 10;
      if (!(v >= 0 && v <= 30)) return fail('El recargo de PayPal debe estar entre 0 % y 30 %.');
      patch.pp_markup = v;
    }
    if (b.digital_price !== undefined) {
      const v = b.digital_price === null || b.digital_price === '' ? 0 : Number(b.digital_price);
      if (!Number.isInteger(v) || (v !== 0 && (v < 350 || v > 10000000))) return fail('El precio general debe ser un número entero entre $350 y $10.000.000.');
      patch.digital_price = v;
    }
    if (b.pack_popup_secs !== undefined) {
      const v = Number(b.pack_popup_secs);
      if (!Number.isInteger(v) || v < 10 || v > 600) return fail('El tiempo del aviso debe estar entre 10 y 600 segundos.');
      patch.pack_popup_secs = v;
    }
    if (!Object.keys(patch).length) return fail('No hay cambios que guardar.');
    const saved = await st.saveSettings(patch);
    frontCache = null;
    return json(saved);
  }
  return fail('No encontrado', 404);
}

const FILE_TYPES = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip', csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4',
};

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
      if (path === '/api/paypal/return') return await ppReturn(req, env);
      if (path === '/api/paypal/cancel') return await ppCancel(req, env);
      if (path === '/api/paypal/webhook') return await ppWebhook(req, env);
      if (path === '/api/order' && req.method === 'GET') return await orderStatus(req, env);
      if (path === '/api/download' && req.method === 'GET') return await download(req, env);
      if (path.startsWith('/api/')) return fail('No encontrado', 404);
      if ((path.startsWith('/producto/') || /^\/productos(\.html)?\/?$/.test(path)) && req.method === 'GET') return await storePage(req, env, url);
      if ((path === '/blog' || path.startsWith('/blog/')) && req.method === 'GET') return await blogPage(req, env);
      if (/^\/productos-digitales(\.html)?\/?$/.test(path) && req.method === 'GET') return await blogPage(req, env, null);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(path, e);
      if (path.startsWith('/api/')) return fail('Error interno. Intenta de nuevo.', 500);
      return env.ASSETS.fetch(req);
    }
  },
};
