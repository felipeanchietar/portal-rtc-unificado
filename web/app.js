// Portal RTC Unificado — logica do front. Fala apenas com o gateway (/svc/*, /status).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = v => (v === undefined || v === null || v === '' || isNaN(+v)) ? '—' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

// ---------- abas ----------
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === t.dataset.tab));
  try { localStorage.setItem('rtc-tab', t.dataset.tab); } catch {}
}));
try { const t = localStorage.getItem('rtc-tab'); if (t) document.querySelector(`.tab[data-tab="${t}"]`)?.click(); } catch {}

// ---------- status dos servicos ----------
async function atualizarStatus() {
  let st;
  try { st = await (await fetch('/status')).json(); } catch { return; }
  $('#status-pills').innerHTML = Object.entries(st).map(([k, s]) =>
    `<span class="pill ${s.online ? 'on' : 'off'}" title="${esc(s.url)}">${s.online ? '●' : '○'} ${esc(s.nome.split(' (')[0])}</span>`).join('');
  for (const [k, s] of Object.entries(st)) {
    const el = document.querySelector(`.svc[data-svc="${k}"] .state`);
    if (el) { el.className = 'state ' + (s.online ? 'on' : 'off'); el.textContent = s.online ? `Online · ${s.ms} ms` : `Offline (${s.error || s.status}) — rode start.ps1`; }
  }
}
atualizarStatus(); setInterval(atualizarStatus, 10000);

// ---------- chamada generica ----------
async function call(url, opts = {}) {
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => null) : ct.includes('pdf') ? await r.blob() : await r.text();
  return { ok: r.ok, status: r.status, body, warning: r.headers.get('x-warning-dados-simulados') };
}
function erroTexto(res) {
  const b = res.body;
  if (b && typeof b === 'object' && !(b instanceof Blob)) {
    const partes = [b.erro, b.title, b.detail, b.message, b.mensagem, b.detalhe].filter(Boolean);
    const lista = (b.erros || b.errors || b.objects || []).map?.(e => `• ${e.code || ''} ${e.detail || e.message || e.title || JSON.stringify(e)}`) || [];
    return `HTTP ${res.status} — ${partes.join(' · ') || ''}\n${lista.join('\n')}`.trim() || JSON.stringify(b, null, 2);
  }
  return `HTTP ${res.status} — ${typeof b === 'string' ? b.slice(0, 800) : ''}`;
}
function busy(btn, on) { btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Aguarde…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

// ---------- roteamento por regime ----------
const EXEMPLOS = {
  regular: [
    { numero: 1, ncm: '10063021', cst: '200', cClassTrib: '200003', baseCalculo: 100.00, quantidade: 20, unidade: 'KG', aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } },
    { numero: 2, ncm: '22030000', cst: '000', cClassTrib: '000001', quantidade: 12, unidade: 'LT',
      impostoSeletivo: { cst: '000', cClassTrib: '000001', baseCalculo: 150.00, quantidade: 12, unidade: 'LT', impostoInformado: 15.00 },
      aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05, impostoSeletivo: { adValorem: 10.0 } } },
    { numero: 3, nbs: '122011200', cst: '200', cClassTrib: '200028', baseCalculo: 1200.00, aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } },
  ],
  simples: [
    { numero: 1, cAtivSN: '01', cClassTrib: '000001', baseCalculo: '950.00', valorImpostoSeletivo: '0.00', pIBSSN: '1.25', pCBSSN: '2.75' },
    { numero: 2, cAtivSN: '01', cClassTrib: '000001', baseCalculo: '300.00', valorImpostoSeletivo: '0.00', pIBSSN: '1.25', pCBSSN: '2.75' },
  ],
};
const AJUDA = {
  regular: 'Cada item: ncm ou nbs, cst, cClassTrib, baseCalculo e, a partir de 2027, aliquotasNominais (cbs, ibsEstadual, ibsMunicipal). Em 2026 as alíquotas vêm da base oficial e aliquotasNominais é proibido.',
  simples: 'Cada item: cAtivSN (atividade do Simples, 2 dígitos), cClassTrib, baseCalculo (sem IS), valorImpostoSeletivo, pIBSSN e pCBSSN (alíquotas efetivas do Simples em pontos percentuais). Valores como texto.',
};
let regimeAtual = null;
function destino() {
  const crt = $('#crt').value;
  if (crt === '3' && $('#tpRegime').value === '1') return 'regular';
  return 'simples';
}
function aplicarRegime(forcarExemplo) {
  const crt = $('#crt').value;
  $('#lbl-tpregime').classList.toggle('hidden', crt !== '3');
  const d = destino();
  $$('.only-regular').forEach(e => e.classList.toggle('hidden', d !== 'regular'));
  $$('.only-simples').forEach(e => e.classList.toggle('hidden', d !== 'simples'));
  $('#rota').innerHTML = d === 'regular'
    ? '➜ Este cálculo vai para a <b>Calculadora do Regime Regular</b> (CBS + IBS UF/Município + Imposto Seletivo).'
    : `➜ Este cálculo vai para a <b>Calculadora do Simples Nacional</b> (CRT ${crt}${crt === '3' ? ', apuração do IBS/CBS por fora' : ''}).`;
  $('#itens-help').textContent = AJUDA[d];
  if (d !== regimeAtual || forcarExemplo) { $('#itens').value = JSON.stringify(EXEMPLOS[d], null, 2); regimeAtual = d; }
}
$('#crt').addEventListener('change', () => aplicarRegime());
$('#tpRegime').addEventListener('change', () => aplicarRegime());
$('#btn-exemplo').addEventListener('click', () => aplicarRegime(true));
$('#btn-formatar').addEventListener('click', () => { try { $('#itens').value = JSON.stringify(JSON.parse($('#itens').value), null, 2); } catch (e) { alert('JSON inválido: ' + e.message); } });
aplicarRegime(true);

