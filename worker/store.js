// Almacenamiento de la tienda: un único Durable Object con SQLite.
// Guarda pedidos, precios/stock editados en el panel, tarifas de envío
// y contadores para limitar intentos (login y checkout).
import { DurableObject } from 'cloudflare:workers';

const now = () => new Date().toISOString();

export const PAY = { 1: 'pendiente_pago', 2: 'pagado', 3: 'rechazado', 4: 'anulado' };
// Estados de un pago de Mercado Pago → estado del pedido
export const MP_PAY = {
  approved: 'pagado', pending: 'pendiente_pago', in_process: 'pendiente_pago', authorized: 'pendiente_pago',
  rejected: 'rechazado', cancelled: 'anulado', refunded: 'devuelto', charged_back: 'devuelto', in_mediation: 'devuelto',
};
const UNPAID = ['pendiente_pago', 'rechazado', 'anulado', 'error_flow'];
// Estados de preparación que el admin puede asignar a un pedido pagado
export const FULFILL = ['pagado', 'preparando', 'enviado', 'entregado', 'cancelado'];

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        access_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT,
        status TEXT NOT NULL,
        flow_status INTEGER,
        flow_token TEXT,
        flow_order INTEGER,
        items_json TEXT NOT NULL,
        subtotal INTEGER NOT NULL,
        shipping INTEGER NOT NULL,
        total INTEGER NOT NULL,
        zone TEXT NOT NULL,
        customer_json TEXT NOT NULL,
        courier TEXT DEFAULT '',
        tracking TEXT DEFAULT '',
        admin_note TEXT DEFAULT '',
        review TEXT DEFAULT '',
        stock_applied INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(flow_token);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE TABLE IF NOT EXISTS products (
        slug TEXT PRIMARY KEY,
        price INTEGER,
        stock INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hits (bucket TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_hits ON hits(bucket, ts);
    `);
    // v2: Mercado Pago como segundo medio de pago
    const cols = this.sql.exec('PRAGMA table_info(orders)').toArray().map(c => c.name);
    if (!cols.includes('provider')) this.sql.exec("ALTER TABLE orders ADD COLUMN provider TEXT NOT NULL DEFAULT 'flow'");
    if (!cols.includes('mp_pref')) this.sql.exec('ALTER TABLE orders ADD COLUMN mp_pref TEXT');
    if (!cols.includes('mp_payment')) this.sql.exec('ALTER TABLE orders ADD COLUMN mp_payment TEXT');
    if (!cols.includes('mp_status')) this.sql.exec('ALTER TABLE orders ADD COLUMN mp_status TEXT');
    if (!cols.includes('mp_extra')) this.sql.exec("ALTER TABLE orders ADD COLUMN mp_extra TEXT NOT NULL DEFAULT ''");
  }

  // ---------------------------------------------------------------- límites
  /** Registra un intento y devuelve true si se supera `max` en `windowSec`. */
  limited(bucket, max, windowSec, record = true) {
    const t = Math.floor(Date.now() / 1000);
    this.sql.exec('DELETE FROM hits WHERE ts < ?', t - 86400);
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM hits WHERE bucket = ? AND ts > ?', bucket, t - windowSec).one().n;
    if (n >= max) return true;
    if (record) this.sql.exec('INSERT INTO hits (bucket, ts) VALUES (?, ?)', bucket, t);
    return false;
  }
  clearHits(bucket) { this.sql.exec('DELETE FROM hits WHERE bucket = ?', bucket); }

  // ---------------------------------------------------------------- ajustes
  getSettings() {
    const s = { ship_rm: 3990, ship_regiones: 5990, pay_flow: 1, pay_mp: 1 };
    for (const r of this.sql.exec('SELECT key, value FROM settings').toArray()) s[r.key] = Number(r.value);
    return s;
  }
  saveSettings(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!['ship_rm', 'ship_regiones', 'pay_flow', 'pay_mp'].includes(k)) continue;
      this.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
    }
    return this.getSettings();
  }

  // ---------------------------------------------------------------- productos
  overrides() {
    const o = {};
    for (const r of this.sql.exec('SELECT slug, price, stock, active, updated_at FROM products').toArray()) o[r.slug] = r;
    return o;
  }
  saveProduct(slug, { price, stock, active }) {
    this.sql.exec(`INSERT INTO products (slug, price, stock, active, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET price = excluded.price, stock = excluded.stock, active = excluded.active, updated_at = excluded.updated_at`,
      slug, price, stock, active ? 1 : 0, now());
    return this.overrides()[slug];
  }
  /** Estado público de la tienda en una sola llamada (catálogo + envío). */
  storefront() { return { overrides: this.overrides(), settings: this.getSettings() }; }

  // ---------------------------------------------------------------- pedidos
  createOrder({ items, subtotal, shipping, total, zone, customer, provider = 'flow' }) {
    const key = crypto.randomUUID().replace(/-/g, '');
    const t = now();
    const row = this.sql.exec(`INSERT INTO orders (code, access_key, created_at, updated_at, status, items_json, subtotal, shipping, total, zone, customer_json, provider)
      VALUES (NULL, ?, ?, ?, 'pendiente_pago', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      key, t, t, JSON.stringify(items), subtotal, shipping, total, zone, JSON.stringify(customer), provider).one();
    const code = 'UKR-' + String(1000 + row.id);
    this.sql.exec('UPDATE orders SET code = ? WHERE id = ?', code, row.id);
    return { id: row.id, code, access_key: key };
  }
  attachFlow(code, token, flowOrder) {
    this.sql.exec('UPDATE orders SET flow_token = ?, flow_order = ?, updated_at = ? WHERE code = ?', token, flowOrder, now(), code);
  }
  attachMp(code, prefId) {
    this.sql.exec('UPDATE orders SET mp_pref = ?, updated_at = ? WHERE code = ?', prefId, now(), code);
  }
  failOrder(code, reason) {
    this.sql.exec("UPDATE orders SET status = 'error_flow', review = ?, updated_at = ? WHERE code = ? AND status = 'pendiente_pago'", reason.slice(0, 300), now(), code);
  }
  orderByToken(token) { return this.decode(this.sql.exec('SELECT * FROM orders WHERE flow_token = ?', token).toArray()[0]); }
  orderByCode(code) { return this.decode(this.sql.exec('SELECT * FROM orders WHERE code = ?', code).toArray()[0]); }

  /** Descuenta el stock de un pedido (una sola vez). */
  _takeStock(o, t) {
    for (const it of JSON.parse(o.items_json)) {
      this.sql.exec('UPDATE products SET stock = MAX(stock - ?, 0), updated_at = ? WHERE slug = ? AND stock IS NOT NULL', it.qty, t, it.slug);
    }
  }

  /**
   * Aplica el estado informado por Flow (consultado con getStatus, nunca el POST).
   * Idempotente: el stock se descuenta una sola vez, al pasar a pagado.
   */
  applyFlowStatus(token, st) {
    return this.ctx.storage.transactionSync(() => {
      const o = this.sql.exec('SELECT * FROM orders WHERE flow_token = ?', token).toArray()[0];
      if (!o) return null;
      const t = now();
      let review = o.review || '';
      if (String(st.commerceOrder) !== o.code || Number(st.amount) !== o.total) {
        review = `Flow informó orden ${st.commerceOrder} por $${st.amount}; se esperaba ${o.code} por $${o.total}. Revisar en Flow.`;
      }
      const payStatus = PAY[st.status] || 'pendiente_pago';
      let status = o.status;
      if (UNPAID.includes(status)) status = review ? 'revisar' : payStatus;
      let paidAt = o.paid_at;
      if (payStatus === 'pagado' && !paidAt) paidAt = t;
      let applied = o.stock_applied;
      if (payStatus === 'pagado' && !applied && !review) { this._takeStock(o, t); applied = 1; }
      this.sql.exec('UPDATE orders SET status = ?, flow_status = ?, flow_order = COALESCE(?, flow_order), paid_at = ?, stock_applied = ?, review = ?, updated_at = ? WHERE id = ?',
        status, Number(st.status), st.flowOrder ?? null, paidAt, applied, review, t, o.id);
      return this.decode(this.sql.exec('SELECT * FROM orders WHERE id = ?', o.id).toArray()[0]);
    });
  }

  /**
   * Aplica un pago de Mercado Pago, consultado con /v1/payments/{id} usando el
   * Access Token (nunca se confía en el contenido de la notificación).
   * Un pedido puede recibir varios intentos de pago: uno rechazado no deshace
   * uno aprobado, y un segundo pago aprobado o una devolución quedan "a revisar".
   */
  applyMpPayment(pay) {
    return this.ctx.storage.transactionSync(() => {
      const o = this.sql.exec("SELECT * FROM orders WHERE code = ? AND provider = 'mp'", String(pay.external_reference || '')).toArray()[0];
      if (!o) return null;
      const t = now(), pid = String(pay.id);
      const payStatus = MP_PAY[pay.status] || 'pendiente_pago';
      let review = o.review || '', status = o.status, paidAt = o.paid_at, applied = o.stock_applied, payment = o.mp_payment, mpStatus = o.mp_status;
      const extra = o.mp_extra ? o.mp_extra.split(',') : [];
      const mismatch = Number(pay.transaction_amount) !== o.total || pay.currency_id !== 'CLP';
      const label = `pago ${pid} (${pay.status}${pay.status_detail ? ' · ' + pay.status_detail : ''})`;

      if (!o.paid_at) {
        // aún sin pagar: el último intento manda
        payment = pid; mpStatus = pay.status;
        if (payStatus === 'pagado' && mismatch) {
          review = `Mercado Pago informó $${pay.transaction_amount} ${pay.currency_id}; se esperaba $${o.total} CLP (${label}). Revisar en Mercado Pago.`;
          status = 'revisar'; paidAt = t;
        } else if (payStatus === 'pagado') {
          status = 'pagado'; paidAt = t;
          if (!applied) { this._takeStock(o, t); applied = 1; }
        } else if (UNPAID.includes(status)) {
          status = payStatus === 'devuelto' ? 'anulado' : payStatus;
        }
      } else if (pid === o.mp_payment) {
        // el pago aprobado cambió: devolución, contracargo o disputa
        mpStatus = pay.status;
        if (payStatus === 'devuelto' && o.mp_status !== pay.status) {
          review = `El ${label} fue devuelto o disputado en Mercado Pago. Revisa antes de despachar.`;
          status = 'revisar';
        }
      } else if (payStatus === 'pagado' && !extra.includes(pid)) {
        // un segundo pago aprobado para el mismo pedido
        extra.push(pid);
        review = `Se recibió un segundo pago aprobado (${label}) para este pedido. Devuélvelo desde Mercado Pago.`;
        status = 'revisar';
      }
      this.sql.exec('UPDATE orders SET status = ?, mp_payment = ?, mp_status = ?, mp_extra = ?, paid_at = ?, stock_applied = ?, review = ?, updated_at = ? WHERE id = ?',
        status, payment, mpStatus, extra.join(','), paidAt, applied, review, t, o.id);
      return this.decode(this.sql.exec('SELECT * FROM orders WHERE id = ?', o.id).toArray()[0]);
    });
  }

  listOrders({ status = '', q = '', page = 1 }) {
    const where = [], args = [];
    if (status === 'activos') where.push("status IN ('pagado','preparando','revisar')");
    else if (status === 'sin_pagar') where.push("status IN ('pendiente_pago','rechazado','anulado','error_flow')");
    else if (status) { where.push('status = ?'); args.push(status); }
    if (q) { where.push('(code LIKE ? OR customer_json LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const per = 50, off = (Math.max(1, page) - 1) * per;
    const rows = this.sql.exec(`SELECT * FROM orders ${w} ORDER BY id DESC LIMIT ${per} OFFSET ${off}`, ...args).toArray().map(r => this.decode(r));
    const total = this.sql.exec(`SELECT COUNT(*) AS n FROM orders ${w}`, ...args).one().n;
    const counts = {};
    for (const r of this.sql.exec('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').toArray()) counts[r.status] = r.n;
    const month = new Date().toISOString().slice(0, 7);
    const sales = this.sql.exec("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE paid_at LIKE ? AND status IN ('pagado','preparando','enviado','entregado')", month + '%').one();
    return { orders: rows, total, page, per, counts, month: { orders: sales.n, amount: sales.s } };
  }

  updateOrder(code, patch) {
    const o = this.sql.exec('SELECT * FROM orders WHERE code = ?', code).toArray()[0];
    if (!o) return { error: 'Pedido no encontrado' };
    const fields = [], args = [];
    if (patch.status !== undefined) {
      if (!FULFILL.includes(patch.status)) return { error: 'Estado no válido' };
      if (!o.paid_at) return { error: 'Solo los pedidos pagados pueden cambiar de estado de preparación' };
      fields.push('status = ?'); args.push(patch.status);
      if (o.status === 'revisar') { fields.push("review = ''"); }
    }
    for (const k of ['courier', 'tracking', 'admin_note']) {
      if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(String(patch[k]).slice(0, k === 'admin_note' ? 1000 : 120)); }
    }
    if (!fields.length) return { order: this.decode(o) };
    fields.push('updated_at = ?'); args.push(now());
    this.sql.exec(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, ...args, o.id);
    return { order: this.decode(this.sql.exec('SELECT * FROM orders WHERE id = ?', o.id).toArray()[0]) };
  }

  decode(r) {
    if (!r) return null;
    const { items_json, customer_json, ...rest } = r;
    return { ...rest, items: JSON.parse(items_json), customer: JSON.parse(customer_json) };
  }
}
