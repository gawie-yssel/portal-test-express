function setStatus(el, ok, message) {
  el.textContent = message;
  el.className = 'status show ' + (ok ? 'ok' : 'err');
}

function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function badge(value) {
  return value
    ? '<span class="badge yes">yes</span>'
    : '<span class="badge no">no</span>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderConfig(c) {
  const el = document.getElementById('config');
  if (!c.configured) {
    el.innerHTML =
      '<dd class="muted">Not configured. Set <code>DISK_PATH</code> to the mounted volume path.</dd>';
    return;
  }
  const rows = [
    ['Path', escapeHtml(c.path || '—')],
    ['Exists', badge(c.exists)],
    ['Is directory', badge(c.isDirectory)],
    ['Writable', badge(c.writable)],
  ];
  el.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/disk/config');
    const data = await res.json();
    if (data.ok) renderConfig(data.config);
  } catch (err) {
    document.getElementById('config').innerHTML =
      `<dd class="muted">Could not load config: ${err.message}</dd>`;
  }
}
loadConfig();

// --- Health check ---
const healthBtn = document.getElementById('health-btn');
const healthStatus = document.getElementById('health-status');
healthBtn.addEventListener('click', async () => {
  healthBtn.disabled = true;
  try {
    const res = await fetch('/api/disk/health');
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(healthStatus, true, `OK — wrote and verified ${formatBytes(data.bytes)} in ${data.durationMs} ms.`);
    } else {
      setStatus(healthStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(healthStatus, false, err.message);
  } finally {
    healthBtn.disabled = false;
  }
});

// --- Capacity ---
const statsBtn = document.getElementById('stats-btn');
const statsStatus = document.getElementById('stats-status');
const stats = document.getElementById('stats');
statsBtn.addEventListener('click', async () => {
  statsBtn.disabled = true;
  stats.innerHTML = '';
  try {
    const res = await fetch('/api/disk/stats');
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setStatus(statsStatus, false, data.error || `Request failed (${res.status}).`);
      return;
    }
    const pct = data.totalBytes ? Math.round((data.usedBytes / data.totalBytes) * 100) : 0;
    setStatus(statsStatus, true, `${pct}% used.`);
    stats.innerHTML =
      `<dl class="config">
        <dt>Total</dt><dd>${formatBytes(data.totalBytes)}</dd>
        <dt>Used</dt><dd>${formatBytes(data.usedBytes)} (${pct}%)</dd>
        <dt>Free</dt><dd>${formatBytes(data.freeBytes)}</dd>
      </dl>`;
  } catch (err) {
    setStatus(statsStatus, false, err.message);
  } finally {
    statsBtn.disabled = false;
  }
});

// --- List ---
const listBtn = document.getElementById('list-btn');
const listStatus = document.getElementById('list-status');
const entries = document.getElementById('entries');
const readResult = document.getElementById('read-result');

function currentPrefix() {
  return document.getElementById('prefix').value.trim();
}

function joinKey(prefix, name) {
  return prefix ? `${prefix.replace(/\/$/, '')}/${name}` : name;
}

async function listEntries() {
  const prefix = currentPrefix();
  listBtn.disabled = true;
  entries.innerHTML = '';
  readResult.innerHTML = '';
  try {
    const url = '/api/disk/list' + (prefix ? `?prefix=${encodeURIComponent(prefix)}` : '');
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setStatus(listStatus, false, data.error || `Request failed (${res.status}).`);
      return;
    }
    setStatus(listStatus, true, `${data.entries.length} entr${data.entries.length === 1 ? 'y' : 'ies'}.`);
    renderEntries(data.entries, prefix);
  } catch (err) {
    setStatus(listStatus, false, err.message);
  } finally {
    listBtn.disabled = false;
  }
}

function renderEntries(items, prefix) {
  if (!items.length) {
    entries.innerHTML = '<p class="muted">Empty directory.</p>';
    return;
  }
  const rows = items
    .map((e) => {
      const key = joinKey(prefix, e.name);
      const modified = e.mtime ? new Date(e.mtime).toLocaleString() : '';
      const type = e.isDir ? 'dir' : 'file';
      const actions = e.isDir
        ? `<button class="secondary" data-open="${escapeHtml(key)}">Open</button>`
        : `<button class="secondary" data-read="${escapeHtml(key)}">Read</button>
           <button class="secondary" data-del="${escapeHtml(key)}">Delete</button>`;
      return `<tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${type}</td>
        <td>${e.isDir ? '—' : formatBytes(e.size)}</td>
        <td>${modified}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');
  entries.innerHTML =
    `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  entries.querySelectorAll('button[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('prefix').value = btn.dataset.open;
      listEntries();
    });
  });
  entries.querySelectorAll('button[data-read]').forEach((btn) => {
    btn.addEventListener('click', () => readFile(btn.dataset.read));
  });
  entries.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteFile(btn.dataset.del));
  });
}

async function readFile(key) {
  readResult.innerHTML = '';
  try {
    const res = await fetch('/api/disk/read?key=' + encodeURIComponent(key));
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setStatus(listStatus, false, data.error || `Request failed (${res.status}).`);
      return;
    }
    const note = data.truncated ? ` (showing first ${formatBytes(64 * 1024)} of ${formatBytes(data.size)})` : '';
    setStatus(listStatus, true, `Read "${key}"${note}.`);
    readResult.innerHTML =
      `<label style="margin-top:0.75rem;">Contents of <code>${escapeHtml(key)}</code></label>
       <pre class="table-wrap" style="padding:0.6rem; white-space:pre-wrap; word-break:break-word;">${escapeHtml(data.content)}</pre>`;
  } catch (err) {
    setStatus(listStatus, false, err.message);
  }
}

async function deleteFile(key) {
  if (!confirm(`Delete "${key}"?`)) return;
  try {
    const res = await fetch('/api/disk/object', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(listStatus, true, `Deleted "${key}".`);
      listEntries();
    } else {
      setStatus(listStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(listStatus, false, err.message);
  }
}

listBtn.addEventListener('click', listEntries);

// --- Write ---
const writeBtn = document.getElementById('write-btn');
const writeStatus = document.getElementById('write-status');
writeBtn.addEventListener('click', async () => {
  const fileInput = document.getElementById('file');
  const key = document.getElementById('key').value.trim();
  if (!fileInput.files.length) {
    setStatus(writeStatus, false, 'Choose a file first.');
    return;
  }
  const form = new FormData();
  form.append('file', fileInput.files[0]);
  if (key) form.append('key', key);

  writeBtn.disabled = true;
  try {
    const res = await fetch('/api/disk/write', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(writeStatus, true, `Wrote "${data.key}" (${formatBytes(data.bytes)}).`);
      fileInput.value = '';
      document.getElementById('key').value = '';
      listEntries();
    } else {
      setStatus(writeStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(writeStatus, false, err.message);
  } finally {
    writeBtn.disabled = false;
  }
});