function montarOperacao() {
  let itens;
  try { itens = JSON.parse($('#itens').value); } catch (e) { throw new Error('JSON dos itens inválido: ' + e.message); }
  if (!Array.isArray(itens)) itens = [itens];
  const data = $('#data').value;
  if (destino() === 'regular') {
    return { id: uid(), versao: '1.0.0', dhFatoGerador: `${data}T10:00:00-03:00`, municipio: Number($('#municipio').value), uf: $('#uf').value.toUpperCase(), itens };
  }
  const op = { id: uid(), versao: '2.0.0', data, tpDoc: $('#tpDoc').value, CRT: $('#crt').value, itens };
  if ($('#crt').value === '3') op.tpRegimeIBSCBS = '2';
  if ($('#tpEnteGov').value) op.tpEnteGov = $('#tpEnteGov').value;
  return op;
}

// busca em profundidade a primeira ocorrencia de uma chave
function pick(o, key) {
  if (!o || typeof o !== 'object') return undefined;
  if (key in o && typeof o[key] !== 'object') return o[key];
  for (const v of Object.values(o)) { const r = pick(v, key); if (r !== undefined) return r; }
}
function folhas(o, pre = '', out = []) {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) folhas(v, k, out);
  else if (o !== undefined && !isNaN(+o)) out.push([pre, o]);
  return out;
}
const ROTULOS = { vBCIBSCBS: 'Base CBS/IBS', vIBS: 'IBS total', vCBS: 'CBS total', vIS: 'Imposto Seletivo', vRBSNtot: 'Receita bruta SN', vBC: 'Base de cálculo',
  vIBSSNtot: 'IBS (Simples)', vCBSSNtot: 'CBS (Simples)', vIBSSNtotPendSusp: 'IBS pend./susp.', vCBSSNtotPendSusp: 'CBS pend./susp.', vIBSUF: 'IBS UF', vIBSMun: 'IBS Município' };
// totais relevantes: os rotulados sempre, os demais só se diferentes de zero; sem chaves repetidas
function totaisPrincipais(total) {
  const vistos = new Set();
  return folhas(total || {}).filter(([k, v]) => k.startsWith('v') && (k in ROTULOS || +v !== 0) && !vistos.has(k) && vistos.add(k));
}
function estadoClasse(e) { return /^CALCULADO|CALCULO_SIMULADO/.test(e) ? 'ok' : /NAO_CALCULADO|NAO_IMPLEMENTADO/.test(e) ? 'mid' : 'bad'; }

