// ---------- State ----------
const socket = io();
let channels = [];
let activeId = null;
let displayName = localStorage.getItem('displayName') || '';

// ---------- Elements ----------
const el = (id) => document.getElementById(id);
const channelList = el('channelList');
const emptyState = el('emptyState');
const channelView = el('channelView');
const messagesEl = el('messages');
const fileList = el('fileList');
const todoList = el('todoList');
const fixList = el('fixList');

// ---------- Right-rail tabs ----------
document.querySelectorAll('.rail-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rail-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.rail-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.querySelector(`.rail-panel[data-panel="${tab.dataset.tab}"]`).classList.remove('hidden');
  });
});

// ---------- Helpers ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- Panel toggles & mobile drawers ----------
const appEl = el('app');
const mobileMQ = window.matchMedia('(max-width: 768px)');

// Desktop: panels collapse in-place (remembered per browser).
// Mobile: the same buttons open/close slide-in drawers (one at a time).
function applyPanelState() {
  appEl.classList.toggle('sidebar-collapsed', localStorage.getItem('sidebarCollapsed') === '1');
  appEl.classList.toggle('rail-collapsed', localStorage.getItem('railCollapsed') === '1');
}
function closeDrawers() { appEl.classList.remove('drawer-left', 'drawer-right'); }

el('toggleSidebarBtn').addEventListener('click', () => {
  if (mobileMQ.matches) {
    const open = appEl.classList.toggle('drawer-left');
    if (open) appEl.classList.remove('drawer-right');
  } else {
    const collapsed = appEl.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  }
});
el('toggleRailBtn').addEventListener('click', () => {
  if (mobileMQ.matches) {
    const open = appEl.classList.toggle('drawer-right');
    if (open) appEl.classList.remove('drawer-left');
  } else {
    const collapsed = appEl.classList.toggle('rail-collapsed');
    localStorage.setItem('railCollapsed', collapsed ? '1' : '0');
  }
});
el('backdrop').addEventListener('click', closeDrawers);
el('emptyOpenSidebar').addEventListener('click', () => appEl.classList.add('drawer-left'));
applyPanelState();

// ---------- Display name ----------
function ensureName() {
  if (!displayName) {
    const n = prompt('Pick a display name (others will see this):', '');
    displayName = (n && n.trim()) || 'Anonymous';
    localStorage.setItem('displayName', displayName);
  }
  el('nameBtn').textContent = displayName;
}
el('nameBtn').addEventListener('click', () => {
  const n = prompt('Change your display name:', displayName);
  if (n && n.trim()) {
    displayName = n.trim();
    localStorage.setItem('displayName', displayName);
    el('nameBtn').textContent = displayName;
  }
});

// ---------- Channels ----------
async function loadChannels() {
  channels = await (await fetch('/api/channels')).json();
  renderChannels();
}

function renderChannels() {
  channelList.innerHTML = '';
  channels.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'channel-item' + (c.id === activeId ? ' active' : '');
    div.innerHTML = `<span class="hash">#</span><span class="cname">${escapeHtml(c.name)}</span>`;
    div.onclick = () => openChannel(c.id);
    channelList.appendChild(div);
  });
}

el('newChannelBtn').addEventListener('click', async () => {
  const name = prompt('New channel name:', '');
  if (!name || !name.trim()) return;
  const res = await fetch('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const channel = await res.json();
  openChannel(channel.id);
});

async function openChannel(id) {
  const res = await fetch(`/api/channels/${id}/state`);
  if (!res.ok) { alert('Channel not found'); location.hash = ''; return; }
  const { channel, messages, todos, fixes, files } = await res.json();

  activeId = id;
  location.hash = `#/channel/${id}`;
  socket.emit('channel:join', id);
  renderChannels();
  closeDrawers(); // on mobile, reveal the chat after picking a channel

  emptyState.classList.add('hidden');
  channelView.classList.remove('hidden');
  el('channelName').textContent = `#${channel.name}`;

  messagesEl.innerHTML = '';
  messages.forEach(addMessage);
  scrollMessages();

  fileList.innerHTML = '';
  files.forEach(addFile);

  todoList.innerHTML = '';
  todos.forEach(addTodo);

  fixList.innerHTML = '';
  (fixes || []).forEach(addFix);
}

el('deleteChannelBtn').addEventListener('click', async () => {
  if (!activeId) return;
  if (!confirm('Delete this channel and all its messages, files, and to-dos?')) return;
  await fetch(`/api/channels/${activeId}`, { method: 'DELETE' });
});

el('copyLinkBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(location.href).then(() => {
    const b = el('copyLinkBtn');
    const old = b.textContent;
    b.textContent = '✓ Copied!';
    setTimeout(() => (b.textContent = old), 1500);
  });
});

