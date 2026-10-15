// Lectura de archivos Excel (Tabla Madre / Bases) y normalización de columnas.
// Funciona en el navegador (window.Importer) y en Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('xlsx'));
  else root.Importer = factory(root.XLSX);
})(typeof self !== 'undefined' ? self : this, function (XLSX) {
'use strict';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Encabezados aceptados (normalizados) -> campo interno
const LEAD_COLS = {
  'fecha asignacion': 'fecha_asignacion', 'fecha de asignacion': 'fecha_asignacion', 'fecha': 'fecha_asignacion',
  'hora': 'hora', 'horario': 'hora',
  'cedula': 'cedula',
  'numero celular': 'celular', 'celular': 'celular', 'telefono': 'celular',
  'correo': 'correo',
  'campana': 'campana',
  'asesor': 'promotor', 'ejecutivo': 'promotor', 'ejecutivo asignado': 'promotor', 'promotor': 'promotor',
  'cedula lead': 'cedula_lead',
  'perfil lead': 'perfil_lead',
  'tipificacion': 'tipificacion',
  'estado': 'estado',
  'monto colocado': 'monto', 'monto': 'monto',
  'fecha formalizado': 'fecha_formalizado',
  'seguro': 'seguro',
  'comentarios': 'comentarios', 'comentario': 'comentarios',
};
const BASE_COLS = {
  'base precalificados': 'tipo_base', 'base': 'tipo_base', 'tipo base': 'tipo_base',
  'cedula': 'cedula', 'nombre': 'nombre', 'telefono': 'telefono', 'celular': 'telefono', 'correo': 'correo',
  'tipo credito patrono': 'tipo_credito_patrono', 'salario': 'salario', 'hit pformalizacion': 'hit',
  'razon no aplica': 'razon_no_aplica', 'tipificacion': 'tipificacion', 'comentario': 'comentario',
  'comentarios': 'comentario', 'estado': 'estado', 'monto': 'monto', 'monto colocado': 'monto',
  'fecha formalizado': 'fecha_formalizado', 'seguro': 'seguro',
  'asesor': 'promotor', 'ejecutivo': 'promotor', 'promotor': 'promotor',
};

const pad = (n) => String(n).padStart(2, '0');
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return null;
}
function toTime(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}
const toText = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s === '' ? null : s;
};
const toNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
};

// Ajusta valores a catálogo (sin distinguir mayúsculas/acentos); si no existe se deja tal cual
function matcher(lista) {
  const map = new Map(lista.map((v) => [norm(v), v]));
  const alias = { remesarte: 'Remesante', otro: 'Otro', seguimiento: 'Seguimento' };
  return (v) => { const t = toText(v); if (!t) return null; const k = norm(t); return map.get(k) || map.get(norm(alias[k] || '')) || t; };
}

function pickSheet(wb, preferidas) {
  for (const p of preferidas) {
    const name = wb.SheetNames.find((n) => norm(n) === norm(p));
    if (name) return name;
  }
  return wb.SheetNames[0];
}

function readRows(buffer, preferidas, colMap) {
  const tipo = typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer) ? 'buffer' : 'array';
  const wb = XLSX.read(buffer, { type: tipo, cellDates: true });
  const sheet = pickSheet(wb, preferidas);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  if (!rows.length) return { sheet, rows: [], columnas: [] };
  const header = rows[0].map((h) => colMap[norm(h)] || null);
  const out = [];
  for (const r of rows.slice(1)) {
    const o = {};
    header.forEach((f, i) => { if (f && o[f] == null) o[f] = r[i]; });
    out.push(o);
  }
  return { sheet, rows: out, columnas: [...new Set(header.filter(Boolean))] };
}

function parseLeads(buffer, catalogos, sheetPreferida) {
  const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const { sheet, rows, columnas } = readRows(buffer, [sheetPreferida, ...meses].filter(Boolean), LEAD_COLS);
  const camp = matcher(catalogos.campana), perf = matcher(catalogos.perfil),
    tip = matcher(catalogos.tipificacion), est = matcher(catalogos.estado), seg = matcher(catalogos.seguro);
  const leads = rows.map((r) => ({
    fecha_asignacion: toDate(r.fecha_asignacion), hora: toTime(r.hora), cedula: toText(r.cedula),
    celular: toText(r.celular), correo: toText(r.correo), campana: camp(r.campana), promotor: toText(r.promotor),
    cedula_lead: toText(r.cedula_lead), perfil_lead: perf(r.perfil_lead), tipificacion: tip(r.tipificacion),
    estado: est(r.estado), monto: toNum(r.monto), fecha_formalizado: toDate(r.fecha_formalizado),
    seguro: seg(r.seguro), comentarios: toText(r.comentarios),
  })).filter((l) => l.cedula || l.celular || l.correo);
  return { sheet, columnas, leads };
}

function parseBases(buffer, catalogos) {
  const { sheet, rows, columnas } = readRows(buffer, ['BASES', 'BASE'], BASE_COLS);
  const tip = matcher(catalogos.tipificacion), est = matcher(catalogos.estado), tb = matcher(catalogos.tipo_base), seg = matcher(catalogos.seguro);
  const bases = rows.map((r) => ({
    tipo_base: tb(r.tipo_base), cedula: toText(r.cedula), nombre: toText(r.nombre), telefono: toText(r.telefono),
    correo: toText(r.correo), tipo_credito_patrono: toText(r.tipo_credito_patrono), salario: toNum(r.salario),
    hit: toText(r.hit), razon_no_aplica: toText(r.razon_no_aplica), tipificacion: tip(r.tipificacion),
    estado: est(r.estado), monto: toNum(r.monto), fecha_formalizado: toDate(r.fecha_formalizado),
    seguro: seg(r.seguro), comentario: toText(r.comentario), promotor: toText(r.promotor),
  })).filter((b) => b.cedula || b.telefono || b.nombre);
  return { sheet, columnas, bases };
}

return { parseLeads, parseBases, norm };
});
