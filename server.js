// Quán Nhỏ – ứng dụng thanh toán Pi cho quán nhỏ. Không cần cài thư viện (Node >= 18).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PI_API_KEY = process.env.PI_API_KEY || '';      // Lấy trong Pi Developer Portal
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'doi-mat-khau-nay';
const MOCK = !PI_API_KEY;                              // Không có API key => chế độ mock (chạy thử ngoài Pi Browser)
const PI_API = 'https://api.minepi.com/v2';
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC = path.join(__dirname, 'public');

const DEFAULT_STORE = {
  items: [
    { id: 'cf-den', name: 'Cà phê đen', price: 0.05, emoji: '☕' },
    { id: 'cf-sua', name: 'Cà phê sữa', price: 0.06, emoji: '🥛' },
    { id: 'tra-dao', name: 'Trà đào', price: 0.07, emoji: '🍑' },
    { id: 'banh-mi', name: 'Bánh mì', price: 0.08, emoji: '🥖' },
  ],
  orders: [],
};

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return JSON.parse(JSON.stringify(DEFAULT_STORE)); }
}
function save(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}
let store = load();

const round = (n) => Math.round(n * 1e7) / 1e7;
function totalOf(lines) {
  let sum = 0;
  const detail = [];
  for (const l of lines || []) {
    const item = store.items.find((i) => i.id === l.id);
    const qty = Number(l.qty);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Giỏ hàng không hợp lệ');
    sum += item.price * qty;
    detail.push({ id: item.id, name: item.name, price: item.price, qty });
  }
  if (!detail.length) throw new Error('Giỏ hàng trống');
  return { total: round(sum), detail };
}

async function piFetch(url, opts = {}) {
  const res = await fetch(PI_API + url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${PI_API_KEY}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pi API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function verifyUser(accessToken) {
  if (MOCK) return { uid: 'mock-user', username: 'khach_thu' };
  const res = await fetch(PI_API + '/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('Token Pi không hợp lệ');
  return res.json();
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
const isAdmin = (req) => req.headers['x-admin-token'] === ADMIN_TOKEN;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/config') return send(res, 200, { mock: MOCK });
    if (url.pathname === '/api/items' && req.method === 'GET') return send(res, 200, store.items);

    if (url.pathname === '/api/items' && req.method === 'POST') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Sai mã quản lý' });
      const b = await body(req);
      const price = Number(b.price);
      if (!b.name || !(price > 0)) return send(res, 400, { error: 'Thiếu tên hoặc giá' });
      const item = { id: 'i' + Date.now().toString(36), name: String(b.name).slice(0, 40), price: round(price), emoji: String(b.emoji || '🍽️').slice(0, 4) };
      store.items.push(item); save(store);
      return send(res, 200, item);
    }
    if (url.pathname.startsWith('/api/items/') && req.method === 'DELETE') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Sai mã quản lý' });
      store.items = store.items.filter((i) => i.id !== url.pathname.split('/').pop()); save(store);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/orders' && req.method === 'GET') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Sai mã quản lý' });
      return send(res, 200, store.orders.slice().reverse());
    }
    if (url.pathname === '/api/my-orders' && req.method === 'POST') {
      const b = await body(req);
      const user = await verifyUser(b.accessToken);
      return send(res, 200, store.orders.filter((o) => o.uid === user.uid).reverse());
    }
    if (url.pathname.startsWith('/api/orders/') && req.method === 'PATCH') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Sai mã quản lý' });
      const o = store.orders.find((x) => x.id === url.pathname.split('/').pop());
      if (!o) return send(res, 404, { error: 'Không thấy đơn' });
      const b = await body(req);
      if (['paid', 'preparing', 'done'].includes(b.status)) { o.status = b.status; save(store); }
      return send(res, 200, o);
    }

    // Bước 1: Pi báo "sẵn sàng để server duyệt" -> kiểm tra số tiền rồi approve
    if (url.pathname === '/api/payments/approve' && req.method === 'POST') {
      const b = await body(req);
      const user = await verifyUser(b.accessToken);
      const { total, detail } = totalOf(b.lines);
      if (!MOCK) {
        const p = await piFetch(`/payments/${b.paymentId}`);
        if (Math.abs(p.amount - total) > 1e-9) return send(res, 400, { error: 'Số tiền không khớp giỏ hàng' });
        await piFetch(`/payments/${b.paymentId}/approve`, { method: 'POST', body: '{}' });
      }
      if (!store.orders.find((o) => o.paymentId === b.paymentId)) {
        store.orders.push({ id: 'DH' + String(store.orders.length + 1).padStart(4, '0'), paymentId: b.paymentId, uid: user.uid, username: user.username, lines: detail, total, status: 'pending', txid: null, createdAt: new Date().toISOString() });
        save(store);
      }
      return send(res, 200, { approved: true });
    }

    // Bước 2: giao dịch đã lên blockchain -> complete
    if (url.pathname === '/api/payments/complete' && req.method === 'POST') {
      const b = await body(req);
      const order = store.orders.find((o) => o.paymentId === b.paymentId);
      if (!order) return send(res, 404, { error: 'Không thấy đơn hàng' });
      if (!MOCK) await piFetch(`/payments/${b.paymentId}/complete`, { method: 'POST', body: JSON.stringify({ txid: b.txid }) });
      order.status = 'paid'; order.txid = b.txid; save(store);
      return send(res, 200, { completed: true, orderId: order.id });
    }

    // Thanh toán bị hủy
    if (url.pathname === '/api/payments/cancel' && req.method === 'POST') {
      const b = await body(req);
      store.orders = store.orders.filter((o) => !(o.paymentId === b.paymentId && o.status === 'pending')); save(store);
      return send(res, 200, { ok: true });
    }

    // Thanh toán dở dang từ lần trước (Pi yêu cầu xử lý)
    if (url.pathname === '/api/payments/incomplete' && req.method === 'POST') {
      const b = await body(req);
      const txid = b.payment && b.payment.transaction && b.payment.transaction.txid;
      const order = store.orders.find((o) => o.paymentId === (b.payment && b.payment.identifier));
      if (!MOCK && txid) await piFetch(`/payments/${b.payment.identifier}/complete`, { method: 'POST', body: JSON.stringify({ txid }) });
      if (order && txid) { order.status = 'paid'; order.txid = txid; save(store); }
      return send(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Không có API này' });
    serveStatic(req, res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Quán Nhỏ chạy tại http://localhost:${PORT}  (${MOCK ? 'CHẾ ĐỘ MOCK – chưa có PI_API_KEY' : 'kết nối Pi API thật'})`);
});
