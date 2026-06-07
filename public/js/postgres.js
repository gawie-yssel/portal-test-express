function setStatus(el, ok, message) {
  el.textContent = message;
  el.className = 'status show ' + (ok ? 'ok' : 'err');
}

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
      '<dd class="muted">Not configured. Set <code>DATABASE_URL</code> or <code>PGHOST/PGUSER/PGDATABASE</code>.</dd>';
    return;
  }
  const rows = [
    ['Source', c.source],
    ['Host', c.host || '—'],
    ['Port', c.port || '—'],
    ['User', c.user || '—'],
    ['Database', c.database || '—'],
    ['SSL', c.ssl ? 'enabled' : 'disabled'],
    ['Password', badge(c.passwordSet)],
  ];
  el.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/postgres/config');
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
    const res = await fetch('/api/postgres/ping');
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
    const { res, data } = await postJson('/api/postgres/query', { sql });
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
