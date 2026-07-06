import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query, initDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

await initDb();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Files are kept in memory just long enough to store them in the database.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB cap

// ---- Row -> JSON mappers (coerce BIGINT/boolean across backends) ---------
const mapChannel = (r) => ({ id: r.id, name: r.name, created_at: Number(r.created_at) });
const mapMessage = (r) => ({ id: r.id, channel_id: r.channel_id, author: r.author, body: r.body, created_at: Number(r.created_at) });
const mapTodo = (r) => ({ id: r.id, channel_id: r.channel_id, text: r.text, done: !!r.done, created_at: Number(r.created_at) });
const mapFile = (r) => ({
  id: r.id, channel_id: r.channel_id, original_name: r.original_name,
  size: Number(r.size), mime: r.mime, uploader: r.uploader, created_at: Number(r.created_at),
});
const mapAttachment = (r) => ({
  id: r.id, channel_id: r.channel_id, item_type: r.item_type, item_id: r.item_id,
  original_name: r.original_name, size: Number(r.size), mime: r.mime, created_at: Number(r.created_at),
});

const getChannel = async (id) => (await query('SELECT * FROM channels WHERE id = $1', [id])).rows[0];

// ---- REST API -----------------------------------------------------------

// Channels
app.get('/api/channels', async (req, res) => {
  const { rows } = await query('SELECT * FROM channels ORDER BY created_at ASC');
  res.json(rows.map(mapChannel));
});

app.post('/api/channels', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Channel name is required' });
  const channel = { id: nanoid(10), name, created_at: Date.now() };
  await query('INSERT INTO channels (id, name, created_at) VALUES ($1, $2, $3)', [channel.id, channel.name, channel.created_at]);
  io.emit('channel:new', channel); // everyone sees the new channel in the sidebar
  res.status(201).json(channel);
});

app.delete('/api/channels/:id', async (req, res) => {
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Not found' });
  await query('DELETE FROM channels WHERE id = $1', [channel.id]); // cascades to messages, todos, files
  io.emit('channel:deleted', { id: channel.id });
  res.json({ ok: true });
});

// A channel's full state (used when opening a channel)
app.get('/api/channels/:id/state', async (req, res) => {
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Not found' });
  const [messages, todos, fixes, files, attachments] = await Promise.all([
    query('SELECT * FROM messages WHERE channel_id = $1 ORDER BY created_at ASC', [channel.id]),
    query('SELECT * FROM todos WHERE channel_id = $1 ORDER BY created_at ASC', [channel.id]),
    query('SELECT * FROM fixes WHERE channel_id = $1 ORDER BY created_at ASC', [channel.id]),
    // Never select the blob content here — only metadata.
    query('SELECT id, channel_id, original_name, size, mime, uploader, created_at FROM files WHERE channel_id = $1 ORDER BY created_at DESC', [channel.id]),
    query('SELECT id, channel_id, item_type, item_id, original_name, size, mime, created_at FROM attachments WHERE channel_id = $1 ORDER BY created_at ASC', [channel.id]),
  ]);
  // Group attachments under their to-do / fix item.
  const byItem = {};
  for (const a of attachments.rows) {
    (byItem[`${a.item_type}:${a.item_id}`] ||= []).push(mapAttachment(a));
  }
  const withAttachments = (rows, type) =>
    rows.map((r) => ({ ...mapTodo(r), attachments: byItem[`${type}:${r.id}`] || [] }));

  res.json({
    channel: mapChannel(channel),
    messages: messages.rows.map(mapMessage),
    todos: withAttachments(todos.rows, 'todo'),
    fixes: withAttachments(fixes.rows, 'fix'),
    files: files.rows.map(mapFile),
  });
});

// Files
app.post('/api/channels/:id/files', upload.single('file'), async (req, res) => {
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const record = {
    id: nanoid(10),
    channel_id: channel.id,
    original_name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    uploader: (req.body.uploader || 'Someone').slice(0, 80),
    created_at: Date.now(),
  };
  await query(
    'INSERT INTO files (id, channel_id, original_name, size, mime, uploader, content, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [record.id, record.channel_id, record.original_name, record.size, record.mime, record.uploader, req.file.buffer, record.created_at]
  );
  io.to(channel.id).emit('file:new', record);
  res.status(201).json(record);
});