// ---------- Messages ----------
function addMessage(m) {
  const div = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta"><span class="author">${escapeHtml(m.author)}</span><span class="time">${fmtTime(m.created_at)}</span></div>
    <div class="body">${escapeHtml(m.body)}</div>`;
  messagesEl.appendChild(div);
}
function scrollMessages() { messagesEl.scrollTop = messagesEl.scrollHeight; }

const messageInput = el('messageInput');
el('messageForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
});
function sendMessage() {
  const body = messageInput.value.trim();
  if (!body || !activeId) return;
  socket.emit('message:send', { channelId: activeId, author: displayName, body });
  messageInput.value = '';
  messageInput.style.height = 'auto';
}

// ---------- Files ----------
function addFile(f) {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.dataset.id = f.id;
  li.innerHTML = `
    <span class="icon">📄</span>
    <span class="info">
      <span class="name"><a href="/api/files/${f.id}/download">${escapeHtml(f.original_name)}</a></span>
      <span class="sub">${fmtSize(f.size)} · ${escapeHtml(f.uploader || 'Someone')}</span>
    </span>
    <button class="icon-btn" title="Delete file">🗑</button>`;
  li.querySelector('.icon-btn').onclick = () => fetch(`/api/files/${f.id}`, { method: 'DELETE' });
  fileList.prepend(li);
}

const fileInput = el('fileInput');
const uploadZone = el('uploadZone');
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

['dragover', 'dragenter'].forEach((ev) =>
  uploadZone.addEventListener(ev, (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) =>
  uploadZone.addEventListener(ev, (e) => { e.preventDefault(); uploadZone.classList.remove('dragover'); }));
uploadZone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});

async function uploadFile(file) {
  if (!activeId) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('uploader', displayName);
  const res = await fetch(`/api/channels/${activeId}/files`, { method: 'POST', body: fd });
  if (!res.ok) alert('Upload failed (file may be too large — 50 MB max).');
  fileInput.value = '';
}

// ---------- Checklist items (To-do + Fixes share this) ----------
// Builds one <li> with a checkbox, text, an attach (screenshot) button, a delete
// button, and a strip of attachment thumbnails. `kind` is 'todo' or 'fix'.
function makeThumb(a) {
  const url = `/api/attachments/${a.id}`;
  const isImage = (a.mime || '').startsWith('image/');
  const wrap = document.createElement('div');
  wrap.className = 'attach-thumb' + (isImage ? '' : ' is-file');
  wrap.dataset.id = a.id;
  if (isImage) {
    wrap.innerHTML =
      `<img src="${url}" alt="${escapeHtml(a.original_name)}" title="${escapeHtml(a.original_name)}" />` +
      `<button class="attach-remove" title="Remove attachment">✕</button>`;
    wrap.querySelector('img').onclick = () => window.open(url, '_blank');
  } else {
    wrap.innerHTML =
      `<a href="${url}" target="_blank" title="${escapeHtml(a.original_name)}">📄</a>` +
      `<button class="attach-remove" title="Remove attachment">✕</button>`;
  }
  wrap.querySelector('.attach-remove').onclick = () =>
    fetch(`/api/attachments/${a.id}`, { method: 'DELETE' });
  return wrap;
}

function buildChecklistItem(item, kind) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (item.done ? ' done' : '');
  li.dataset.id = item.id;

  const row = document.createElement('div');
  row.className = 'todo-row';
  row.innerHTML = `
    <input type="checkbox" ${item.done ? 'checked' : ''} />
    <span class="label">${escapeHtml(item.text)}</span>
    <button class="icon-btn attach-btn" title="Attach a screenshot">📎</button>
    <button class="icon-btn del-btn" title="Delete">🗑</button>`;
  li.appendChild(row);

  const strip = document.createElement('div');
  strip.className = 'item-attachments';
  li.appendChild(strip);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  li.appendChild(fileInput);

  row.querySelector('input[type="checkbox"]').onchange = () => socket.emit(`${kind}:toggle`, { id: item.id });
  row.querySelector('.del-btn').onclick = () => socket.emit(`${kind}:delete`, { id: item.id });
  row.querySelector('.attach-btn').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/items/${kind}/${item.id}/attachments`, { method: 'POST', body: fd });
    if (!res.ok) alert('Attachment upload failed (images up to 10 MB).');
    fileInput.value = '';
  };

  (item.attachments || []).forEach((a) => strip.appendChild(makeThumb(a)));
  return li;
}