function renderResultado(d, res) {
  $('#resultado-card').hidden = false;
  const b = res.body;
  $('#res-json').textContent = JSON.stringify(b, null, 2);
  $('#warn').hidden = !res.warning; $('#warn').textContent = res.warning ? '⚠ ' + decodeURIComponent(res.warning) : '';
  const badge = $('#res-badge');
  if (!res.ok || !b || !b.objetos) {
    badge.className = 'badge bad'; badge.textContent = `Erro HTTP ${res.status}`;
    $('#totais').innerHTML = ''; $('#res-tabela').innerHTML = `<tr><td><div class="err">${esc(erroTexto(res))}</div></td></tr>`;
    return;
  }
  badge.className = 'badge ok'; badge.textContent = d === 'regular' ? 'Regime Regular' : 'Simples Nacional';
  const tot = totaisPrincipais(b.total);
  $('#totais').innerHTML = tot.map(([k, v]) => `<div class="kpi"><div class="k">${esc(ROTULOS[k] || k)}</div><div class="v">R$ ${brl(v)}</div></div>`).join('') || '<p class="muted">Sem totais (nenhum item calculado).</p>';
  const cols = d === 'regular'
    ? [['vBC', 'Base'], ['pCBS', 'Alíq. CBS %'], ['vCBS', 'CBS'], ['vIBSUF', 'IBS UF'], ['vIBSMun', 'IBS Mun.'], ['vIBS', 'IBS'], ['vIS', 'IS']]
    : [['vRBSNitem', 'Receita bruta'], ['tpRBSNDescricao', 'Tipo receita'], ['pCBSSN', 'Alíq. CBS %'], ['vCBSSN', 'CBS'], ['pIBSSN', 'Alíq. IBS %'], ['vIBSSN', 'IBS']];
  const head = `<tr><th>Item</th><th>Estado</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>Observações</th></tr>`;
  const rows = b.objetos.map(o => {
    const t = o.tribCalc || {};
    const erros = (o.erros || []).map(e => `<div><b>${esc(e.code)}</b> ${esc(e.detail || e.title)}</div>`).join('');
    const cst = pick(t, 'CST'), cc = pick(t, 'cClassTrib');
    return `<tr><td>${o.nObj}</td><td><span class="st ${estadoClasse(o.estadoItem)}">${esc(o.estadoItem)}</span>${cst ? `<div class="muted small">CST ${esc(cst)} · ${esc(cc)}</div>` : ''}</td>${
      cols.map(([k]) => { const v = pick(t, k); return k === 'tpRBSNDescricao' ? `<td>${esc(v ?? '—')}</td>` : `<td class="num">${brl(v)}</td>`; }).join('')}<td>${erros}</td></tr>`;
  }).join('');
  $('#res-tabela').innerHTML = head + rows;
}

$('#btn-calcular').addEventListener('click', async e => {
  const btn = e.currentTarget; busy(btn, true); $('#xml-card').hidden = true;
  try {
    const d = destino(); const op = montarOperacao();
    const url = d === 'regular' ? '/svc/regular/calculadora/observabilidade/regime-geral' : '/svc/simples/calculadora/observabilidade/simples-nacional';
    const res = await call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) });
    renderResultado(d, res);
    ultimoCalculo = res.ok && res.body?.objetos ? { d, op, res, quando: new Date() } : null;
    ultimoXml = '';
    $('#btn-pdf-calc').hidden = !ultimoCalculo;
    $('#resultado-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { renderResultado(destino(), { ok: false, status: 0, body: { erro: err.message } }); }
  finally { busy(btn, false); }
});

