// Consulta REVERSA: dado um NCM, NBS ou CST, lista todos os cClassTrib possíveis.
//
// Lê o MESMO banco SQLite oficial usado pelas calculadoras (somente leitura) e
// reproduz exatamente a regra de vínculo da calculadora do regime regular
// (NcmAplicavelService / NbsAplicavelService):
//   - cClassTrib SEM anexo vigente de NCM/NBS -> aceita qualquer código ("genérica")
//   - cClassTrib COM anexo -> o código precisa ser coberto por prefixo (NCMA_NCM_CD =
//     SUBSTR(ncm,1,LEN)) e, se houver exceção vigente cobrindo o código, só passa
//     se existir outro vínculo vigente cobrindo-o sem nenhuma exceção vigente.
//     Regra: rejeitar quando !A ou quando (E e !S).
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.RTC_DB || path.join(__dirname, '..', 'vendor', 'calculadora-rtc-regime-regular', 'calculadora', 'db', 'calculadora-pro.db');

let db = null;
function abrir() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) throw Object.assign(new Error(`Banco não encontrado em ${DB_PATH}. Rode setup.ps1.`), { status: 503 });
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db;
}
const vig = (ini, fim) => `? BETWEEN ${ini} AND COALESCE(${fim}, ?)`; // (data, data)

// ---------- dados base (cache por data) ----------
const cache = new Map();
function base(data) {
  if (cache.has(data)) return cache.get(data);
  const d = abrir();
  // classificações vigentes + CST + tributos
  const classes = d.prepare(`
    SELECT c.CLTR_ID id, c.CLTR_CD cClassTrib, c.CLTR_DESCRICAO descricao, c.CLTR_NOMENCLATURA nomenclatura,
           s.SITR_CD cst, s.SITR_DESCRICAO cstDescricao,
           (SELECT GROUP_CONCAT(DISTINCT t.TBTO_SIGLA) FROM TRIBUTO_SITUACAO_TRIBUTARIA ts JOIN TRIBUTO t ON t.TBTO_ID = ts.TRST_TBTO_ID
             WHERE ts.TRST_SITR_ID = s.SITR_ID) tributos
      FROM CLASSIFICACAO_TRIBUTARIA c JOIN SITUACAO_TRIBUTARIA s ON s.SITR_ID = c.CLTR_SITR_ID
     WHERE ${vig('c.CLTR_INICIO_VIGENCIA', 'c.CLTR_FIM_VIGENCIA')}
     ORDER BY c.CLTR_CD`).all(data, data);
  for (const c of classes) c.grupo = /\bIS\b/.test(c.tributos || '') && !/CBS/.test(c.tributos || '') ? 'IS' : 'CBS/IBS';
  const porId = new Map(classes.map(c => [c.id, c]));

  const anexo = (tab, pre, exTab, exPre, col, exCol) => {
    const linhas = d.prepare(`SELECT ${pre}_ID id, ${col} cod, ${pre}_CLTR_ID cltr,
        CASE WHEN ${vig(`${pre}_INICIO_VIGENCIA`, `${pre}_FIM_VIGENCIA`)} THEN 1 ELSE 0 END vigente FROM ${tab}`).all(data, data);
    const exc = d.prepare(`SELECT ${exPre}_${exCol} cod, ${exPre}_${pre}_ID pai,
        CASE WHEN ${vig(`${exPre}_INICIO_VIGENCIA`, `${exPre}_FIM_VIGENCIA`)} THEN 1 ELSE 0 END vigente FROM ${exTab}`).all(data, data);
    const excPorPai = new Map();
    for (const e of exc) { if (!excPorPai.has(e.pai)) excPorPai.set(e.pai, []); excPorPai.get(e.pai).push(e); }
    const porPrefixo = new Map(); const comAnexo = new Set();
    for (const l of linhas) {
      if (!porId.has(l.cltr)) continue;
      const todas = excPorPai.get(l.id) || [];
      l.excecoes = todas.filter(e => e.vigente).map(e => e.cod);
      // espelha o LEFT JOIN da query S: passa se não há exceção ou se há alguma não vigente
      l.semExcecaoVigente = todas.length === 0 || todas.some(e => !e.vigente);
      if (!porPrefixo.has(l.cod)) porPrefixo.set(l.cod, []);
      porPrefixo.get(l.cod).push(l);
      if (l.vigente) comAnexo.add(l.cltr);
    }
    return { porPrefixo, comAnexo };
  };
  const b = {
    classes, porId,
    ncm: anexo('NCM_APLICAVEL', 'NCMA', 'EXCECAO_NCM_APLICAVEL', 'ENCM', 'NCMA_NCM_CD', 'NCM_CD'),
    nbs: anexo('NBS_APLICAVEL', 'NBSA', 'EXCECAO_NBS_APLICAVEL', 'ENBS', 'NBSA_NBS_CD', 'NBS_CD'),
  };
  cache.set(data, b);
  return b;
}