// ---------- To-dos ----------
function addTodo(t) { todoList.appendChild(buildChecklistItem(t, 'todo')); }
el('todoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('todoInput');
  const text = input.value.trim();
  if (!text || !activeId) return;
  socket.emit('todo:add', { channelId: activeId, text });
  input.value = '';
});

// ---------- Fixes (same behavior as to-dos) ----------
function addFix(f) { fixList.appendChild(buildChecklistItem(f, 'fix')); }
el('fixForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('fixInput');
  const text = input.value.trim();
  if (!text || !activeId) return;
  socket.emit('fix:add', { channelId: activeId, text });
  input.value = '';
});

// ---------- Socket events ----------
socket.on('channel:new', (c) => {
  if (!channels.find((x) => x.id === c.id)) { channels.push(c); renderChannels(); }
});
socket.on('channel:deleted', ({ id }) => {
  channels = channels.filter((c) => c.id !== id);
  renderChannels();
  if (id === activeId) {
    activeId = null;
    location.hash = '';
    channelView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    if (mobileMQ.matches) appEl.classList.add('drawer-left'); // surface the channel list
  }
});
socket.on('message:new', (m) => {
  if (m.channel_id === activeId) { addMessage(m); scrollMessages(); }
});
socket.on('file:new', (f) => { if (f.channel_id === activeId) addFile(f); });
socket.on('file:deleted', ({ id }) => {
  const li = fileList.querySelector(`[data-id="${id}"]`);
  if (li) li.remove();
});
socket.on('todo:new', (t) => { if (t.channel_id === activeId) addTodo(t); });
socket.on('todo:updated', (t) => {
  const li = todoList.querySelector(`[data-id="${t.id}"]`);
  if (!li) return;
  li.classList.toggle('done', !!t.done);
  li.querySelector('input[type="checkbox"]').checked = !!t.done;
});
socket.on('todo:deleted', ({ id }) => {
  const li = todoList.querySelector(`[data-id="${id}"]`);
  if (li) li.remove();
});
socket.on('fix:new', (f) => { if (f.channel_id === activeId) addFix(f); });
socket.on('fix:updated', (f) => {
  const li = fixList.querySelector(`[data-id="${f.id}"]`);
  if (!li) return;
  li.classList.toggle('done', !!f.done);
  li.querySelector('input[type="checkbox"]').checked = !!f.done;
});
socket.on('fix:deleted', ({ id }) => {
  const li = fixList.querySelector(`[data-id="${id}"]`);
  if (li) li.remove();
});

// Attachments added/removed on a to-do or fix item (live for everyone)
function itemListFor(type) { return type === 'fix' ? fixList : todoList; }
socket.on('attachment:new', (a) => {
  if (a.channel_id !== activeId) return;
  const li = itemListFor(a.item_type).querySelector(`[data-id="${a.item_id}"]`);
  if (li) li.querySelector('.item-attachments').appendChild(makeThumb(a));
});
socket.on('attachment:deleted', ({ id, channel_id, item_type, item_id }) => {
  if (channel_id !== activeId) return;
  const li = itemListFor(item_type).querySelector(`[data-id="${item_id}"]`);
  const thumb = li && li.querySelector(`.attach-thumb[data-id="${id}"]`);
  if (thumb) thumb.remove();
});

// ---------- Boot ----------
async function boot() {
  ensureName();
  await loadChannels();
  const match = location.hash.match(/#\/channel\/(\w+)/);
  if (match) openChannel(match[1]);
  else if (mobileMQ.matches) appEl.classList.add('drawer-left'); // start on the channel list
}
boot();
