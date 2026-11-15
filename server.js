// Кофейня «Крема» — сервер: Express (REST) + ws (WebSocket) на одном порту
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server }); // WebSocket на том же порту 3000

/* ---------- Данные (в памяти) ---------- */
const items = [
  { id: 1, img: '/img/espresso.jpg', name: 'Эспрессо', category: 'Кофе', type: 'hot', price: 900, sizes: false, stock: 12, max: 12, time: 2, kcal: 5, color: '#4a2a18', foam: '#c98b4f', tag: 'Классика', desc: 'Двойной шот на смеси арабики и робусты. Плотное тело, горьковатый шоколад и долгое послевкусие.' },
  { id: 2, img: '/img/cappuccino.jpg', name: 'Капучино', category: 'Кофе', type: 'hot', price: 1400, sizes: true, stock: 10, max: 10, time: 4, kcal: 120, color: '#8a5a3a', foam: '#f3e3cc', tag: 'Хит', desc: 'Эспрессо, бархатное молоко и плотная пенка. Рисуем сердечко — просто так.' },
  { id: 3, img: '/img/raf-lavender.jpg', name: 'Раф «Лаванда»', category: 'Кофе', type: 'hot', price: 1700, sizes: true, stock: 8, max: 8, time: 5, kcal: 210, color: '#b89678', foam: '#f6ecdf', tag: 'Сезонное', desc: 'Сливки, ванильный сахар и капля лавандового сиропа. Для тех, кто любит помягче.' },
  { id: 4, img: '/img/cold-brew.jpg', name: 'Колд брю', category: 'Холодное', type: 'cold', price: 1600, sizes: true, stock: 9, max: 9, time: 1, kcal: 15, color: '#2d1a12', foam: '#9c6b43', tag: 'Освежает', desc: 'Настаивается 16 часов в холодной воде. Мягкий, сладковатый, с цитрусовой ноткой и кубиками льда.' },
  { id: 5, img: '/img/croissant.jpg', name: 'Круассан миндальный', category: 'Выпечка', type: 'pastry', price: 1100, sizes: false, stock: 8, max: 8, time: 1, kcal: 340, color: '#d9a05b', foam: '#f3e3cc', emoji: '🥐', tag: 'Свежий', desc: 'Слоёный, с миндальным кремом и хрустящей корочкой. Выпекаем каждое утро в 6:30.' }
];
const SIZES = { S: 0.85, M: 1, L: 1.25 };
const orders = [];
let nextOrder = 101;

const stockList = () => items.map(({ id, stock }) => ({ id, stock }));
const queueSize = () => orders.filter(o => o.status !== 'ready').length;
const waitMin = () => 2 + queueSize() * 2;

/* ---------- Логирование: метод и путь каждого запроса ---------- */
const C = { r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m', d: '\x1b[2m' };
const stamp = () => new Date().toLocaleTimeString('ru-RU');
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return; // статику не логируем
    const s = res.statusCode, col = s >= 500 ? C.red : s >= 400 ? C.y : C.g;
    console.log(`${C.d}${stamp()}${C.r} ${C.c}${req.method.padEnd(4)}${C.r} ${req.originalUrl} ${col}${s}${C.r} ${C.d}${Date.now() - t} мс${C.r}`);
  });
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public'))); // раздаём клиент

/* ---------- Уровень 1: основные эндпоинты ---------- */
app.get('/api/items', (req, res) => res.json(items));

app.get('/api/items/:id', (req, res) => {
  const item = items.find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: `Позиции с кодом «${req.params.id}» нет в меню` });
  res.json(item);
});

/* ---------- Уровень 3: «рубильники» (поломки сервера) ---------- */
app.get('/api/chaos/500', (req, res) => res.status(500).json({ error: 'Кофемашина сломалась (учебная ошибка 500)' }));
app.get('/api/chaos/slow', (req, res) => setTimeout(() => res.json(items), 3000)); // ответ через 3 секунды
app.get('/api/chaos/broken', (req, res) => {
  res.type('application/json').send('[{"id":1,"name":"Эспрессо","price":900,'); // намеренно битый JSON
});

/* ---------- Заказы: POST с передачей JSON ---------- */
app.get('/api/orders', (req, res) => res.json(orders));