// aplica a tabela-verdade da calculadora para um código completo
function especificas(anexo, codigo) {
  const porCltr = new Map();
  for (let n = 1; n <= codigo.length; n++) {
    for (const l of anexo.porPrefixo.get(codigo.slice(0, n)) || []) {
      if (!porCltr.has(l.cltr)) porCltr.set(l.cltr, []);
      porCltr.get(l.cltr).push(l);
    }
  }
  const out = [];
  for (const [cltr, ls] of porCltr) {
    if (!anexo.comAnexo.has(cltr)) continue;
    const A = ls.some(l => l.vigente);
    const E = ls.some(l => l.excecoes.some(e => codigo.startsWith(e)));
    const S = ls.some(l => l.vigente && l.semExcecaoVigente);
    if (A && !(E && !S)) out.push({ cltr, prefixos: [...new Set(ls.filter(l => l.vigente).map(l => l.cod))] });
  }
  return out;
}
const fmt = (c, extra = {}) => ({ cClassTrib: c.cClassTrib, cst: c.cst, tributo: c.grupo, descricao: c.descricao, nomenclatura: c.nomenclatura, ...extra });

function descricaoCodigo(tipo, codigo, data) {
  const d = abrir();
  const [tab, pre] = tipo === 'ncm' ? ['NCM', 'NCM'] : ['NBS', 'NBS'];
  return d.prepare(`SELECT ${pre}_DESCRICAO descricao FROM ${tab} WHERE ${pre}_CD = ? AND ${vig(`${pre}_INICIO_VIGENCIA`, `${pre}_FIM_VIGENCIA`)}`).get(codigo, data, data)?.descricao ?? null;
}

function consultar(tipo, codigo, data) {
  const b = base(data);
  codigo = String(codigo || '').replace(/\D/g, '');
  if (tipo === 'cst') {
    codigo = codigo.padStart(3, '0');
    const lista = b.classes.filter(c => c.cst === codigo);
    const m = c => fmt(c, { anexoNcm: b.ncm.comAnexo.has(c.id), anexoNbs: b.nbs.comAnexo.has(c.id) });
    const cbsIbs = lista.filter(c => c.grupo === 'CBS/IBS'), is = lista.filter(c => c.grupo === 'IS');
    return { tipo, codigo, data, cstDescricao: (cbsIbs[0] || is[0])?.cstDescricao ?? null,
      cstDescricaoIS: is[0]?.cstDescricao ?? null, total: cbsIbs.length,
      cClassTribs: cbsIbs.map(m), cClassTribsIS: is.map(m) };
  }
  const tam = tipo === 'ncm' ? 8 : 9;
  if (codigo.length !== tam) throw Object.assign(new Error(`${tipo.toUpperCase()} deve ter ${tam} dígitos`), { status: 400 });
  const anexo = b[tipo];
  const esp = especificas(anexo, codigo).map(x => fmt(b.porId.get(x.cltr), { vinculoPor: x.prefixos.join(', ') }))
    .sort((a, c) => a.tributo.localeCompare(c.tributo) || a.cClassTrib.localeCompare(c.cClassTrib));
  // genéricas: sem anexo vigente E com nomenclatura que admite esse tipo de código (CLTR_NOMENCLATURA: NCM | NBS | "NBS ou NCM")
  const T = tipo.toUpperCase();
  const gen = b.classes.filter(c => !anexo.comAnexo.has(c.id) && (c.nomenclatura || '').toUpperCase().includes(T))
    .sort((a, c) => a.grupo.localeCompare(c.grupo) || a.cClassTrib.localeCompare(c.cClassTrib)).map(c => fmt(c));
  return { tipo, codigo, data, descricao: descricaoCodigo(tipo, codigo, data),
    especificas: esp, genericas: gen,
    nota: `"especificas": cClassTrib cujo anexo de ${T} cobre este código. "genericas": cClassTrib de ${T} sem anexo — a calculadora aceita qualquer código (podem existir outras restrições, ex.: tipo de DF-e, atores).` };
}

