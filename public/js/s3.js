function setStatus(el, ok, message) {
  el.textContent = message;
  el.className = 'status show ' + (ok ? 'ok' : 'err');
}

function formatBytes(n) {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function badge(value) {
  return value
    ? '<span class="badge yes">set</span>'
    : '<span class="badge no">not set</span>';
}

function renderConfig(c) {
  const el = document.getElementById('config');
  if (!c.configured) {
    el.innerHTML =
      '<dd class="muted">Not configured. Set <code>AWS_REGION</code> and <code>S3_BUCKET</code> (and AWS credentials).</dd>';
    return;
  }
  const rows = [
    ['Region', c.region || '—'],
    ['Bucket', c.bucket || '—'],
    ['Credentials', c.credentialsSet ? badge(true) : 'default chain'],
  ];
  el.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/s3/config');
    const data = await res.json();
    if (data.ok) renderConfig(data.config);
  } catch (err) {
    document.getElementById('config').innerHTML =
      `<dd class="muted">Could not load config: ${err.message}</dd>`;
  }
}
loadConfig();

const listBtn = document.getElementById('list-btn');
const listStatus = document.getElementById('list-status');
const objects = document.getElementById('objects');

async function listObjects() {
  const prefix = document.getElementById('prefix').value.trim();
  listBtn.disabled = true;
  objects.innerHTML = '';
  try {
    const url = '/api/s3/list' + (prefix ? `?prefix=${encodeURIComponent(prefix)}` : '');
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setStatus(listStatus, false, data.error || `Request failed (${res.status}).`);
      return;
    }
    const note = data.isTruncated ? ' (truncated — first 1000 shown)' : '';
    setStatus(listStatus, true, `${data.objects.length} object(s)${note}.`);
    renderObjects(data.objects);
  } catch (err) {
    setStatus(listStatus, false, err.message);
  } finally {
    listBtn.disabled = false;
  }
}

function renderObjects(items) {
  if (!items.length) {
    objects.innerHTML = '<p class="muted">No objects in bucket.</p>';
    return;
  }
  const rows = items
    .map((o) => {
      const modified = o.lastModified ? new Date(o.lastModified).toLocaleString() : '';
      return `<tr>
        <td>${escapeHtml(o.key)}</td>
        <td>${formatBytes(o.size)}</td>
        <td>${modified}</td>
        <td><button class="secondary" data-key="${escapeHtml(o.key)}">Delete</button></td>
      </tr>`;
    })
    .join('');
  objects.innerHTML =
    `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Size</th><th>Last modified</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  objects.querySelectorAll('button[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => deleteObject(btn.dataset.key));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function deleteObject(key) {
  if (!confirm(`Delete "${key}"?`)) return;
  try {
    const res = await fetch('/api/s3/object', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(listStatus, true, `Deleted "${key}".`);
      listObjects();
    } else {
      setStatus(listStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(listStatus, false, err.message);
  }
}

listBtn.addEventListener('click', listObjects);

const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
uploadBtn.addEventListener('click', async () => {
  const fileInput = document.getElementById('file');
  const key = document.getElementById('key').value.trim();
  if (!fileInput.files.length) {
    setStatus(uploadStatus, false, 'Choose a file first.');
    return;
  }
  const form = new FormData();
  form.append('file', fileInput.files[0]);
  if (key) form.append('key', key);

  uploadBtn.disabled = true;
  try {
    const res = await fetch('/api/s3/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(uploadStatus, true, `Uploaded "${data.key}".`);
      fileInput.value = '';
      document.getElementById('key').value = '';
      listObjects();
    } else {
      setStatus(uploadStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(uploadStatus, false, err.message);
  } finally {
    uploadBtn.disabled = false;
  }
});
