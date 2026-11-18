// Gateway unificado das calculadoras RTC da Receita Federal.
// Zero dependencias: so Node.js >= 18.
//
//   /                      -> portal web (pasta ../web)
//   /svc/regular/...       -> calculadora-rtc-regime-regular  (http://localhost:8080/api/...)
//   /svc/simples/...       -> calculadora-rtc-simples-nacional (http://localhost:8082/api/...)
//   /svc/danfse/...        -> calculadora-rtc-gerador-danfse   (http://localhost:8081/api/...)
//   /status                -> saude dos 3 servicos
//
// Como tudo sai pela mesma origem, o navegador nao esbarra em CORS.

const http = require('http');
const fs = require('fs');
const path = require('path');
const reverso = require('./reverso');

const PORT = Number(process.env.GATEWAY_PORT || 8090);
const SERVICES = {
  regular: { name: 'Regime Regular (CBS/IBS/IS)', base: process.env.RTC_REGULAR_URL || 'http://localhost:8080/api', health: '/calculadora/dados-abertos/versao' },
  simples: { name: 'Simples Nacional (CBS/IBS)', base: process.env.RTC_SIMPLES_URL || 'http://localhost:8082/api', health: '/versao' },
  danfse:  { name: 'Gerador DANFSe (PDF NFS-e)', base: process.env.RTC_DANFSE_URL || 'http://localhost:8081', health: '/health/live' },
};
const WEB_DIR = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml' };
const MAX_BODY = 32 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('corpo muito grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function probe(svc) {
  const t0 = Date.now();
  try {
    const r = await fetch(svc.base + svc.health, { signal: AbortSignal.timeout(2500) });
    return { online: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { online: false, error: e.cause?.code || e.name, ms: Date.now() - t0 };
  }
}

async function proxy(req, res, key, rest) {
  const svc = SERVICES[key];
  const target = svc.base + rest;
  const headers = {};
  for (const h of ['content-type', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const r = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(60000) });
    const out = Buffer.from(await r.arrayBuffer());
    const pass = {};
    for (const h of ['content-type', 'content-disposition', 'x-warning-dados-simulados']) { const v = r.headers.get(h); if (v) pass[h] = v; }
    pass['access-control-expose-headers'] = 'x-warning-dados-simulados';
    res.writeHead(r.status, pass); res.end(out);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ erro: `Servico "${svc.name}" indisponivel em ${svc.base}`, detalhe: e.cause?.code || e.message }));
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('nao encontrado'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/status') {
    const keys = Object.keys(SERVICES);
    const results = await Promise.all(keys.map(k => probe(SERVICES[k])));
    const body = Object.fromEntries(keys.map((k, i) => [k, { nome: SERVICES[k].name, url: SERVICES[k].base, ...results[i] }]));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  if (u.pathname === '/reverso' || u.pathname === '/reverso/listagem') {
    const data = u.searchParams.get('data') || new Date().toISOString().slice(0, 10);
    const tipo = u.searchParams.get('tipo');
    try {
      if (u.pathname === '/reverso') {
        if (!['ncm', 'nbs', 'cst'].includes(tipo)) throw Object.assign(new Error('tipo deve ser ncm, nbs ou cst'), { status: 400 });
        const corpo = JSON.stringify(reverso.consultar(tipo, u.searchParams.get('codigo'), data));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(corpo);
      }
      if (!['ncm', 'nbs', 'cst', 'genericas'].includes(tipo)) throw Object.assign(new Error('tipo deve ser ncm, nbs, cst ou genericas'), { status: 400 });
      const corpo = reverso.listagem(tipo, data);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cclasstrib-por-${tipo}-${data}.csv"` });
      return res.end(corpo);
    } catch (e) {
      if (!e.status) console.error(e);
      res.writeHead(e.status || 500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: e.message }));
    }
  }
  const m = u.pathname.match(/^\/svc\/(regular|simples|danfse)(\/.*)?$/);
  if (m) return proxy(req, res, m[1], (m[2] || '/') + u.search);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, u.pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portal RTC unificado: http://localhost:${PORT}`);
  for (const [k, s] of Object.entries(SERVICES)) console.log(`  /svc/${k.padEnd(8)} -> ${s.base}`);
});