// ---------- PDF do cálculo (demonstrativo, NÃO é documento fiscal) ----------
let ultimoCalculo = null;
function coletar(o, chave, out = []) {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === chave && typeof v === 'string') out.push(v); else coletar(v, chave, out); }
  return out;
}
function relatorioHtml({ d, op, res, quando }, xml) {
  const b = res.body, regular = d === 'regular';
  const dataFato = regular ? op.dhFatoGerador.slice(0, 10) : op.data;
  const cab = regular
    ? [['Calculadora', 'Regime Regular — CBS, IBS e Imposto Seletivo'], ['CRT', '3 — Regime Normal'], ['Data do fato gerador', dataFato.split('-').reverse().join('/')], ['Município (IBGE) / UF', `${op.municipio} / ${op.uf}`]]
    : [['Calculadora', 'Simples Nacional — CBS e IBS (NT 2026.005)'], ['CRT', op.CRT + (op.tpRegimeIBSCBS ? ' (apuração por fora)' : '')], ['Data do fato gerador', dataFato.split('-').reverse().join('/')], ['Documento (tpDoc)', op.tpDoc + (op.tpEnteGov ? ` · compra governamental (ente ${op.tpEnteGov})` : '')]];
  const cols = regular
    ? [['vBC', 'Base'], ['pCBS', 'Alíq. CBS %'], ['vCBS', 'CBS'], ['vIBSUF', 'IBS UF'], ['vIBSMun', 'IBS Mun.'], ['vIBS', 'IBS'], ['vIS', 'IS']]
    : [['vRBSNitem', 'Receita bruta'], ['pCBSSN', 'Alíq. CBS %'], ['vCBSSN', 'CBS'], ['pIBSSN', 'Alíq. IBS %'], ['vIBSSN', 'IBS']];
  const entrada = Object.fromEntries((op.itens || []).map(i => [i.numero, i]));
  const linhas = b.objetos.map(o => {
    const t = o.tribCalc || {}, i = entrada[o.nObj] || {};
    const ident = [i.ncm && 'NCM ' + i.ncm, i.nbs && 'NBS ' + i.nbs, i.cAtivSN && 'Ativ. ' + i.cAtivSN].filter(Boolean).join(' · ');
    const cc = pick(t, 'cClassTrib') || i.cClassTrib, cst = pick(t, 'CST') || i.cst;
    return `<tr><td>${o.nObj}</td><td>${esc(ident)}<br><small>${cst ? 'CST ' + esc(cst) + ' · ' : ''}cClassTrib ${esc(cc)}</small></td><td>${esc(o.estadoItem)}${(o.erros || []).map(e => `<br><small class="e">${esc(e.code)} ${esc(e.detail || e.title)}</small>`).join('')}</td>${
      cols.map(([k]) => `<td class="n">${brl(pick(t, k))}</td>`).join('')}</tr>`;
  }).join('');
  const tot = totaisPrincipais(b.total);
  const memorias = b.objetos.flatMap(o => [...new Set(coletar(o.tribCalc, 'memoriaCalculo').map(m => m.trim()))].map(m => [o.nObj, m]));
  const simulado = res.warning || b.objetos.some(o => o.estadoItem === 'CALCULO_SIMULADO');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Demonstrativo de cálculo CBS-IBS ${dataFato}</title><style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; } body { font: 10.5px/1.45 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 17px; margin: 0; } h2 { font-size: 12px; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #999; text-transform: uppercase; letter-spacing: .4px; }
    .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b6e4f; padding-bottom: 8px; }
    .aviso { margin-top: 8px; padding: 6px 8px; border: 1px solid #c99a00; background: #fff8dc; font-size: 10px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; margin-top: 8px; } .meta div span { color: #555; }
    table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ddd; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #f1f4f3; font-size: 9.5px; } td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    small { color: #555; } small.e { color: #b42318; }
    .tot { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; } .tot div { border: 1px solid #ccc; border-radius: 4px; padding: 5px 7px; }
    .tot b { display: block; font-size: 13px; } pre { white-space: pre-wrap; word-break: break-all; font: 8.5px/1.35 Consolas, monospace; background: #f6f6f6; padding: 6px; margin: 0 0 6px; }
    .rodape { margin-top: 18px; font-size: 9px; color: #666; border-top: 1px solid #ccc; padding-top: 5px; }
    tr, .tot div, pre { break-inside: avoid; }
  </style></head><body>
    <div class="topo"><div><h1>Demonstrativo de cálculo — CBS / IBS${regular ? ' / IS' : ''}</h1><div>Reforma Tributária do Consumo · LC 214/2025</div></div>
      <div style="text-align:right">Gerado em ${quando.toLocaleString('pt-BR')}<br>Operação ${esc(op.id.slice(0, 12))}</div></div>
    <div class="aviso"><b>Não é documento fiscal.</b> Simulação feita com as calculadoras oficiais da Receita Federal (Portal RTC Unificado). Não substitui a NF-e, a NFS-e nem o DANFE/DANFSe e não tem validade para fins fiscais.${simulado ? ' Contém itens com cálculo SIMULADO a partir de alíquotas informadas.' : ''}</div>
    <div class="meta">${cab.map(([k, v]) => `<div><span>${k}:</span> <b>${esc(v)}</b></div>`).join('')}</div>
    <h2>Totais</h2><div class="tot">${tot.map(([k, v]) => `<div>${esc(ROTULOS[k] || k)}<b>R$ ${brl(v)}</b></div>`).join('') || 'Nenhum item calculado.'}</div>
    <h2>Itens</h2><table><tr><th>#</th><th>Identificação</th><th>Estado</th>${cols.map(c => `<th class="n">${c[1]}</th>`).join('')}</tr>${linhas}</table>
    ${memorias.length ? `<h2>Memória de cálculo</h2>${memorias.map(([n, m]) => `<pre>Item ${n}: ${esc(m)}</pre>`).join('')}` : ''}
    ${xml ? `<h2>XML do grupo de tributação</h2><pre>${esc(xml)}</pre>` : ''}
    <div class="rodape">Fontes: calculadora-rtc-${regular ? 'regime-regular' : 'simples-nacional'} (github.com/ReceitaFederal). Valores em R$.</div>
  </body></html>`;
}
$('#btn-pdf-calc').addEventListener('click', () => {
  if (!ultimoCalculo) return;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(relatorioHtml(ultimoCalculo, ultimoXml)); f.contentDocument.close();
  // o título do documento vira o nome sugerido do arquivo no "Salvar como PDF"
  const tituloOriginal = document.title; document.title = f.contentDocument.title;
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); document.title = tituloOriginal; setTimeout(() => f.remove(), 1000); }, 150);
});

// cálculo estrito -> XML do grupo -> validacao XSD
let ultimoXml = '';
$('#btn-xml').addEventListener('click', async e => {
  const btn = e.currentTarget; busy(btn, true);
  const card = $('#xml-card'), badge = $('#xml-badge'), out = $('#xml-out'); card.hidden = false;
  const tipo = $('#tipoXml').value;
  try {
    const op = montarOperacao();
    out.textContent = '1/3 Calculando (modo estrito: a operação falha no primeiro erro)…';
    const calc = await call('/svc/regular/calculadora/regime-geral', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) });
    if (!calc.ok) throw new Error('Cálculo recusado — ' + erroTexto(calc));
    out.textContent = '2/3 Gerando XML…';
    const gen = await call(`/svc/regular/calculadora/xml/generate?tipo=${encodeURIComponent(tipo)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calc.body) });
    if (!gen.ok) throw new Error('Geração do XML falhou — ' + erroTexto(gen));
    ultimoXml = typeof gen.body === 'string' ? gen.body : JSON.stringify(gen.body);
    out.textContent = ultimoXml;
    const val = await call(`/svc/regular/calculadora/xml/validate?tipo=${encodeURIComponent(tipo)}&subtipo=grupo`, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: ultimoXml });
    badge.className = 'badge ' + (val.ok ? 'ok' : 'bad');
    badge.textContent = val.ok ? `✓ Válido no XSD (${tipo})` : `✗ Inválido no XSD (${tipo})`;
    if (!val.ok) out.textContent = erroTexto(val) + '\n\n' + ultimoXml;
  } catch (err) { badge.className = 'badge bad'; badge.textContent = 'Erro'; out.textContent = err.message; }
  finally { busy(btn, false); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
$('#btn-baixar-xml').addEventListener('click', () => {
  if (!ultimoXml) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ultimoXml], { type: 'application/xml' }));
  a.download = `grupo-${$('#tipoXml').value}.xml`; a.click();
});