app.get('/api/files/:id/download', async (req, res) => {
  const { rows } = await query('SELECT original_name, mime, content FROM files WHERE id = $1', [req.params.id]);
  const file = rows[0];
  if (!file) return res.status(404).send('Not found');
  const safeName = String(file.original_name).replace(/"/g, '');
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.send(Buffer.from(file.content));
});

app.delete('/api/files/:id', async (req, res) => {
  const { rows } = await query('SELECT id, channel_id FROM files WHERE id = $1', [req.params.id]);
  const file = rows[0];
  if (!file) return res.status(404).json({ error: 'Not found' });
  await query('DELETE FROM files WHERE id = $1', [file.id]);
  io.to(file.channel_id).emit('file:deleted', { id: file.id });
  res.json({ ok: true });
});

// Attachments on a to-do / fix item (e.g. screenshots)
app.post('/api/items/:type/:id/attachments', upload.single('file'), async (req, res) => {
  const type = req.params.type;
  if (type !== 'todo' && type !== 'fix') return res.status(400).json({ error: 'Invalid item type' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const table = type === 'todo' ? 'todos' : 'fixes';
  const { rows } = await query(`SELECT channel_id FROM ${table} WHERE id = $1`, [req.params.id]);
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const record = {
    id: nanoid(10),
    channel_id: item.channel_id,
    item_type: type,
    item_id: req.params.id,
    original_name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    created_at: Date.now(),
  };
  await query(
    'INSERT INTO attachments (id, channel_id, item_type, item_id, original_name, size, mime, content, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [record.id, record.channel_id, record.item_type, record.item_id, record.original_name, record.size, record.mime, req.file.buffer, record.created_at]
  );
  io.to(item.channel_id).emit('attachment:new', record);
  res.status(201).json(record);
});

// Serve an attachment inline (so images open/preview in the browser)
app.get('/api/attachments/:id', async (req, res) => {
  const { rows } = await query('SELECT original_name, mime, content FROM attachments WHERE id = $1', [req.params.id]);
  const att = rows[0];
  if (!att) return res.status(404).send('Not found');
  const safeName = String(att.original_name).replace(/"/g, '');
  res.setHeader('Content-Type', att.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.send(Buffer.from(att.content));
});

app.delete('/api/attachments/:id', async (req, res) => {
  const { rows } = await query('SELECT id, channel_id, item_type, item_id FROM attachments WHERE id = $1', [req.params.id]);
  const att = rows[0];
  if (!att) return res.status(404).json({ error: 'Not found' });
  await query('DELETE FROM attachments WHERE id = $1', [att.id]);
  io.to(att.channel_id).emit('attachment:deleted', { id: att.id, channel_id: att.channel_id, item_type: att.item_type, item_id: att.item_id });
  res.json({ ok: true });
});

// ---- Socket.IO (live chat + todos) -------------------------------------
io.on('connection', (socket) => {
  let joined = null;

  socket.on('channel:join', (channelId) => {
    if (joined) socket.leave(joined);
    joined = channelId;
    socket.join(channelId);
  });

  socket.on('message:send', async ({ channelId, author, body }) => {
    try {
      const text = (body || '').trim();
      if (!channelId || !text) return;
      if (!(await getChannel(channelId))) return;
      const msg = {
        id: nanoid(10),
        channel_id: channelId,
        author: (author || 'Anonymous').slice(0, 80),
        body: text.slice(0, 4000),
        created_at: Date.now(),
      };
      await query('INSERT INTO messages (id, channel_id, author, body, created_at) VALUES ($1,$2,$3,$4,$5)',
        [msg.id, msg.channel_id, msg.author, msg.body, msg.created_at]);
      io.to(channelId).emit('message:new', msg);
      // Tell every client so channels with new messages can be flagged unread.
      io.emit('channel:activity', { channelId });
    } catch (err) { console.error('message:send', err); }
  });

  socket.on('message:delete', async ({ id }) => {
    try {
      const { rows } = await query('SELECT id, channel_id FROM messages WHERE id = $1', [id]);
      const msg = rows[0];
      if (!msg) return;
      await query('DELETE FROM messages WHERE id = $1', [id]);
      io.to(msg.channel_id).emit('message:deleted', { id, channel_id: msg.channel_id });
    } catch (err) { console.error('message:delete', err); }
  });

  socket.on('todo:add', async ({ channelId, text }) => {
    try {
      const t = (text || '').trim();
      if (!channelId || !t) return;
      if (!(await getChannel(channelId))) return;
      const todo = { id: nanoid(10), channel_id: channelId, text: t.slice(0, 500), done: false, created_at: Date.now() };
      await query('INSERT INTO todos (id, channel_id, text, done, created_at) VALUES ($1,$2,$3,FALSE,$4)',
        [todo.id, todo.channel_id, todo.text, todo.created_at]);
      io.to(channelId).emit('todo:new', todo);
    } catch (err) { console.error('todo:add', err); }
  });

  socket.on('todo:toggle', async ({ id }) => {
    try {
      const { rows } = await query('SELECT * FROM todos WHERE id = $1', [id]);
      const todo = rows[0];
      if (!todo) return;
      const done = !todo.done;
      await query('UPDATE todos SET done = $1 WHERE id = $2', [done, id]);
      io.to(todo.channel_id).emit('todo:updated', { ...mapTodo(todo), done });
    } catch (err) { console.error('todo:toggle', err); }
  });

  socket.on('todo:delete', async ({ id }) => {
    try {
      const { rows } = await query('SELECT id, channel_id FROM todos WHERE id = $1', [id]);
      const todo = rows[0];
      if (!todo) return;
      await query('DELETE FROM attachments WHERE item_type = $1 AND item_id = $2', ['todo', id]);
      await query('DELETE FROM todos WHERE id = $1', [id]);
      io.to(todo.channel_id).emit('todo:deleted', { id, channel_id: todo.channel_id });
    } catch (err) { console.error('todo:delete', err); }
  });

  // Fixes — a second checklist that behaves exactly like todos.
  socket.on('fix:add', async ({ channelId, text }) => {
    try {
      const t = (text || '').trim();
      if (!channelId || !t) return;
      if (!(await getChannel(channelId))) return;
      const fix = { id: nanoid(10), channel_id: channelId, text: t.slice(0, 500), done: false, created_at: Date.now() };
      await query('INSERT INTO fixes (id, channel_id, text, done, created_at) VALUES ($1,$2,$3,FALSE,$4)',
        [fix.id, fix.channel_id, fix.text, fix.created_at]);
      io.to(channelId).emit('fix:new', fix);
    } catch (err) { console.error('fix:add', err); }
  });

  socket.on('fix:toggle', async ({ id }) => {
    try {
      const { rows } = await query('SELECT * FROM fixes WHERE id = $1', [id]);
      const fix = rows[0];
      if (!fix) return;
      const done = !fix.done;
      await query('UPDATE fixes SET done = $1 WHERE id = $2', [done, id]);
      io.to(fix.channel_id).emit('fix:updated', { ...mapTodo(fix), done });
    } catch (err) { console.error('fix:toggle', err); }
  });

  socket.on('fix:delete', async ({ id }) => {
    try {
      const { rows } = await query('SELECT id, channel_id FROM fixes WHERE id = $1', [id]);
      const fix = rows[0];
      if (!fix) return;
      await query('DELETE FROM attachments WHERE item_type = $1 AND item_id = $2', ['fix', id]);
      await query('DELETE FROM fixes WHERE id = $1', [id]);
      io.to(fix.channel_id).emit('fix:deleted', { id, channel_id: fix.channel_id });
    } catch (err) { console.error('fix:delete', err); }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Project Organizer running at http://localhost:${PORT}`);
});