app.post('/api/orders', (req, res) => {
  const { name, comment = '', items: lines } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 30)
    return res.status(400).json({ error: 'Укажите имя от 2 до 30 символов' });
  if (!Array.isArray(lines) || !lines.length || lines.length > 20)
    return res.status(400).json({ error: 'Корзина пуста' });

  const out = [], need = {};
  let total = 0;
  for (const l of lines) {
    const it = items.find(i => i.id === Number(l.id)), qty = Number(l.qty);
    if (!it || !Number.isInteger(qty) || qty < 1 || qty > 10)
      return res.status(400).json({ error: 'Некорректная позиция в заказе' });
    const size = it.sizes ? (SIZES[l.size] ? l.size : 'M') : null;
    const price = Math.round(it.price * (size ? SIZES[size] : 1) / 10) * 10;
    need[it.id] = (need[it.id] || 0) + qty;
    total += price * qty;
    out.push({ id: it.id, name: it.name, size, qty, price });
  }
  for (const id in need) {
    const it = items.find(i => i.id === Number(id));
    if (it.stock < need[id])
      return res.status(409).json({ error: `«${it.name}»: осталось ${it.stock} шт.`, id: it.id, stock: it.stock });
  }
  for (const id in need) items.find(i => i.id === Number(id)).stock -= need[id];

  const order = { id: nextOrder++, name: name.trim(), comment: String(comment).slice(0, 100), lines: out, total, status: 'accepted', createdAt: Date.now(), eta: waitMin() };
  orders.push(order);
  const text = `${order.name} заказал(а): ${out.map(l => l.name + (l.qty > 1 ? ' ×' + l.qty : '')).join(', ')}`;
  broadcast({ type: 'order', order, items: stockList(), queue: queueSize(), wait: waitMin(), text });
  setTimeout(() => setStatus(order, 'brewing'), 7000);
  setTimeout(() => setStatus(order, 'ready'), 16000);
  res.status(201).json(order);
});

function setStatus(order, status) {
  order.status = status;
  broadcast({ type: 'status', order, queue: queueSize(), wait: waitMin() });
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Эндпоинт не найден' }));
app.use((err, req, res, next) => { // например, битый JSON в теле POST
  console.log(`${C.red}Ошибка:${C.r} ${err.message}`);
  res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Некорректный JSON в запросе' : 'Внутренняя ошибка сервера' });
});

/* ---------- Уровень 6: WebSocket ---------- */
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(data));
}
wss.on('connection', ws => {
  console.log(`${C.d}${stamp()}${C.r} ${C.c}WS  ${C.r} клиент подключился (онлайн: ${wss.clients.size})`);
  ws.send(JSON.stringify({ type: 'hello', items: stockList(), queue: queueSize(), wait: waitMin(), online: wss.clients.size }));
  broadcast({ type: 'presence', online: wss.clients.size });
  ws.on('close', () => {
    console.log(`${C.d}${stamp()}${C.r} ${C.c}WS  ${C.r} клиент отключился (онлайн: ${wss.clients.size})`);
    broadcast({ type: 'presence', online: wss.clients.size });
  });
});

// каждые 5 секунд «жизнь кофейни»: пополнение запасов или продажа в зале
setInterval(() => {
  let event = null;
  const low = items.filter(i => i.stock < i.max), rich = items.filter(i => i.stock > 2);
  if (low.length && Math.random() < 0.55) {
    const it = low[Math.floor(Math.random() * low.length)];
    it.stock++; event = `Бариста пополнил запас: ${it.name}`;
  } else if (rich.length && Math.random() < 0.6) {
    const it = rich[Math.floor(Math.random() * rich.length)];
    it.stock--; event = `В зале купили: ${it.name}`;
  }
  broadcast({ type: 'update', ts: Date.now(), items: stockList(), queue: queueSize(), wait: waitMin(), event });
}, 5000);

server.listen(PORT, () => {
  console.log(`\n${C.g}☕ Кофейня «Крема» открыта:${C.r} http://localhost:${PORT}`);
  console.log(`${C.d}   REST: /api/items · /api/items/:id · /api/orders · /api/chaos/{500,slow,broken}`);
  console.log(`   WebSocket: ws://localhost:${PORT}${C.r}\n`);
});