// ---------- DANFSe ----------
$('#nfse-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) $('#nfse-xml').value = await f.text(); });
let pdfUrl = null;
$('#btn-pdf').addEventListener('click', async e => {
  const btn = e.currentTarget, msg = $('#danfse-msg'); msg.innerHTML = '';
  const xml = $('#nfse-xml').value.trim();
  if (!xml) { msg.innerHTML = '<div class="err">Informe o XML da NFS-e.</div>'; return; }
  busy(btn, true);
  try {
    if ($('#validar-xsd').checked) {
      const v = await call('/svc/regular/calculadora/xml/validate?tipo=nfse&subtipo=nota', { method: 'POST', headers: { 'content-type': 'application/xml' }, body: xml });
      if (v.status === 502) msg.innerHTML += '<div class="warn">Regime Regular offline — validação XSD pulada.</div>';
      else if (!v.ok) { msg.innerHTML = `<div class="err">XML da NFS-e não passou no XSD:\n${esc(erroTexto(v))}\n\nDesmarque “Validar no XSD” para gerar o PDF mesmo assim.</div>`; return; }
      else msg.innerHTML += '<div class="okmsg">✓ NFS-e válida no XSD.</div>';
    }
    const q = new URLSearchParams({ stc: $('#stc').value, canhoto: $('#canhoto').checked });
    const r = await call(`/svc/danfse/api/danfse?${q}`, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: xml });
    if (!r.ok || !(r.body instanceof Blob)) { msg.innerHTML += `<div class="err">${esc(erroTexto(r))}</div>`; return; }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(r.body);
    $('#pdf-frame').src = pdfUrl; $('#pdf-link').href = pdfUrl; $('#pdf-card').hidden = false;
    $('#pdf-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { msg.innerHTML += `<div class="err">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});

// ---------- consulta reversa ----------
$('#r-data').value = new Date().toISOString().slice(0, 10);
const R_HINT = { ncm: 'ex.: 22030000', nbs: 'ex.: 122011200', cst: 'ex.: 200' };
$('#r-tipo').addEventListener('change', () => { $('#r-codigo').placeholder = R_HINT[$('#r-tipo').value]; });
function linkListagens() {
  for (const t of ['ncm', 'nbs', 'cst', 'genericas']) $('#dl-' + t).href = `/reverso/listagem?tipo=${t}&data=${$('#r-data').value}`;
}
$('#r-data').addEventListener('change', linkListagens); linkListagens();
function tabelaCClass(lista, extra) {
  if (!lista.length) return '<p class="muted">Nenhuma.</p>';
  return `<div class="table-wrap"><table><tr><th>cClassTrib</th><th>CST</th><th>Tributo</th><th>Descrição</th>${extra ? `<th>${extra[1]}</th>` : ''}</tr>${
    lista.map(c => `<tr class="r-linha"><td><b>${esc(c.cClassTrib)}</b></td><td>${esc(c.cst)}</td><td>${esc(c.tributo)}</td><td>${esc(c.descricao)}</td>${extra ? `<td>${esc(extra[0](c))}</td>` : ''}</tr>`).join('')}</table></div>`;
}
$('#btn-reverso').addEventListener('click', async e => {
  const btn = e.currentTarget; busy(btn, true); const out = $('#r-out');
  try {
    const q = new URLSearchParams({ tipo: $('#r-tipo').value, codigo: $('#r-codigo').value.trim(), data: $('#r-data').value });
    const r = await call('/reverso?' + q);
    if (!r.ok) { out.innerHTML = `<div class="err">${esc(erroTexto(r))}</div>`; return; }
    const b = r.body;
    if (b.tipo === 'cst') {
      const restr = [c => [c.anexoNcm && 'exige NCM do anexo', c.anexoNbs && 'exige NBS do anexo'].filter(Boolean).join(' · ') || `qualquer ${c.nomenclatura === 'Não possui' ? 'código' : c.nomenclatura}`, 'Restrição'];
      out.innerHTML = `<h3>CST ${esc(b.codigo)} — ${esc(b.cstDescricao || 'não encontrado')}</h3><p><b>${b.cClassTribs.length}</b> cClassTrib de CBS/IBS</p>` +
        tabelaCClass(b.cClassTribs, restr) +
        (b.cClassTribsIS.length ? `<details><summary>Imposto Seletivo: ${b.cClassTribsIS.length} cClassTrib com CST ${esc(b.codigo)} (${esc(b.cstDescricaoIS)})</summary>${tabelaCClass(b.cClassTribsIS, restr)}</details>` : '');
    } else {
      out.innerHTML = `<h3>${b.tipo.toUpperCase()} ${esc(b.codigo)}</h3><p class="muted">${esc(b.descricao || '(código não encontrado na tabela vigente)')}</p>
        <h3>Específicas: ${b.especificas.length}</h3><p class="muted small">O anexo da cClassTrib cobre este código, por isso o vínculo é aceito.</p>
        ${tabelaCClass(b.especificas, [c => c.vinculoPor, 'Vínculo pelo prefixo'])}
        <details><summary>Genéricas: ${b.genericas.length}. Não têm anexo de ${b.tipo.toUpperCase()}, então a calculadora aceita qualquer código.</summary>${tabelaCClass(b.genericas)}</details>`;
    }
    $('#r-filtro').dispatchEvent(new Event('input'));
  } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});
$('#r-codigo').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-reverso').click(); });
$('#r-filtro').addEventListener('input', () => {
  const f = $('#r-filtro').value.toLowerCase();
  $$('#r-out .r-linha').forEach(tr => { tr.style.display = !f || tr.textContent.toLowerCase().includes(f) ? '' : 'none'; });
});

// ---------- consultas ----------
const DA = '/svc/regular/calculadora/dados-abertos';
const CONSULTAS = {
  cclass: { hint: 'Código cClassTrib de 6 dígitos, ex.: 200028', url: (c, d) => `${DA}/classificacoes-tributarias/cbs-ibs/class-trib/${encodeURIComponent(c)}?data=${d}` },
  cst: { hint: 'Sem código — lista todos os CST de CBS/IBS vigentes na data', url: (c, d) => `${DA}/situacoes-tributarias/cbs-ibs?data=${d}` },
  ncm: { hint: 'NCM de 8 dígitos, ex.: 22030000', url: (c, d) => `${DA}/ncm?ncm=${encodeURIComponent(c)}&data=${d}` },
  nbs: { hint: 'NBS de 9 dígitos, ex.: 122011200', url: (c, d) => `${DA}/nbs?nbs=${encodeURIComponent(c)}&data=${d}` },
  'aliq-uniao': { hint: 'Sem código. Alíquotas de referência só existem para 2026', url: (c, d) => `${DA}/aliquota-uniao?data=${d}` },
  'aliq-uf': { hint: 'Código IBGE da UF, ex.: 43 (RS). Só 2026', url: (c, d) => `${DA}/aliquota-uf?codigoUf=${encodeURIComponent(c)}&data=${d}` },
  'aliq-mun': { hint: 'Código IBGE do município, ex.: 4314902. Só 2026', url: (c, d) => `${DA}/aliquota-municipio?codigoMunicipio=${encodeURIComponent(c)}&data=${d}` },
  fund: { hint: 'Sem código — fundamentações legais vigentes', url: (c, d) => `${DA}/fundamentacoes-legais?data=${d}` },
  ativ: { hint: 'Opcional: código cAtivSN (ex.: 01). Vazio lista todas as atividades do Simples', url: (c, d) => `/svc/simples/calculadora/simples-nacional/atividades${c ? '/' + encodeURIComponent(c) : ''}?data=${d}` },
  erro: { hint: 'Ex.: REG-011 (Regime Regular) ou VSN-001 (Simples Nacional)', url: c => /^VSN/i.test(c) ? `/svc/simples/calculadora/observabilidade/simples-nacional/erros?codigo=${encodeURIComponent(c.toUpperCase())}` : `/svc/regular/calculadora/observabilidade/erros?codigo=${encodeURIComponent(c.toUpperCase())}` },
};
const atualizaHint = () => { $('#q-hint').textContent = CONSULTAS[$('#q-tipo').value].hint; };
$('#q-tipo').addEventListener('change', atualizaHint); atualizaHint();
function tabela(arr) {
  const keys = [...new Set(arr.flatMap(o => Object.keys(o)))].filter(k => arr.some(o => typeof o[k] !== 'object' || o[k] === null)).slice(0, 10);
  return `<div class="table-wrap"><table><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr>${arr.slice(0, 500).map(o => `<tr>${keys.map(k => `<td>${esc(typeof o[k] === 'object' ? '' : o[k])}</td>`).join('')}</tr>`).join('')}</table></div>${arr.length > 500 ? `<p class="muted small">Mostrando 500 de ${arr.length}.</p>` : ''}`;
}
$('#btn-consultar').addEventListener('click', async e => {
  const btn = e.currentTarget; busy(btn, true);
  const out = $('#q-out');
  try {
    const r = await call(CONSULTAS[$('#q-tipo').value].url($('#q-codigo').value.trim(), $('#q-data').value));
    if (!r.ok) { out.innerHTML = `<div class="err">${esc(erroTexto(r))}</div>`; return; }
    const b = r.body;
    const arr = Array.isArray(b) ? b : Array.isArray(b?.content) ? b.content : null;
    out.innerHTML = (arr && arr.length && typeof arr[0] === 'object' ? tabela(arr) : '') + `<details ${arr ? '' : 'open'}><summary>JSON</summary><pre>${esc(typeof b === 'string' ? b : JSON.stringify(b, null, 2))}</pre></details>`;
  } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  finally { busy(btn, false); }
});
