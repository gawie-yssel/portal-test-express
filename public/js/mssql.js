function setStatus(el, ok, message) {
  el.textContent = message;
  el.className = 'status show ' + (ok ? 'ok' : 'err');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Result values are server data, so escape them — a query can return anything.
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
  return escapeHtml(String(value));
}

function renderTable(container, fields, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="muted">Query returned no rows.</p>';
    return;
  }
  const cols = fields.length ? fields.map((f) => f.name) : Object.keys(rows[0]);
  const head = cols.map((c) => `<th>${cell(c)}</th>`).join('');
  const body = rows
    .map((r) => '<tr>' + cols.map((c) => `<td>${cell(r[c])}</td>`).join('') + '</tr>')
    .join('');
  container.innerHTML =
    `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json().catch(() => ({})) };
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
      '<dd class="muted">Not configured. Set <code>MSSQL_CONNECTION_STRING</code> or <code>MSSQL_HOST/MSSQL_USER/MSSQL_DATABASE</code>.</dd>';
    return;
  }
  // An unparseable connection string leaves the flags undefined — show "—"
  // rather than a misleading "disabled".
  const tri = (v) => (v === undefined || v === null ? '—' : v ? 'enabled' : 'disabled');
  const rows = [
    ['Source', escapeHtml(c.source)],
    ['Server', escapeHtml(c.host || '—')],
    ['Port', escapeHtml(c.port || '—')],
    ['User', escapeHtml(c.user || '—')],
    ['Database', escapeHtml(c.database || '—')],
    ['Encrypt', tri(c.encrypt)],
    ['Trust server certificate', tri(c.trustServerCertificate)],
    ['Password', badge(c.passwordSet)],
  ];
  el.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  if (c.parseError) {
    el.innerHTML +=
      '<dd class="muted">Could not parse <code>MSSQL_CONNECTION_STRING</code>. Only the ADO form is supported, e.g. <code>Server=host,1433;Database=db;User Id=me;Password=…</code></dd>';
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/mssql/config');
    const data = await res.json();
    if (data.ok) renderConfig(data.config);
  } catch (err) {
    document.getElementById('config').innerHTML =
      `<dd class="muted">Could not load config: ${err.message}</dd>`;
  }
}
loadConfig();

const pingBtn = document.getElementById('ping-btn');
const pingStatus = document.getElementById('ping-status');
pingBtn.addEventListener('click', async () => {
  pingBtn.disabled = true;
  try {
    const res = await fetch('/api/mssql/ping');
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStatus(pingStatus, true, `Connected.\n${data.version}\nServer time: ${data.serverTime}`);
    } else {
      setStatus(pingStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(pingStatus, false, err.message);
  } finally {
    pingBtn.disabled = false;
  }
});

const runBtn = document.getElementById('run-btn');
const queryStatus = document.getElementById('query-status');
const results = document.getElementById('results');
runBtn.addEventListener('click', async () => {
  const sql = document.getElementById('sql').value;
  results.innerHTML = '';
  if (!sql.trim()) {
    setStatus(queryStatus, false, 'Enter a SQL query first.');
    return;
  }
  runBtn.disabled = true;
  try {
    const { res, data } = await postJson('/api/mssql/query', { sql });
    if (data.ok) {
      setStatus(queryStatus, true, `Success — ${data.rowCount} row(s).`);
      renderTable(results, data.fields || [], data.rows || []);
    } else {
      setStatus(queryStatus, false, data.error || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus(queryStatus, false, err.message);
  } finally {
    runBtn.disabled = false;
  }
});