// ---------- listagem completa (CSV ; com BOM, abre direto no Excel) ----------
const csvCel = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cab, linhas) => '﻿' + [cab, ...linhas].map(l => l.map(csvCel).join(';')).join('\r\n') + '\r\n';

function listagem(tipo, data) {
  const b = base(data); const d = abrir();
  if (tipo === 'cst') {
    return csv(['CST', 'Descrição CST', 'cClassTrib', 'Tributo', 'Descrição cClassTrib', 'Tem anexo NCM', 'Tem anexo NBS'],
      b.classes.map(c => [c.cst, c.cstDescricao, c.cClassTrib, c.grupo, c.descricao, b.ncm.comAnexo.has(c.id) ? 'S' : 'N', b.nbs.comAnexo.has(c.id) ? 'S' : 'N']));
  }
  if (tipo === 'genericas') {
    const aceita = (c, t) => (c.nomenclatura || '').toUpperCase().includes(t) && !b[t.toLowerCase()].comAnexo.has(c.id);
    return csv(['cClassTrib', 'CST', 'Tributo', 'Descrição', 'Nomenclatura', 'Aceita qualquer NCM', 'Aceita qualquer NBS'],
      b.classes.filter(c => aceita(c, 'NCM') || aceita(c, 'NBS'))
        .map(c => [c.cClassTrib, c.cst, c.grupo, c.descricao, c.nomenclatura, aceita(c, 'NCM') ? 'S' : 'N', aceita(c, 'NBS') ? 'S' : 'N']));
  }
  const [tab, pre, tam] = tipo === 'ncm' ? ['NCM', 'NCM', 8] : ['NBS', 'NBS', 9];
  const codigos = d.prepare(`SELECT ${pre}_CD cod, ${pre}_DESCRICAO descricao FROM ${tab}
      WHERE LENGTH(${pre}_CD) = ${tam} AND ${vig(`${pre}_INICIO_VIGENCIA`, `${pre}_FIM_VIGENCIA`)} ORDER BY ${pre}_CD`).all(data, data);
  const linhas = [];
  for (const { cod, descricao } of codigos) {
    for (const x of especificas(b[tipo], cod)) {
      const c = b.porId.get(x.cltr);
      linhas.push([cod, descricao, c.cClassTrib, c.cst, c.grupo, c.descricao, x.prefixos.join(' ')]);
    }
  }
  linhas.sort((a, c) => a[0].localeCompare(c[0]) || a[2].localeCompare(c[2]));
  return csv([tipo.toUpperCase(), `Descrição ${tipo.toUpperCase()}`, 'cClassTrib', 'CST', 'Tributo', 'Descrição cClassTrib', 'Vínculo pelo prefixo'], linhas);
}

module.exports = { consultar, listagem, DB_PATH };
