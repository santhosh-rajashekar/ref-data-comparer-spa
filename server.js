/* RDM Ref-Data Comparer — local dev server + JIRA CORS proxy
 * ─────────────────────────────────────────────────────────────
 * Zero dependencies — uses Node 18+ built-in http + fetch.
 *
 * Usage:
 *   node server.js            →  http://localhost:8787
 *
 * What it does:
 *   • Serves every file under this directory as a static asset
 *     (index.html, css/, js/, data/ etc.)
 *   • Exposes two JIRA proxy endpoints that forward requests
 *     server-side, bypassing the browser CORS restriction:
 *       GET  /api/jira/myself  — connection test
 *       POST /api/jira/issue   — create a JIRA ticket
 *
 *   The browser still builds the Authorization header (Basic for
 *   JIRA Cloud, Bearer PAT for Server/DC) and passes the target
 *   JIRA base URL via X-Jira-Base-Url. Credentials are never
 *   stored server-side — relayed per-request only.
 *
 * TLS/corporate proxy:
 *   If you see SELF_SIGNED_CERT_IN_CHAIN errors, run:
 *     set NODE_EXTRA_CA_CERTS=C:\path\to\corporate-ca.pem   (Windows)
 *     export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem  (macOS/Linux)
 *   Quick test-only bypass (never use long-term):
 *     set NODE_TLS_REJECT_UNAUTHORIZED=0
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = process.env.PORT || 8787;
const ROOT    = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.json': 'application/json',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
  '.svg' : 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Jira-Base-Url');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end',  ()    => resolve(body));
    req.on('error', reject);
  });
}

async function proxyToJira(req, res, jiraPath) {
  const baseUrl = req.headers['x-jira-base-url'];
  const auth    = req.headers['authorization'];
  if (!baseUrl || !auth) {
    setCors(res);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing X-Jira-Base-Url or Authorization header' }));
    return;
  }
  try {
    const body   = req.method === 'GET' ? undefined : await readBody(req);
    const target = baseUrl.replace(/\/+$/, '') + jiraPath;
    const opts   = {
      method:  req.method,
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    if (body) opts.body = body;
    console.log(`[jira-proxy] ${req.method} ${target}`);
    const r    = await fetch(target, opts);
    const text = await r.text();
    setCors(res);
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (e) {
    const cause = e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : null;
    console.error('[jira-proxy] error:', e.message, cause ? `| cause: ${cause}` : '', e.cause || '');
    setCors(res);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${e.message}${cause ? ` (${cause})` : ''}` }));
  }
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  // Safety: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];
  if (url === '/api/jira/myself' && req.method === 'GET')  return proxyToJira(req, res, '/rest/api/2/myself');
  if (url === '/api/jira/issue'  && req.method === 'POST') return proxyToJira(req, res, '/rest/api/2/issue');

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  RDM Ref-Data Comparer  →  http://localhost:${PORT}`);
  console.log(`  JIRA proxy endpoints   →  /api/jira/myself  |  /api/jira/issue`);
  console.log(`  Serving: ${ROOT}\n`);
});
