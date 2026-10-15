/* CRM de Telemercadeo — Jefe de Telemercadeo y Promotores */
'use strict';

// ================= Estado y utilidades =================
const S = {
  me: null, cat: {}, promotores: [], periodos: [], periodo: '', tab: '',
  leads: [], bases: [], prod: [], metas: null,
  gestion: null,            // { tipo: 'lead'|'base', id }
  f: {                      // filtros por vista
    base: { q: '', campana: '', estado: '', promotor: '', tipificacion: '', pendientes: false },
    bases: { q: '', tipo_base: '', tipificacion: '', promotor: '', pendientes: false },
    prod: { promotor: '' },
    dist: { modo: 'leads', ver: 'sin', campana: '', q: '', sel: new Set(), prom: new Set() },
    piv: { filas: 'promotor', cols: 'estado', valor: 'n', estado: '', campana: '', promotor: '' },
  },
  sort: { base: { k: 'fecha_asignacion', d: -1 } },
  limit: 300,
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null || isNaN(n) ? '—' : 'C$ ' + Math.round(n).toLocaleString('en-US'));
const usd = (n) => (n == null || isNaN(n) ? '—' : '$ ' + Math.round(n).toLocaleString('en-US'));
const int = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
const dec = (n, d = 1) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n) => (n == null || !isFinite(n) ? '—' : (n * 100).toFixed(1) + '%');
const fdt = (s) => (s ? new Date(s).toLocaleString('es-NI', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fdate = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '');
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const nombrePeriodo = (p) => (p ? `${MESES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : '');
const opts = (list, sel, vacio = '') => (vacio !== null ? `<option value="">${esc(vacio)}</option>` : '') +
  list.map((v) => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}" ${String(val) === String(sel ?? '') ? 'selected' : ''}>${esc(lab)}</option>`; }).join('');
const badge = (estado) => estado ? `<span class="badge ${esc(estado.replace(/\s/g, ''))}">${esc(estado)}</span>` : '<span class="badge pend">Pendiente</span>';
const isJefe = () => S.me && S.me.rol === 'jefe';
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ================= Acceso a datos (Supabase) =================
const CFG = window.CRM_CONFIG || {};
const sb = CFG.SUPABASE_URL && !/TU_PROYECTO/.test(CFG.SUPABASE_URL) && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const DOMINIO = '@telemercadeo.example';
const periodoActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// Ejecuta una consulta y convierte el error de Supabase en una excepción con mensaje legible
async function q(promesa) {
  const { data, error } = await promesa;
  if (error) {
    if (/JWT|session/i.test(error.message)) { S.me = null; renderLogin('Su sesión expiró, ingrese de nuevo'); throw new Error('Sesión expirada'); }
    throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
  }
  return data;
}
// Supabase devuelve máximo 1000 filas por consulta: se pide por páginas
async function fetchAll(builder) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = await q(builder().range(from, from + page - 1));
    out.push(...rows); if (rows.length < page) return out;
  }
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const nombreDe = (id) => (S.me && id === S.me.id ? S.me.nombre : S.promotores.find((p) => p.id === id)?.nombre) || null;
const conNombre = (rows) => rows.map((r) => ({ ...r, promotor: nombreDe(r.promotor_id) }));
// Limpia valores del formulario: '' -> null, números
function limpiar(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === '' || v === null) { o[k] = null; continue; }
    if (['monto', 'salario'].includes(k)) { const n = Number(v); if (isNaN(n)) throw new Error('Valor inválido en ' + k); o[k] = n; continue; }
    o[k] = typeof v === 'string' ? v.trim() : v;
  }
  return o;
}
function toast(msg, tipo = '') {
  const t = document.createElement('div'); t.className = 'toast ' + tipo; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), tipo === 'error' ? 6000 : 3000);
}
const fail = (e) => toast(e.message, 'error');

function modal(titulo, cuerpo, botones) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal card"><div class="card-h"><h3>${esc(titulo)}</h3></div>
      <div class="card-b">${cuerpo}</div><div class="modal-f">${botones.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
    root.querySelectorAll('.modal-f .btn').forEach((btn) => btn.onclick = async () => {
      const b = botones[Number(btn.dataset.i)];
      if (b.onClick) { try { const r = await b.onClick(root); if (r === false) return; } catch (e) { fail(e); return; } }
      root.innerHTML = ''; resolve(b.value);
    });
    const first = root.querySelector('input,select,textarea'); if (first) first.focus();
  });
}
const confirmar = (titulo, msg) => modal(titulo, `<p style="margin:0">${msg}</p>`, [{ label: 'Cancelar', value: false }, { label: 'Confirmar', cls: 'primary', value: true }]);

// Días hábiles: lunes a viernes = 1, sábado = 0.5 (como en "Cálculo Desface")
function diasHabiles(periodo, hasta) {
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5)) - 1;
  const last = new Date(y, m + 1, 0).getDate(); let n = 0;
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m, d); if (hasta && dt > hasta) break;
    const w = dt.getDay(); n += w === 0 ? 0 : w === 6 ? 0.5 : 1;
  }
  return n;
}

// ================= Login =================
function renderLogin(msg = '') {
  $('#app').innerHTML = `<div class="login-wrap"><form class="login" id="fLogin" autocomplete="on">
    <div class="brand" style="margin-bottom:18px"><div class="logo">☎</div><div>CRM Telemercadeo<small>Gestión de leads y producción</small></div></div>
    <h1>Iniciar sesión</h1><p>Ingrese con su usuario asignado.</p>
    <div class="field"><label for="lu">Usuario</label><input type="text" id="lu" autocomplete="username" required></div>
    <div class="field"><label for="lp">Contraseña</label><input type="password" id="lp" autocomplete="current-password" required></div>
    <button class="btn primary" type="submit">Entrar</button><div class="err" id="lerr">${esc(msg)}</div></form></div>`;
  $('#lu').focus();
  $('#fLogin').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const u = $('#lu').value.trim().toLowerCase();
      const { error } = await sb.auth.signInWithPassword({ email: u.includes('@') ? u : u + DOMINIO, password: $('#lp').value });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'Usuario o contraseña incorrectos' : error.message);
      await boot();
    } catch (err) { $('#lerr').textContent = err.message; btn.disabled = false; }
  };
}

async function cargarPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  const perfil = await q(sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle());
  if (!perfil || !perfil.activo) { await sb.auth.signOut(); throw new Error('Su usuario está inactivo o no tiene perfil asignado. Consulte al Jefe de Telemercadeo.'); }
  const [cat, promotores, periodos] = await Promise.all([
    q(sb.from('catalogos').select('tipo,valor').order('tipo').order('orden')),
    perfil.rol === 'jefe' ? q(sb.from('perfiles').select('id,nombre,username,activo').eq('rol', 'promotor').order('nombre')) : [],
    q(sb.rpc('periodos')),
  ]);
  S.me = perfil;
  S.cat = {}; for (const r of cat) (S.cat[r.tipo] ||= []).push(r.valor);
  S.promotores = perfil.rol === 'jefe' ? promotores : [{ id: perfil.id, nombre: perfil.nombre, username: perfil.username, activo: true }];
  S.periodos = periodos.map((p) => (typeof p === 'string' ? p : p.periodos));
  if (!S.periodos.includes(periodoActual())) S.periodos.unshift(periodoActual());
  S.periodos.sort().reverse();
  return true;
}
async function boot() {
  if (!sb) {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login"><h1>Configuración pendiente</h1>
      <p>Falta conectar la base de datos: complete <code>public/config.js</code> con la URL y la clave pública de Supabase.</p></div></div>`;
    return;
  }
  try {
    if (!(await cargarPerfil())) return renderLogin();
    if (!S.periodo || !S.periodos.includes(S.periodo)) S.periodo = S.periodos[0];
    S.tab = S.tab || 'base';
    renderShell();
    await loadTab();
    if (S.me.must_change) cambiarClave(true);
  } catch (e) { if (e.message !== 'Sesión expirada') renderLogin(e.message); }
}

// ================= Shell y pestañas =================
function tabsDef() {
  const t = isJefe()
    ? [['base', 'Base General'], ['desfase', 'Cálculo Desfase'], ['tablas', 'Tablas'], ['campanas', 'Campañas'], ['dinamica', 'Tabla Dinámica'],
      ['distribucion', 'Distribución'], ['produccion', 'Producción'], ['bases', 'Bases'], ['config', 'Usuarios y catálogos']]
    : [['base', 'Mi Base'], ['produccion', 'Producción'], ['bases', 'Bases']];
  if (S.gestion) t.splice(1, 0, ['gestion', 'Gestión · ' + (gestionRegistro()?.cedula || gestionRegistro()?.nombre || '#' + S.gestion.id)]);
  return t;
}
function renderShell() {
  const ini = S.me.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  $('#app').innerHTML = `
  <header class="top"><div class="top-row">
    <div class="brand"><div class="logo">☎</div><div>CRM Telemercadeo<small>${isJefe() ? 'Jefe de Telemercadeo' : 'Promotor de Telemercadeo'}</small></div></div>
    <div class="spacer"></div>
    <div class="field" style="flex-direction:row;align-items:center;gap:8px"><label for="selPer" style="margin:0">Periodo</label>
      <select id="selPer" style="width:auto">${opts(S.periodos.map((p) => [p, nombrePeriodo(p)]), S.periodo, null)}</select>
      ${isJefe() ? '<button class="btn sm" id="btnPer" title="Agregar periodo">+ Mes</button>' : ''}</div>
    <button class="btn" id="btnExport" title="Descargar Excel del periodo">⬇ Excel</button>
    <div class="user-chip"><div class="avatar">${esc(ini)}</div><div><div style="font-weight:600">${esc(S.me.nombre)}</div>
      <div class="small"><a href="#" id="lnkPass">Cambiar contraseña</a> · <a href="#" id="lnkOut">Salir</a></div></div></div>
  </div><nav class="tabs" id="tabs"></nav></header><main id="content"></main>`;
  renderTabs();
  $('#selPer').onchange = async (e) => { S.periodo = e.target.value; S.gestion = null; if (S.tab === 'gestion') S.tab = 'base'; renderTabs(); await loadTab(); };
  $('#btnExport').onclick = () => exportarExcel().catch(fail);
  $('#lnkOut').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut().catch(() => {}); S.me = null; S.gestion = null; S.tab = ''; renderLogin(); };
  $('#lnkPass').onclick = (e) => { e.preventDefault(); cambiarClave(false); };
  if ($('#btnPer')) $('#btnPer').onclick = nuevoPeriodo;
}
function renderTabs() {
  $('#tabs').innerHTML = tabsDef().map(([k, l]) => `<button class="tab ${k === S.tab ? 'active' : ''} ${k === 'gestion' ? 'gestion' : ''}" data-tab="${k}">
    ${k === 'gestion' ? '📞 ' : ''}${esc(l)}${k === 'gestion' ? '<span class="x" data-close="1" title="Cerrar">✕</span>' : ''}</button>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach((b) => b.onclick = async (e) => {
    if (e.target.dataset.close) { S.gestion = null; S.tab = 'base'; renderTabs(); return renderContent(); }
    S.tab = b.dataset.tab; renderTabs(); await loadTab();
  });
}
async function nuevoPeriodo() {
  const d = new Date(); const sug = `${d.getFullYear()}-${String(d.getMonth() + 2 > 12 ? 1 : d.getMonth() + 2).padStart(2, '0')}`;
  await modal('Agregar periodo', `<div class="field"><label>Mes (AAAA-MM)</label><input type="month" id="mPer" value="${sug}"></div>
    <p class="muted small" style="margin:0">Luego podrá importar la base del mes en <b>Distribución</b> y definir la meta en <b>Cálculo Desfase</b>.</p>`, [
    { label: 'Cancelar' },
    { label: 'Agregar', cls: 'primary', onClick: (r) => { const v = $('#mPer', r).value; if (!/^\d{4}-\d{2}$/.test(v)) throw new Error('Mes inválido'); if (!S.periodos.includes(v)) S.periodos.unshift(v); S.periodos.sort().reverse(); S.periodo = v; renderShell(); return loadTab(); } },
  ]);
}
async function cambiarClave(obligatorio) {
  await modal(obligatorio ? 'Cree su contraseña personal' : 'Cambiar contraseña', `
    ${obligatorio ? '<p style="margin:0" class="muted">Por seguridad, cambie la contraseña inicial antes de continuar.</p>' : ''}
    <div class="field"><label>Contraseña actual</label><input type="password" id="pa" autocomplete="current-password"></div>
    <div class="field"><label>Nueva contraseña (mínimo 8 caracteres)</label><input type="password" id="pn" autocomplete="new-password"></div>
    <div class="field"><label>Repetir nueva contraseña</label><input type="password" id="pn2" autocomplete="new-password"></div>`,
  [...(obligatorio ? [] : [{ label: 'Cancelar' }]), { label: 'Guardar', cls: 'primary', onClick: async (r) => {
    if ($('#pn', r).value !== $('#pn2', r).value) throw new Error('Las contraseñas no coinciden');
    const nueva = $('#pn', r).value;
    if (nueva.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
    if (nueva !== $('#pn2', r).value) throw new Error('Las contraseñas no coinciden');
    const { error: e1 } = await sb.auth.signInWithPassword({ email: S.me.username + DOMINIO, password: $('#pa', r).value });
    if (e1) throw new Error('La contraseña actual no es correcta');
    const { error: e2 } = await sb.auth.updateUser({ password: nueva });
    if (e2) throw new Error(e2.message);
    await q(sb.rpc('marcar_clave_cambiada'));
    S.me.must_change = false; toast('Contraseña actualizada', 'ok');
  } }]);
}

// ================= Carga de datos =================
const ORDEN_LEADS = (b) => b.order('fecha_asignacion', { ascending: false, nullsFirst: false }).order('hora', { ascending: false }).order('id', { ascending: false });
async function loadLeads() { S.leads = conNombre(await fetchAll(() => ORDEN_LEADS(sb.from('leads').select('*').eq('periodo', S.periodo)))); }
async function loadBases() { S.bases = conNombre(await fetchAll(() => sb.from('bases').select('*').eq('periodo', S.periodo).order('tipo_base').order('id'))); }
// Producción = todo lo formalizado en la base del mes y en Bases
function loadProd() {
  const L = S.leads.filter((l) => l.estado === 'Formalizado').map((l) => ({ origen: 'lead', id: l.id, promotor_id: l.promotor_id, promotor: l.promotor,
    fecha_asignacion: l.fecha_asignacion, cedula: l.cedula_lead || l.cedula, campana: l.campana, perfil: l.perfil_lead, tipificacion: l.tipificacion,
    estado: l.estado, monto: Number(l.monto) || 0, fecha_formalizado: l.fecha_formalizado, seguro: l.seguro, comentario: l.comentarios }));
  const B = S.bases.filter((b) => b.estado === 'Formalizado').map((b) => ({ origen: 'base', id: b.id, promotor_id: b.promotor_id, promotor: b.promotor,
    fecha_asignacion: null, cedula: b.cedula, campana: 'Base ' + (b.tipo_base || ''), perfil: b.tipo_credito_patrono, tipificacion: b.tipificacion,
    estado: b.estado, monto: Number(b.monto) || 0, fecha_formalizado: b.fecha_formalizado, seguro: b.seguro, comentario: b.comentario }));
  S.prod = [...L, ...B].sort((a, b) => String(b.fecha_formalizado || '').localeCompare(String(a.fecha_formalizado || '')));
}
async function loadMetas() {
  S.metas = (await q(sb.from('metas').select('*').eq('periodo', S.periodo).maybeSingle()))
    || { periodo: S.periodo, meta_mensual: 0, dias_habiles: null, dias_fecha: null, tipo_cambio: 36.6243, conversion: 0.026, campanas: [] };
  for (const k of ['meta_mensual', 'dias_habiles', 'dias_fecha', 'tipo_cambio', 'conversion']) if (S.metas[k] != null) S.metas[k] = Number(S.metas[k]);
}

async function exportarExcel() {
  if (!S.leads.length) await loadLeads();
  if (!S.bases.length) await loadBases();
  const hoja = MESES[Number(S.periodo.slice(5)) - 1].toUpperCase();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.leads.map((l) => ({ 'Fecha asignacion': l.fecha_asignacion, Hora: l.hora, 'Cédula': l.cedula,
    'Número Celular': l.celular, Correo: l.correo, 'Campaña': l.campana, Asesor: l.promotor, 'Cedula Lead': l.cedula_lead, 'Perfil Lead': l.perfil_lead,
    Tipificacion: l.tipificacion, Estado: l.estado, 'Monto Colocado': l.monto == null ? null : Number(l.monto), 'Fecha formalizado': l.fecha_formalizado,
    Seguro: l.seguro, Comentarios: l.comentarios }))), hoja);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.bases.map((b) => ({ BASE_PRECALIFICADOS: b.tipo_base, CEDULA: b.cedula, NOMBRE: b.nombre,
    TELEFONO: b.telefono, CORREO: b.correo, TIPO_CREDITO_PATRONO: b.tipo_credito_patrono, Salario: b.salario == null ? null : Number(b.salario),
    HIT_PFORMALIZACION: b.hit, Razon_no_aplica: b.razon_no_aplica, 'Tipificación': b.tipificacion, Estado: b.estado, Monto: b.monto == null ? null : Number(b.monto),
    COMENTARIO: b.comentario, Asesor: b.promotor }))), 'BASES');
  XLSX.writeFile(wb, `Telemercadeo_${hoja}_${S.periodo.slice(0, 4)}${isJefe() ? '' : '_' + S.me.username}.xlsx`);
}
async function loadTab() {
  $('#content').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const t = S.tab;
    const tareas = [];
    if (['base', 'tablas', 'campanas', 'dinamica', 'desfase', 'distribucion', 'gestion', 'produccion'].includes(t)) tareas.push(loadLeads());
    if (['bases', 'distribucion', 'gestion', 'desfase', 'produccion', 'tablas'].includes(t)) tareas.push(loadBases());
    if (t === 'desfase') tareas.push(loadMetas());
    await Promise.all(tareas);
    loadProd();
    await renderContent();
  } catch (e) { if (e.message !== 'Sesión expirada') { $('#content').innerHTML = `<div class="empty">${esc(e.message)}</div>`; } }
}
function renderContent() {
  const views = { base: viewBase, gestion: viewGestion, produccion: viewProduccion, bases: viewBases, desfase: viewDesfase, tablas: viewTablas,
    campanas: viewCampanas, dinamica: viewDinamica, distribucion: viewDistribucion, config: viewConfig };
  return (views[S.tab] || viewBase)();
}

// ================= Base del mes (OCTUBRE) =================
const COLS_LEAD = [
  { k: 'fecha_asignacion', l: 'Fecha asignación', g: 'v', f: fdate },
  { k: 'hora', l: 'Hora', g: 'v' },
  { k: 'cedula', l: 'Cédula', g: 'v' },
  { k: 'celular', l: 'Número Celular', g: 'v' },
  { k: 'correo', l: 'Correo', g: 'v', cls: 'ellipsis' },
  { k: 'campana', l: 'Campaña', g: 'v' },
  { k: 'promotor', l: 'Ejecutivo', g: 'a', jefe: true },
  { k: 'cedula_lead', l: 'Cédula Lead', g: 'a' },
  { k: 'perfil_lead', l: 'Perfil Lead', g: 'a' },
  { k: 'tipificacion', l: 'Tipificación', g: 'a' },
  { k: 'estado', l: 'Estado', g: 'a', f: (v) => badge(v), html: true },
  { k: 'monto', l: 'Monto Colocado', g: 'a', f: money, num: true },
  { k: 'fecha_formalizado', l: 'Fecha formalizado', g: 'a', f: fdate },
  { k: 'comentarios', l: 'Comentarios', g: 'a', cls: 'ellipsis' },
];
function filtrarLeads() {
  const f = S.f.base; const q = norm(f.q);
  let rows = S.leads.filter((l) => (!f.campana || l.campana === f.campana) && (!f.estado || (f.estado === '__pend' ? !l.estado : l.estado === f.estado))
    && (!f.tipificacion || l.tipificacion === f.tipificacion) && (!f.promotor || (f.promotor === 'sin' ? !l.promotor_id : String(l.promotor_id) === f.promotor))
    && (!q || norm([l.cedula, l.celular, l.correo, l.cedula_lead, l.comentarios, l.promotor].join(' ')).includes(q)));
  const { k, d } = S.sort.base;
  rows = rows.slice().sort((a, b) => {
    let x = a[k] ?? '', y = b[k] ?? '';
    if (k === 'fecha_asignacion') { x += ' ' + (a.hora || ''); y += ' ' + (b.hora || ''); }
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * d;
  });
  return rows;
}
function viewBase() {
  const f = S.f.base; const mine = S.leads;
  const form = mine.filter((l) => l.estado === 'Formalizado');
  const pend = mine.filter((l) => !l.estado).length;
  $('#content').innerHTML = `
    <div class="kpis">
      <div class="kpi verde"><div class="l">Leads asignados</div><div class="v">${int(mine.length)}</div><div class="s">${esc(nombrePeriodo(S.periodo))}</div></div>
      <div class="kpi azul"><div class="l">Pendientes de gestionar</div><div class="v">${int(pend)}</div><div class="s">sin estado</div></div>
      <div class="kpi ok"><div class="l">Formalizados</div><div class="v">${int(form.length)}</div><div class="s">${pct(form.length / (mine.length || 1))} de conversión</div></div>
      <div class="kpi ok"><div class="l">Monto colocado</div><div class="v">${money(sum(form, (l) => l.monto))}</div><div class="s">Ticket ${money(sum(form, (l) => l.monto) / (form.length || 1))}</div></div>
      ${isJefe() ? `<div class="kpi"><div class="l">Sin asignar</div><div class="v">${int(mine.filter((l) => !l.promotor_id).length)}</div><div class="s">ir a Distribución</div></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="field grow"><label>Buscar</label><input type="search" id="fq" placeholder="Cédula, celular, correo, comentario…" value="${esc(f.q)}"></div>
      <div class="field"><label>Campaña</label><select id="fcamp">${opts(S.cat.campana || [], f.campana, 'Todas')}</select></div>
      ${isJefe() ? `<div class="field"><label>Ejecutivo</label><select id="fprom">${opts([['sin', '— Sin asignar —'], ...S.promotores.map((p) => [String(p.id), p.nombre])], f.promotor, 'Todos')}</select></div>` : ''}
      <div class="field"><label>Tipificación</label><select id="ftip">${opts(S.cat.tipificacion || [], f.tipificacion, 'Todas')}</select></div>
      <div class="field"><label>Estado</label><select id="fest">${opts([['__pend', 'Pendiente'], ...(S.cat.estado || [])], f.estado, 'Todos')}</select></div>
      ${isJefe() ? '<button class="btn primary" id="btnNuevo">+ Nuevo lead</button>' : ''}
    </div>
    <div id="tblBase"></div>`;
  const bind = (id, key) => { const el = $(id); if (!el) return; el.oninput = () => { f[key] = el.value; S.limit = 300; tablaBase(); }; };
  bind('#fq', 'q'); bind('#fcamp', 'campana'); bind('#fprom', 'promotor'); bind('#ftip', 'tipificacion'); bind('#fest', 'estado');
  if ($('#btnNuevo')) $('#btnNuevo').onclick = nuevoLead;
  tablaBase();
}
function tablaBase() {
  const rows = filtrarLeads();
  const cols = COLS_LEAD.filter((c) => !c.jefe || isJefe());
  const nV = cols.filter((c) => c.g === 'v').length, nA = cols.length - nV;
  const s = S.sort.base;
  const vis = rows.slice(0, S.limit);
  $('#tblBase').innerHTML = `<div class="tbl-wrap"><table class="tbl-compact">
    <thead><tr class="grp"><th colspan="${nV}" class="g-verde">Asignación</th><th colspan="${nA}" class="g-azul">Gestión del promotor — clic en la fila para gestionar</th></tr>
    <tr>${cols.map((c) => `<th class="sortable ${c.g === 'v' ? 'h-verde' : 'h-azul'} ${c.num ? 'num' : ''}" data-k="${c.k}">${esc(c.l)}${s.k === c.k ? (s.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${vis.map((r) => `<tr class="click" data-id="${r.id}">${cols.map((c) => {
      const v = r[c.k]; const t = c.f ? c.f(v) : v;
      return `<td class="${c.num ? 'num' : ''} ${c.cls || ''} ${c.g === 'a' ? 'c-azul' : ''}" ${c.cls ? `title="${esc(v)}"` : ''}>${c.html ? t : esc(t ?? '')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${cols.length}">${int(rows.length)} registros · Formalizado: ${money(sum(rows.filter((r) => r.estado === 'Formalizado'), (r) => r.monto))}
    ${rows.length > vis.length ? ` · mostrando ${vis.length} <button class="btn sm" id="btnMas">Mostrar más</button>` : ''}</td></tr></tfoot>
    </table>${rows.length ? '' : '<div class="empty">No hay registros con estos filtros.</div>'}</div>`;
  $('#tblBase').querySelectorAll('th.sortable').forEach((th) => th.onclick = () => { const k = th.dataset.k; S.sort.base = { k, d: s.k === k ? -s.d : 1 }; tablaBase(); });
  $('#tblBase').querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => abrirGestion('lead', Number(tr.dataset.id)));
  if ($('#btnMas')) $('#btnMas').onclick = () => { S.limit += 500; tablaBase(); };
}
async function nuevoLead() {
  const hoy = new Date(); const pad = (n) => String(n).padStart(2, '0');
  await modal('Nuevo lead', `<div class="form-grid">
    <div class="field"><label>Fecha asignación</label><input type="date" id="nf" value="${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}"></div>
    <div class="field"><label>Hora</label><input type="time" id="nh" value="${pad(hoy.getHours())}:${pad(hoy.getMinutes())}"></div>
    <div class="field"><label>Cédula</label><input type="text" id="nc"></div>
    <div class="field"><label>Número celular</label><input type="text" id="ncel"></div>
    <div class="field"><label>Correo</label><input type="email" id="nco"></div>
    <div class="field"><label>Campaña</label><select id="ncam">${opts(S.cat.campana || [], '', '—')}</select></div>
    <div class="field full"><label>Ejecutivo asignado</label><select id="np">${opts(S.promotores.filter((p) => p.activo).map((p) => [p.id, p.nombre]), '', '— Sin asignar —')}</select></div></div>`,
  [{ label: 'Cancelar' }, { label: 'Crear', cls: 'primary', onClick: async (r) => {
    if (!$('#nc', r).value && !$('#ncel', r).value) throw new Error('Indique cédula o celular');
    await q(sb.from('leads').insert(limpiar({ periodo: S.periodo, fecha_asignacion: $('#nf', r).value, hora: $('#nh', r).value, cedula: $('#nc', r).value,
      celular: $('#ncel', r).value, correo: $('#nco', r).value, campana: $('#ncam', r).value, promotor_id: $('#np', r).value })));
    toast('Lead creado', 'ok'); await loadLeads(); viewBase();
  } }]);
}

// ================= Gestión (segunda pestaña) =================
function gestionRegistro() {
  if (!S.gestion) return null;
  const list = S.gestion.tipo === 'lead' ? S.leads : S.bases;
  return list.find((r) => r.id === S.gestion.id) || null;
}
async function abrirGestion(tipo, id) {
  S.gestion = { tipo, id };
  if (tipo === 'base' && !S.leads.length) await loadLeads().catch(() => {});
  S.tab = 'gestion'; renderTabs(); viewGestion();
}
function telLinks(tel) {
  const t = String(tel || '').replace(/\D/g, '');
  if (!t) return '';
  const intl = t.length === 8 ? '505' + t : t;
  return `<a class="btn sm" href="tel:${esc(t)}">📞 Llamar ${esc(t)}</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${esc(intl)}">💬 WhatsApp</a>`;
}
function viewGestion() {
  const r = gestionRegistro();
  if (!r) { S.gestion = null; S.tab = 'base'; renderTabs(); return renderContent(); }
  const esLead = S.gestion.tipo === 'lead';
  const lista = esLead ? filtrarLeads() : filtrarBases();
  const idx = lista.findIndex((x) => x.id === r.id);
  const J = isJefe();
  const sel = (id, list, val, vacio = '—') => `<select id="${id}">${opts(list || [], val, vacio)}</select>`;
  const inp = (id, val, type = 'text', dis = false) => `<input type="${type}" id="${id}" value="${esc(val ?? '')}" ${dis ? 'disabled' : ''}>`;

  const datos = esLead
    ? (J ? `<div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="field"><label>Fecha asignación</label>${inp('g_fecha_asignacion', r.fecha_asignacion, 'date')}</div>
        <div class="field"><label>Hora</label>${inp('g_hora', r.hora, 'time')}</div>
        <div class="field"><label>Cédula</label>${inp('g_cedula', r.cedula)}</div>
        <div class="field"><label>Número celular</label>${inp('g_celular', r.celular)}</div>
        <div class="field full"><label>Correo</label>${inp('g_correo', r.correo, 'email')}</div>
        <div class="field"><label>Campaña</label>${sel('g_campana', S.cat.campana, r.campana)}</div>
        <div class="field"><label>Ejecutivo</label>${sel('g_promotor_id', S.promotores.map((p) => [p.id, p.nombre]), r.promotor_id, '— Sin asignar —')}</div></div>`
      : `<dl><dt>Fecha asignación</dt><dd>${esc(fdate(r.fecha_asignacion))} ${esc(r.hora || '')}</dd><dt>Cédula</dt><dd><b>${esc(r.cedula || '—')}</b></dd>
        <dt>Número celular</dt><dd>${esc(r.celular || '—')}</dd><dt>Correo</dt><dd>${esc(r.correo || '—')}</dd><dt>Campaña</dt><dd>${esc(r.campana || '—')}</dd></dl>`)
    : `<dl><dt>Base</dt><dd>${esc(r.tipo_base || '—')}</dd><dt>Cédula</dt><dd><b>${esc(r.cedula || '—')}</b></dd><dt>Nombre</dt><dd>${esc(r.nombre || '—')}</dd>
        <dt>Teléfono</dt><dd>${esc(r.telefono || '—')}</dd><dt>Correo</dt><dd>${esc(r.correo || '—')}</dd><dt>Tipo crédito / patrono</dt><dd>${esc(r.tipo_credito_patrono || '—')}</dd>
        <dt>Salario</dt><dd>${r.salario ? money(r.salario) : '—'}</dd><dt>HIT P. formalización</dt><dd>${esc(r.hit || '—')}</dd><dt>Razón no aplica</dt><dd>${esc(r.razon_no_aplica || '—')}</dd>
        ${J ? `<dt>Ejecutivo</dt><dd>${esc(r.promotor || 'Sin asignar')}</dd>` : ''}</dl>`;

  const g = esLead ? r : { ...r, comentarios: r.comentario };
  $('#content').innerHTML = `
  <div class="toolbar" style="align-items:center">
    <button class="btn" id="gBack">← Volver a ${esLead ? (J ? 'Base General' : 'Mi Base') : 'Bases'}</button>
    <div class="navrec"><button class="btn" id="gPrev" ${idx <= 0 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="muted">${idx >= 0 ? `${idx + 1} de ${lista.length}` : ''}</span>
      <button class="btn" id="gNext" ${idx < 0 || idx >= lista.length - 1 ? 'disabled' : ''}>Siguiente ›</button></div>
    <div class="spacer" style="flex:1"></div>${badge(r.estado)}
  </div>
  <div class="gestion">
    <div class="card datos"><div class="card-h verde"><h3>${esLead ? 'Datos del lead (asignación)' : 'Datos del precalificado'}</h3></div>
      <div class="card-b">${datos}<div class="contact">${telLinks(esLead ? r.celular : r.telefono)}${(esLead ? r.correo : r.correo) ? `<a class="btn sm" href="mailto:${esc(r.correo)}">✉ Correo</a>` : ''}</div></div></div>
    <div class="card"><div class="card-h azul"><h3>Gestión del promotor</h3><div class="spacer"></div><span class="small muted">${r.updated_at ? 'Última actualización: ' + esc(fdt(r.updated_at)) : 'Sin gestión registrada'}</span></div>
      <div class="card-b"><form id="fGest" class="form-grid">
        ${esLead ? `<div class="field"><label>Cédula lead</label>${inp('g_cedula_lead', r.cedula_lead)}</div>
        <div class="field"><label>Perfil lead</label>${sel('g_perfil_lead', S.cat.perfil, r.perfil_lead)}</div>` : ''}
        <div class="field"><label>Tipificación</label>${sel('g_tipificacion', S.cat.tipificacion, g.tipificacion)}</div>
        <div class="field"><label>Estado</label>${sel('g_estado', S.cat.estado, g.estado, '— Pendiente —')}</div>
        <div class="field"><label>Monto colocado (C$)</label>${inp('g_monto', g.monto, 'number')}</div>
        <div class="field"><label>Fecha formalizado</label>${inp('g_fecha_formalizado', g.fecha_formalizado, 'date')}</div>
        <div class="field"><label>Seguro</label>${sel('g_seguro', S.cat.seguro, g.seguro)}</div>
        <div class="field full"><label>Comentarios</label><textarea id="g_comentarios" rows="3">${esc(g.comentarios || '')}</textarea></div>
        <div class="full" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          ${J && esLead ? '<button type="button" class="btn danger" id="gDel">Eliminar lead</button><div style="flex:1"></div>' : ''}
          <button type="submit" class="btn">Guardar</button>
          <button type="button" class="btn azul" id="gSaveNext">Guardar y siguiente pendiente ›</button>
        </div></form>
        <details class="hist" id="gHist"><summary>Historial de cambios</summary><ul id="gHistList"><li class="muted">Cargando…</li></ul></details>
      </div></div>
  </div>`;
  const ir = (i) => { if (lista[i]) { S.gestion.id = lista[i].id; renderTabs(); viewGestion(); } };
  $('#gBack').onclick = () => { S.tab = esLead ? 'base' : 'bases'; renderTabs(); renderContent(); };
  $('#gPrev').onclick = () => ir(idx - 1);
  $('#gNext').onclick = () => ir(idx + 1);
  // Fecha formalizado automática al marcar Formalizado
  $('#g_estado').onchange = (e) => { if (e.target.value === 'Formalizado' && !$('#g_fecha_formalizado').value) $('#g_fecha_formalizado').value = new Date().toISOString().slice(0, 10); };
  const guardar = async () => {
    const campos = esLead
      ? ['cedula_lead', 'perfil_lead', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentarios', ...(J ? ['fecha_asignacion', 'hora', 'cedula', 'celular', 'correo', 'campana', 'promotor_id'] : [])]
      : ['tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentarios'];
    const body = {};
    for (const c of campos) { const el = $('#g_' + c); if (el) body[c === 'comentarios' && !esLead ? 'comentario' : c] = el.value; }
    const datos = limpiar(body);
    if (datos.estado === 'Formalizado' && !(datos.monto > 0)) throw new Error('Para marcar "Formalizado" debe indicar el monto colocado');
    const upd = await q(sb.from(esLead ? 'leads' : 'bases').update(datos).eq('id', r.id).select().single());
    const list = esLead ? S.leads : S.bases; const i = list.findIndex((x) => x.id === r.id);
    list[i] = { ...upd, promotor: nombreDe(upd.promotor_id) };
    toast('Gestión guardada', 'ok');
  };
  $('#fGest').onsubmit = async (e) => { e.preventDefault(); try { await guardar(); viewGestion(); } catch (err) { fail(err); } };
  $('#gSaveNext').onclick = async () => {
    try {
      await guardar();
      const l2 = esLead ? filtrarLeads() : filtrarBases();
      const start = Math.max(0, l2.findIndex((x) => x.id === r.id));
      const next = [...l2.slice(start + 1), ...l2.slice(0, start)].find((x) => !x.estado && x.id !== r.id);
      if (next) { S.gestion.id = next.id; renderTabs(); viewGestion(); } else { toast('No quedan registros pendientes en la lista'); viewGestion(); }
    } catch (err) { fail(err); }
  };
  if ($('#gDel')) $('#gDel').onclick = async () => {
    if (!(await confirmar('Eliminar lead', `¿Eliminar definitivamente el lead <b>${esc(r.cedula || r.celular)}</b>?`))) return;
    try { await q(sb.from('leads').delete().eq('id', r.id)); S.leads = S.leads.filter((x) => x.id !== r.id); S.gestion = null; S.tab = 'base'; renderTabs(); renderContent(); toast('Lead eliminado'); } catch (e) { fail(e); }
  };
  $('#gHist').ontoggle = async () => {
    if (!$('#gHist').open) return;
    try {
      const h = await q(sb.from('historial').select('*').eq('entidad', esLead ? 'leads' : 'bases').eq('entidad_id', r.id).order('id', { ascending: false }));
      $('#gHistList').innerHTML = h.length ? h.map((x) => { const c = x.cambios;
        return `<li><b>${esc(fdt(x.at))}</b> · ${esc(nombreDe(x.user_id) || (isJefe() ? '' : 'Jefe'))}: ${Object.keys(c.despues).map((k) => `${esc(k)}: <s>${esc(c.antes[k] ?? '∅')}</s> → ${esc(c.despues[k] ?? '∅')}`).join('; ')}</li>`; }).join('')
        : '<li class="muted">Sin cambios registrados.</li>';
    } catch (e) { fail(e); }
  };
}

// ================= Producción =================
function viewProduccion() {
  const f = S.f.prod;
  const rows = S.prod.filter((p) => !f.promotor || String(p.promotor_id) === f.promotor);
  const total = sum(rows, (r) => r.monto);
  const seguros = rows.filter((r) => r.seguro && r.seguro !== 'N/A').length;
  const grupo = (pred) => { const g = rows.filter(pred); return { n: g.length, m: sum(g, (r) => r.monto) }; };
  const resp = grupo((r) => r.campana === 'Respond');
  const goog = grupo((r) => ['Google', 'Organico'].includes(r.campana));
  const base = grupo((r) => r.origen === 'base');
  $('#content').innerHTML = `
    <div class="toolbar"><div><div class="section-title">Producción · ${esc(nombrePeriodo(S.periodo))}</div>
      <div class="muted">Todo lo marcado como <b>Formalizado</b> en la base del mes y en Bases.</div></div>
      <div class="spacer" style="flex:1"></div>
      ${isJefe() ? `<div class="field"><label>Ejecutivo</label><select id="fpp">${opts(S.promotores.map((p) => [String(p.id), p.nombre]), f.promotor, 'Todos')}</select></div>` : ''}</div>
    <div class="kpis">
      <div class="kpi ok"><div class="l">Desembolso total</div><div class="v">${money(total)}</div></div>
      <div class="kpi"><div class="l">Clientes total</div><div class="v">${int(rows.length)}</div></div>
      <div class="kpi"><div class="l">Ticket promedio</div><div class="v">${money(total / (rows.length || 1))}</div></div>
      <div class="kpi"><div class="l">Seguros vendidos</div><div class="v">${int(seguros)}</div><div class="s">${pct(seguros / (rows.length || 1))} de penetración</div></div>
      <div class="kpi azul"><div class="l">Desembolso Respond</div><div class="v">${money(resp.m)}</div><div class="s">${resp.n} clientes</div></div>
      <div class="kpi azul"><div class="l">Desembolso Google + Orgánico</div><div class="v">${money(goog.m)}</div><div class="s">${goog.n} clientes</div></div>
      <div class="kpi verde"><div class="l">Desembolso Bases</div><div class="v">${money(base.m)}</div><div class="s">${base.n} clientes</div></div>
    </div>
    <div class="tbl-wrap"><table class="tbl-compact"><thead><tr>
      <th>Fecha asignación</th><th>Cédula lead</th><th>Campaña</th><th>Perfil</th><th>Tipificación</th><th>Estado</th><th class="num">Monto</th><th>Fecha formalizado</th><th>Seguro</th>${isJefe() ? '<th>Ejecutivo</th>' : ''}<th>Comentario</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="click" data-o="${r.origen}" data-id="${r.id}"><td>${esc(fdate(r.fecha_asignacion))}</td><td>${esc(r.cedula || '')}</td><td>${esc(r.campana || '')}</td>
        <td>${esc(r.perfil || '')}</td><td>${esc(r.tipificacion || '')}</td><td>${badge(r.estado)}</td><td class="num">${money(r.monto)}</td><td>${esc(fdate(r.fecha_formalizado))}</td>
        <td>${esc(r.seguro || '')}</td>${isJefe() ? `<td>${esc(r.promotor || '')}</td>` : ''}<td class="ellipsis" title="${esc(r.comentario)}">${esc(r.comentario || '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">${rows.length} formalizados</td><td class="num">${money(total)}</td><td colspan="${isJefe() ? 4 : 3}"></td></tr></tfoot></table>
      ${rows.length ? '' : '<div class="empty">Aún no hay formalizaciones en este periodo.</div>'}</div>`;
  if ($('#fpp')) $('#fpp').onchange = (e) => { f.promotor = e.target.value; viewProduccion(); };
  $('#content').querySelectorAll('tr.click').forEach((tr) => tr.onclick = async () => {
    const tipo = tr.dataset.o === 'base' ? 'base' : 'lead';
    if (tipo === 'lead' && !S.leads.length) await loadLeads(); if (tipo === 'base' && !S.bases.length) await loadBases();
    abrirGestion(tipo, Number(tr.dataset.id));
  });
}

// ================= Bases precalificadas =================
function filtrarBases() {
  const f = S.f.bases; const q = norm(f.q);
  return S.bases.filter((b) => (!f.tipo_base || b.tipo_base === f.tipo_base) && (!f.tipificacion || b.tipificacion === f.tipificacion)
    && (!f.promotor || (f.promotor === 'sin' ? !b.promotor_id : String(b.promotor_id) === f.promotor)) && (!f.pendientes || !b.tipificacion)
    && (!q || norm([b.cedula, b.nombre, b.telefono, b.correo, b.comentario].join(' ')).includes(q)));
}
function viewBases() {
  const f = S.f.bases; const all = S.bases;
  const gest = all.filter((b) => b.tipificacion).length;
  $('#content').innerHTML = `
    <div class="kpis">
      <div class="kpi verde"><div class="l">Registros en bases</div><div class="v">${int(all.length)}</div></div>
      <div class="kpi azul"><div class="l">Gestionados</div><div class="v">${int(gest)}</div><div class="s">${pct(gest / (all.length || 1))} de avance</div></div>
      <div class="kpi"><div class="l">Pendientes</div><div class="v">${int(all.length - gest)}</div></div>
      <div class="kpi ok"><div class="l">Formalizados</div><div class="v">${int(all.filter((b) => b.estado === 'Formalizado').length)}</div><div class="s">${money(sum(all.filter((b) => b.estado === 'Formalizado'), (b) => b.monto))}</div></div>
    </div>
    <div class="toolbar">
      <div class="field grow"><label>Buscar</label><input type="search" id="bq" placeholder="Cédula, nombre, teléfono…" value="${esc(f.q)}"></div>
      <div class="field"><label>Base</label><select id="btb">${opts(S.cat.tipo_base || [], f.tipo_base, 'Todas')}</select></div>
      ${isJefe() ? `<div class="field"><label>Ejecutivo</label><select id="bprom">${opts([['sin', '— Sin asignar —'], ...S.promotores.map((p) => [String(p.id), p.nombre])], f.promotor, 'Todos')}</select></div>` : ''}
      <div class="field"><label>Tipificación</label><select id="btip">${opts(S.cat.tipificacion || [], f.tipificacion, 'Todas')}</select></div>
      <label class="check" style="padding-bottom:8px"><input type="checkbox" id="bpend" ${f.pendientes ? 'checked' : ''}> Solo pendientes</label>
    </div><div id="tblBases"></div>`;
  const bind = (id, key, chk) => { const el = $(id); if (!el) return; el.oninput = () => { f[key] = chk ? el.checked : el.value; tablaBases(); }; };
  bind('#bq', 'q'); bind('#btb', 'tipo_base'); bind('#bprom', 'promotor'); bind('#btip', 'tipificacion'); bind('#bpend', 'pendientes', true);
  tablaBases();
}
function tablaBases() {
  const rows = filtrarBases();
  $('#tblBases').innerHTML = `<div class="tbl-wrap"><table class="tbl-compact"><thead>
    <tr class="grp"><th colspan="${isJefe() ? 10 : 9}" class="g-verde">Datos de la base</th><th colspan="4" class="g-azul">Gestión</th></tr>
    <tr><th class="h-verde">Base</th><th class="h-verde">Cédula</th><th class="h-verde">Nombre</th><th class="h-verde">Teléfono</th><th class="h-verde">Correo</th>
    <th class="h-verde">Tipo crédito patrono</th><th class="h-verde num">Salario</th><th class="h-verde">HIT</th><th class="h-verde">Razón no aplica</th>${isJefe() ? '<th class="h-verde">Ejecutivo</th>' : ''}
    <th class="h-azul">Tipificación</th><th class="h-azul">Estado</th><th class="h-azul num">Monto</th><th class="h-azul">Comentario</th></tr></thead>
    <tbody>${rows.map((b) => `<tr class="click" data-id="${b.id}"><td>${esc(b.tipo_base || '')}</td><td>${esc(b.cedula || '')}</td><td>${esc(b.nombre || '')}</td>
      <td>${esc(b.telefono || '')}</td><td class="ellipsis">${esc(b.correo || '')}</td><td>${esc(b.tipo_credito_patrono || '')}</td><td class="num">${b.salario ? money(b.salario) : ''}</td>
      <td>${esc(b.hit || '')}</td><td>${esc(b.razon_no_aplica || '')}</td>${isJefe() ? `<td>${esc(b.promotor || '—')}</td>` : ''}
      <td class="c-azul">${esc(b.tipificacion || '')}</td><td class="c-azul">${b.estado ? badge(b.estado) : ''}</td><td class="c-azul num">${b.monto ? money(b.monto) : ''}</td>
      <td class="c-azul ellipsis" title="${esc(b.comentario)}">${esc(b.comentario || '')}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${isJefe() ? 14 : 13}">${rows.length} registros</td></tr></tfoot></table>
    ${rows.length ? '' : `<div class="empty">${S.bases.length ? 'No hay registros con estos filtros.' : 'No tiene bases asignadas en este periodo.'}</div>`}</div>`;
  $('#tblBases').querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => abrirGestion('base', Number(tr.dataset.id)));
}

// ================= Cálculo Desfase (Jefe) =================
function calcDesfase() {
  const m = S.metas; const per = S.periodo;
  const hoy = new Date(); const finMes = new Date(Number(per.slice(0, 4)), Number(per.slice(5)), 0);
  const dh = m.dias_habiles ?? diasHabiles(per);
  const dfAuto = hoy > finMes ? dh : diasHabiles(per, hoy);
  const df = m.dias_fecha ?? dfAuto;
  const formRows = S.prod;
  const formalizado = sum(formRows, (r) => r.monto);
  const metaFecha = dh ? (m.meta_mensual / dh) * df : 0;
  const campanas = (m.campanas || []).map((c) => {
    const nombres = String(c.campana).split(',').map((s) => norm(s.trim()));
    const leadsC = S.leads.filter((l) => nombres.includes(norm(l.campana)));
    const llevamos = c.leads_llevamos != null && c.leads_llevamos !== '' ? Number(c.leads_llevamos) : leadsC.length;
    const deberiamos = dh ? (Number(c.leads_requeridos) / dh) * df : 0;
    const formC = formRows.filter((r) => nombres.includes(norm(r.campana)));
    const debLeads = deberiamos * m.conversion;
    return { ...c, llevamos, auto: !(c.leads_llevamos != null && c.leads_llevamos !== ''), deberiamos, faltan: deberiamos - llevamos,
      formN: formC.length, formM: sum(formC, (r) => r.monto), debLeads, debMonto: debLeads * Number(c.ticket_esperado || 0) };
  });
  return { dh, df, dfAuto, formalizado, metaFecha, n: formRows.length, campanas,
    cumpFecha: metaFecha ? formalizado / metaFecha : 0, desfFecha: metaFecha - formalizado,
    cumpMes: m.meta_mensual ? formalizado / m.meta_mensual : 0, desfMes: m.meta_mensual - formalizado,
    proyeccion: df ? (formalizado / df) * dh : 0 };
}
function viewDesfase() {
  const m = S.metas; const c = calcDesfase();
  const cls = (v) => (v >= 1 ? 'ok' : 'bad');
  $('#content').innerHTML = `
  <div class="section-title">Cálculo de desfase · ${esc(nombrePeriodo(S.periodo))}</div>
  <p class="section-sub">Meta prorrateada por días hábiles (lunes a viernes = 1 día, sábado = ½ día) contra lo formalizado en la base del mes y en Bases.</p>
  <div class="kpis">
    <div class="kpi"><div class="l">Meta mensual</div><div class="v">${money(m.meta_mensual)}</div><div class="s">${usd(m.meta_mensual / m.tipo_cambio)}</div></div>
    <div class="kpi"><div class="l">Meta a la fecha</div><div class="v">${money(c.metaFecha)}</div><div class="s">${dec(c.df)} de ${dec(c.dh)} días hábiles</div></div>
    <div class="kpi ${cls(c.cumpFecha)}"><div class="l">Formalizado a la fecha</div><div class="v">${money(c.formalizado)}</div><div class="s">${pct(c.cumpFecha)} de la meta a la fecha · ${c.n} créditos</div></div>
    <div class="kpi ${c.desfFecha > 0 ? 'bad' : 'ok'}"><div class="l">Desfase a la fecha</div><div class="v">${money(c.desfFecha)}</div><div class="s">${pct(1 - c.cumpFecha)}</div></div>
    <div class="kpi ${cls(c.proyeccion / (m.meta_mensual || 1))}"><div class="l">Proyección de cierre</div><div class="v">${money(c.proyeccion)}</div><div class="s">${pct(c.proyeccion / (m.meta_mensual || 1))} de la meta</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="card-h"><h3>Resumen del mes</h3></div><div class="card-b">
      <table class="tbl-compact"><tbody>
        <tr><td>Cumplimiento meta mensual</td><td class="num"><b>${pct(c.cumpMes)}</b></td><td style="width:40%"><div class="bar progress-big ${cls(c.cumpMes)}"><i style="width:${Math.min(100, c.cumpMes * 100)}%"></i></div></td></tr>
        <tr><td>Cumplimiento meta a la fecha</td><td class="num"><b>${pct(c.cumpFecha)}</b></td><td><div class="bar progress-big ${cls(c.cumpFecha)}"><i style="width:${Math.min(100, c.cumpFecha * 100)}%"></i></div></td></tr>
        <tr><td>Desfase mensual</td><td class="num">${money(c.desfMes)}</td><td class="muted">${pct(c.desfMes / (m.meta_mensual || 1))} de la meta</td></tr>
        <tr><td>Ticket promedio</td><td class="num">${money(c.formalizado / (c.n || 1))}</td><td></td></tr>
        <tr><td>Necesario por día hábil restante</td><td class="num">${money(c.desfMes / Math.max(0.5, c.dh - c.df))}</td><td class="muted">${dec(Math.max(0, c.dh - c.df))} días restantes</td></tr>
        <tr><td>Total desembolsado (USD)</td><td class="num">${usd(c.formalizado / m.tipo_cambio)}</td><td class="muted">T/C ${dec(m.tipo_cambio, 4)}</td></tr>
      </tbody></table></div></div>
    <div class="card"><div class="card-h"><h3>Parámetros</h3><div class="spacer"></div><button class="btn primary sm" id="mSave">Guardar</button></div><div class="card-b">
      <div class="form-grid">
        <div class="field"><label>Meta mensual (C$)</label><input type="number" id="m_meta" value="${m.meta_mensual || ''}"></div>
        <div class="field"><label>Días hábiles del mes</label><input type="number" step="0.5" id="m_dh" value="${m.dias_habiles ?? ''}" placeholder="Auto: ${dec(diasHabiles(S.periodo))}"></div>
        <div class="field"><label>Días a la fecha</label><input type="number" step="0.5" id="m_df" value="${m.dias_fecha ?? ''}" placeholder="Auto: ${dec(c.dfAuto)}"></div>
        <div class="field"><label>Tipo de cambio (C$/USD)</label><input type="number" step="0.0001" id="m_tc" value="${m.tipo_cambio}"></div>
        <div class="field"><label>Conversión esperada de leads (%)</label><input type="number" step="0.1" id="m_conv" value="${+(m.conversion * 100).toFixed(2)}"></div>
      </div>
      <p class="small muted">Deje "Días" vacío para calcularlos automáticamente con el calendario.</p>
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h3>Volumen de leads y formalizaciones por campaña</h3><div class="spacer"></div><button class="btn sm" id="mAddC">+ Campaña</button></div>
    <div class="tbl-wrap free"><table class="tbl-compact"><thead><tr>
      <th>Campaña</th><th class="num">Leads requeridos (mes)</th><th class="num">Llevamos</th><th class="num">Deberíamos</th><th class="num">Faltan</th>
      <th class="num">Formalizados llevamos</th><th class="num">Formalizados deberíamos</th><th class="num">Monto llevamos</th><th class="num">Monto deberíamos</th>
      <th class="num">Ticket esperado</th><th class="num">Ticket real</th><th></th></tr></thead>
      <tbody>${c.campanas.map((x, i) => `<tr>
        <td><input type="text" data-c="${i}" data-k="campana" value="${esc(x.campana)}" title="Puede agrupar varias separadas por coma: Google, Organico" style="min-width:140px"></td>
        <td class="num"><input type="number" data-c="${i}" data-k="leads_requeridos" value="${x.leads_requeridos ?? ''}" style="width:100px"></td>
        <td class="num"><input type="number" data-c="${i}" data-k="leads_llevamos" value="${x.auto ? '' : x.llevamos}" placeholder="${x.auto ? int(x.llevamos) : ''}" title="Vacío = contar leads de la base. Escriba el volumen real de la plataforma si es distinto." style="width:90px"></td>
        <td class="num">${int(x.deberiamos)}</td><td class="num" style="color:${x.faltan > 0 ? 'var(--bad)' : 'var(--ok)'}">${int(x.faltan)}</td>
        <td class="num">${int(x.formN)}</td><td class="num">${dec(x.debLeads)}</td><td class="num">${money(x.formM)}</td><td class="num">${money(x.debMonto)}</td>
        <td class="num"><input type="number" data-c="${i}" data-k="ticket_esperado" value="${x.ticket_esperado ?? ''}" style="width:100px"></td>
        <td class="num">${money(x.formM / (x.formN || 1))}</td>
        <td><button class="btn sm danger" data-del="${i}" title="Quitar">✕</button></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${int(sum(c.campanas, (x) => x.leads_requeridos))}</td><td class="num">${int(sum(c.campanas, (x) => x.llevamos))}</td>
        <td class="num">${int(sum(c.campanas, (x) => x.deberiamos))}</td><td class="num">${int(sum(c.campanas, (x) => x.faltan))}</td><td class="num">${int(sum(c.campanas, (x) => x.formN))}</td>
        <td class="num">${dec(sum(c.campanas, (x) => x.debLeads))}</td><td class="num">${money(sum(c.campanas, (x) => x.formM))}</td><td class="num">${money(sum(c.campanas, (x) => x.debMonto))}</td><td colspan="3"></td></tr></tfoot>
    </table></div></div>`;
  const leerForm = () => {
    const camp = (m.campanas || []).map((x) => ({ ...x }));
    $('#content').querySelectorAll('input[data-c]').forEach((el) => { const x = camp[Number(el.dataset.c)]; const k = el.dataset.k; x[k] = k === 'campana' ? el.value : (el.value === '' ? null : Number(el.value)); });
    return { meta_mensual: $('#m_meta').value, dias_habiles: $('#m_dh').value, dias_fecha: $('#m_df').value, tipo_cambio: $('#m_tc').value,
      conversion: $('#m_conv').value === '' ? 0.026 : Number($('#m_conv').value) / 100, campanas: camp };
  };
  const guardar = async (cambio) => {
    const body = leerForm(); if (cambio) cambio(body);
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const fila = { periodo: S.periodo, meta_mensual: num(body.meta_mensual) || 0, dias_habiles: num(body.dias_habiles), dias_fecha: num(body.dias_fecha),
      tipo_cambio: num(body.tipo_cambio) || 36.6243, conversion: num(body.conversion) ?? 0.026, campanas: body.campanas };
    try { await q(sb.from('metas').upsert(fila)); await loadMetas(); viewDesfase(); toast('Parámetros guardados', 'ok'); } catch (e) { fail(e); }
  };
  $('#mSave').onclick = () => guardar();
  $('#mAddC').onclick = () => guardar((b) => b.campanas.push({ campana: 'Nueva', leads_requeridos: 0, ticket_esperado: 0 }));
  $('#content').querySelectorAll('[data-del]').forEach((b) => b.onclick = () => guardar((x) => x.campanas.splice(Number(b.dataset.del), 1)));
  $('#content').querySelectorAll('input[data-c]').forEach((el) => el.onchange = () => guardar());
}

// ================= Tablas y pivotes =================
const CAMPOS = {
  promotor: { l: 'Ejecutivo', f: (r) => r.promotor || '(Sin asignar)' },
  campana: { l: 'Campaña', f: (r) => r.campana || '(Vacío)' },
  perfil_lead: { l: 'Perfil lead', f: (r) => r.perfil_lead || '(Vacío)' },
  tipificacion: { l: 'Tipificación', f: (r) => r.tipificacion || '(Vacío)' },
  estado: { l: 'Estado', f: (r) => r.estado || 'Pendiente' },
  seguro: { l: 'Seguro', f: (r) => r.seguro || '(Vacío)' },
  fecha_asignacion: { l: 'Fecha asignación', f: (r) => r.fecha_asignacion || '(Vacío)', fecha: true },
  semana: { l: 'Semana asignación', f: (r) => { if (!r.fecha_asignacion) return '(Vacío)'; const d = new Date(r.fecha_asignacion + 'T00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return 'Sem. ' + d.toISOString().slice(0, 10); } },
  fecha_formalizado: { l: 'Fecha formalizado', f: (r) => r.fecha_formalizado || '(Vacío)', fecha: true },
  hora: { l: 'Hora', f: (r) => (r.hora ? r.hora.slice(0, 2) + ':00' : '(Vacío)') },
};
const VALORES = {
  n: { l: 'Cantidad de leads', f: (g) => g.length, fmt: int },
  form: { l: 'Formalizados (cant.)', f: (g) => g.filter((r) => r.estado === 'Formalizado').length, fmt: int },
  monto: { l: 'Monto colocado (C$)', f: (g) => sum(g.filter((r) => r.estado === 'Formalizado'), (r) => r.monto), fmt: money },
  ticket: { l: 'Ticket promedio', f: (g) => { const x = g.filter((r) => r.estado === 'Formalizado'); return x.length ? sum(x, (r) => r.monto) / x.length : null; }, fmt: money },
  conv: { l: '% Conversión', f: (g) => (g.length ? g.filter((r) => r.estado === 'Formalizado').length / g.length : null), fmt: pct },
};
function agrupar(rows, fn) { const m = new Map(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
function pivotHTML(rows, filaKey, colKey, valKey, { titulo, ordenarPor = 'valor', pctTotal = false } = {}) {
  const F = CAMPOS[filaKey], C = colKey ? CAMPOS[colKey] : null, V = VALORES[valKey];
  const g = agrupar(rows, F.f);
  let filas = [...g.keys()];
  if (F.fecha || ordenarPor === 'clave') filas.sort();
  else filas.sort((a, b) => (V.f(g.get(b)) || 0) - (V.f(g.get(a)) || 0));
  const cols = C ? [...new Set(rows.map(C.f))].sort((a, b) => (C.fecha ? a.localeCompare(b) : rows.filter((r) => C.f(r) === b).length - rows.filter((r) => C.f(r) === a).length)) : [];
  const total = V.f(rows);
  const lab = (k, def) => (def.fecha && /^\d{4}-/.test(k) ? fdate(k) : k);
  return `<div class="tbl-wrap free"><table class="tbl-compact"><thead><tr><th>${esc(F.l)}${C ? ' \\ ' + esc(C.l) : ''}</th>
    ${C ? cols.map((c) => `<th class="num">${esc(lab(c, C))}</th>`).join('') : `<th class="num">${esc(V.l)}</th>`}${C ? '<th class="num">Total</th>' : ''}${pctTotal ? '<th class="num">%</th>' : ''}</tr></thead>
    <tbody>${filas.map((fk) => { const gr = g.get(fk); const v = V.f(gr);
      return `<tr><td>${esc(lab(fk, F))}</td>${C ? cols.map((c) => { const sub = gr.filter((r) => C.f(r) === c); return `<td class="num">${sub.length ? V.fmt(V.f(sub)) : ''}</td>`; }).join('') : ''}
      <td class="num">${V.fmt(v)}</td>${pctTotal ? `<td class="num">${pct(v / (total || 1))}</td>` : ''}</tr>`; }).join('')}</tbody>
    <tfoot><tr><td>Total</td>${C ? cols.map((c) => `<td class="num">${V.fmt(V.f(rows.filter((r) => C.f(r) === c)))}</td>`).join('') : ''}<td class="num">${V.fmt(total)}</td>${pctTotal ? '<td class="num">100%</td>' : ''}</tr></tfoot>
    </table>${rows.length ? '' : '<div class="empty">Sin datos</div>'}</div>`;
}
function viewTablas() {
  const L = S.leads; const form = L.filter((r) => r.estado === 'Formalizado');
  const tc = 36.6243;
  const porAsesor = [...agrupar(L, CAMPOS.promotor.f)].map(([k, g]) => {
    const f = g.filter((r) => r.estado === 'Formalizado'); const m = sum(f, (r) => r.monto);
    return { k, n: g.length, gest: g.filter((r) => r.estado).length, fn: f.length, m, pend: g.filter((r) => !r.estado).length };
  }).sort((a, b) => b.m - a.m);
  const totM = sum(form, (r) => r.monto);
  const porCamp = [...agrupar(form, CAMPOS.campana.f)].map(([k, g]) => ({ k, n: g.length, m: sum(g, (r) => r.monto) })).sort((a, b) => b.m - a.m);
  const bases = S.prod.filter((p) => p.origen === 'base');
  $('#content').innerHTML = `
  <div class="section-title">Tablas de consolidación · ${esc(nombrePeriodo(S.periodo))}</div>
  <p class="section-sub">Equivalente a la pestaña "Tablas" de la Tabla Madre; se recalcula sola con cada gestión.</p>
  <div class="grid g2">
    <div class="card"><div class="card-h"><h3>Resultados por ejecutivo</h3></div><div class="tbl-wrap free"><table class="tbl-compact"><thead><tr>
      <th>Ejecutivo</th><th class="num">Asignados</th><th class="num">Gestionados</th><th class="num">Pendientes</th><th class="num">Formalizados</th><th class="num">C$</th><th class="num">Ticket</th><th class="num">Conversión</th><th>Contribución</th></tr></thead>
      <tbody>${porAsesor.map((a) => `<tr><td>${esc(a.k)}</td><td class="num">${int(a.n)}</td><td class="num">${int(a.gest)}</td><td class="num">${int(a.pend)}</td><td class="num">${int(a.fn)}</td>
        <td class="num">${money(a.m)}</td><td class="num">${a.fn ? money(a.m / a.fn) : '—'}</td><td class="num">${pct(a.fn / (a.n || 1))}</td>
        <td><div class="bar"><i style="width:${(a.m / (totM || 1)) * 100}%"></i></div><span class="small muted">${pct(a.m / (totM || 1))}</span></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${int(L.length)}</td><td class="num">${int(L.filter((r) => r.estado).length)}</td><td class="num">${int(L.filter((r) => !r.estado).length)}</td>
        <td class="num">${int(form.length)}</td><td class="num">${money(totM)}</td><td class="num">${money(totM / (form.length || 1))}</td><td class="num">${pct(form.length / (L.length || 1))}</td><td></td></tr></tfoot></table></div></div>
    <div class="card"><div class="card-h"><h3>Formalizado por campaña</h3></div><div class="tbl-wrap free"><table class="tbl-compact"><thead><tr>
      <th>Campaña</th><th class="num">Cant.</th><th class="num">Monto colocado</th><th class="num">Contribución</th><th class="num">Ticket promedio</th><th class="num">USD</th></tr></thead>
      <tbody>${porCamp.map((c) => `<tr><td>${esc(c.k)}</td><td class="num">${int(c.n)}</td><td class="num">${money(c.m)}</td><td class="num">${pct(c.m / (totM || 1))}</td>
        <td class="num">${money(c.m / (c.n || 1))}</td><td class="num">${usd(c.m / tc)}</td></tr>`).join('')}
        ${bases.length ? `<tr><td>Bases precalificadas</td><td class="num">${bases.length}</td><td class="num">${money(sum(bases, (b) => b.monto))}</td><td class="num">—</td><td class="num">${money(sum(bases, (b) => b.monto) / bases.length)}</td><td class="num">${usd(sum(bases, (b) => b.monto) / tc)}</td></tr>` : ''}</tbody>
      <tfoot><tr><td>Total base del mes</td><td class="num">${int(form.length)}</td><td class="num">${money(totM)}</td><td class="num">100%</td><td class="num">${money(totM / (form.length || 1))}</td><td class="num">${usd(totM / tc)}</td></tr></tfoot></table></div></div>
    <div class="card"><div class="card-h"><h3>Leads por campaña</h3></div>${pivotHTML(L, 'campana', null, 'n', { pctTotal: true })}</div>
    <div class="card"><div class="card-h"><h3>Tipificación de los leads</h3></div>${pivotHTML(L, 'tipificacion', null, 'n', { pctTotal: true })}</div>
    <div class="card"><div class="card-h"><h3>Perfil del lead</h3></div>${pivotHTML(L, 'perfil_lead', 'estado', 'n')}</div>
    <div class="card"><div class="card-h"><h3>Colocación por fecha de formalización</h3></div>${pivotHTML(form, 'fecha_formalizado', null, 'monto', { pctTotal: true })}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h3>Leads por fecha de asignación y campaña</h3></div>${pivotHTML(L, 'fecha_asignacion', 'campana', 'n')}</div>`;
}

// ================= Campañas =================
function viewCampanas() {
  const L = S.leads;
  const camps = [...agrupar(L, CAMPOS.campana.f)].sort((a, b) => b[1].length - a[1].length);
  const form = L.filter((r) => r.estado === 'Formalizado');
  $('#content').innerHTML = `
  <div class="section-title">Leads por campaña · ${esc(nombrePeriodo(S.periodo))}</div>
  <p class="section-sub">Tipificación y monto colocado de cada campaña (equivalente a la pestaña "Campañas").</p>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card"><div class="card-h"><h3>Resumen por campaña</h3></div><div class="tbl-wrap free"><table class="tbl-compact"><thead><tr>
      <th>Campaña</th><th class="num">Leads</th><th class="num">Gestionados</th><th class="num">Formalizados</th><th class="num">Conversión</th><th class="num">Monto colocado</th><th class="num">Ticket</th></tr></thead>
      <tbody>${camps.map(([k, g]) => { const f = g.filter((r) => r.estado === 'Formalizado'); return `<tr><td><b>${esc(k)}</b></td><td class="num">${g.length}</td>
        <td class="num">${g.filter((r) => r.estado).length}</td><td class="num">${f.length}</td><td class="num">${pct(f.length / g.length)}</td>
        <td class="num">${money(sum(f, (r) => r.monto))}</td><td class="num">${f.length ? money(sum(f, (r) => r.monto) / f.length) : '—'}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${L.length}</td><td class="num">${L.filter((r) => r.estado).length}</td><td class="num">${form.length}</td>
        <td class="num">${pct(form.length / (L.length || 1))}</td><td class="num">${money(sum(form, (r) => r.monto))}</td><td class="num">${money(sum(form, (r) => r.monto) / (form.length || 1))}</td></tr></tfoot></table></div></div>
    <div class="card"><div class="card-h"><h3>Formalizaciones: campaña × perfil</h3></div>${pivotHTML(form, 'campana', 'perfil_lead', 'monto')}</div>
  </div>
  <div class="grid g3">${camps.map(([k, g]) => `<div class="card"><div class="card-h"><h3>${esc(k.toUpperCase())}</h3><div class="spacer"></div>
    <span class="badge">${g.length} leads</span></div>
    <div class="tbl-wrap free"><table class="tbl-compact"><thead><tr><th>Tipificación</th><th class="num">Cant.</th><th class="num">Monto colocado</th></tr></thead>
    <tbody>${[...agrupar(g, CAMPOS.tipificacion.f)].sort((a, b) => b[1].length - a[1].length).map(([t, x]) => `<tr><td>${esc(t)}</td><td class="num">${x.length}</td>
      <td class="num">${sum(x.filter((r) => r.estado === 'Formalizado'), (r) => r.monto) ? money(sum(x.filter((r) => r.estado === 'Formalizado'), (r) => r.monto)) : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${g.length}</td><td class="num">${money(sum(g.filter((r) => r.estado === 'Formalizado'), (r) => r.monto))}</td></tr></tfoot></table></div></div>`).join('')}</div>`;
}

// ================= Tabla dinámica =================
function viewDinamica() {
  const p = S.f.piv;
  const campos = Object.entries(CAMPOS).map(([k, v]) => [k, v.l]);
  $('#content').innerHTML = `
  <div class="section-title">Tabla dinámica</div>
  <p class="section-sub">Arme su propio cruce de la base del mes: elija filas, columnas, valor y filtros.</p>
  <div class="card" style="margin-bottom:16px"><div class="card-b pivot-cfg">
    <div class="field"><label>Filas</label><select id="pf">${opts(campos, p.filas, null)}</select></div>
    <div class="field"><label>Columnas</label><select id="pc">${opts(campos, p.cols, '(Ninguna)')}</select></div>
    <div class="field"><label>Valor</label><select id="pv">${opts(Object.entries(VALORES).map(([k, v]) => [k, v.l]), p.valor, null)}</select></div>
    <div class="field"><label>Filtro: Estado</label><select id="pe">${opts([['__pend', 'Pendiente'], ...(S.cat.estado || [])], p.estado, 'Todos')}</select></div>
    <div class="field"><label>Filtro: Campaña</label><select id="pca">${opts(S.cat.campana || [], p.campana, 'Todas')}</select></div>
    <div class="field"><label>Filtro: Ejecutivo</label><select id="ppr">${opts(S.promotores.map((x) => [String(x.id), x.nombre]), p.promotor, 'Todos')}</select></div>
  </div></div><div id="pivOut"></div>`;
  const draw = () => {
    const rows = S.leads.filter((r) => (!p.estado || (p.estado === '__pend' ? !r.estado : r.estado === p.estado)) && (!p.campana || r.campana === p.campana) && (!p.promotor || String(r.promotor_id) === p.promotor));
    $('#pivOut').innerHTML = `<div class="card">${pivotHTML(rows, p.filas, p.cols || null, p.valor)}</div>`;
  };
  [['#pf', 'filas'], ['#pc', 'cols'], ['#pv', 'valor'], ['#pe', 'estado'], ['#pca', 'campana'], ['#ppr', 'promotor']].forEach(([id, k]) => $(id).onchange = (e) => { p[k] = e.target.value; draw(); });
  draw();
}

// ================= Distribución (Jefe) =================
function viewDistribucion() {
  const d = S.f.dist; const esLeads = d.modo === 'leads';
  const src = esLeads ? S.leads : S.bases;
  const q = norm(d.q);
  const rows = src.filter((r) => (d.ver === 'todos' || (d.ver === 'sin' ? !r.promotor_id : String(r.promotor_id) === d.ver))
    && (!d.campana || (esLeads ? r.campana : r.tipo_base) === d.campana)
    && (!q || norm([r.cedula, r.celular, r.telefono, r.nombre, r.correo].join(' ')).includes(q)));
  for (const id of [...d.sel]) if (!src.some((r) => r.id === id)) d.sel.delete(id);
  const activos = S.promotores.filter((p) => p.activo);
  const carga = (pid) => { const g = src.filter((r) => r.promotor_id === pid); return { n: g.length, pend: g.filter((r) => esLeads ? !r.estado : !r.tipificacion).length, f: g.filter((r) => r.estado === 'Formalizado').length }; };
  $('#content').innerHTML = `
  <div class="toolbar" style="align-items:center"><div><div class="section-title">Distribución de bases a promotores</div>
    <div class="muted">Importe la base del mes y repártala entre su equipo.</div></div><div class="spacer" style="flex:1"></div>
    <div class="chips"><span class="chip ${esLeads ? 'on' : ''}" data-modo="leads">Leads del mes</span><span class="chip ${!esLeads ? 'on' : ''}" data-modo="bases">Bases precalificadas</span></div></div>
  <div class="grid" style="grid-template-columns:minmax(300px,380px) 1fr;align-items:start">
    <div class="grid">
      ${esLeads && CFG.DRIVE_LEADS_SHEET ? `<div class="card"><div class="card-h"><h3>Leads del formulario web</h3><div class="spacer"></div><span class="small muted">Google Drive</span></div><div class="card-b">
        <p class="small muted" style="margin-top:0">Trae los leads que llegaron al Drive en ${esc(nombrePeriodo(S.periodo))} y que aún no están en la base.
          Campaña: <b>Google</b> si viene de anuncios de Google, <b>Organico</b> en los demás casos.</p>
        <button class="btn primary" id="dDrive" style="width:100%;justify-content:center">⟳ Traer leads nuevos del Drive</button>
        <div id="dDriveOut"></div></div></div>` : ''}
      <div class="card"><div class="card-h"><h3>1. Importar desde Excel</h3></div><div class="card-b">
        <div class="drop"><p style="margin:0 0 10px">${esLeads ? 'Archivo con columnas: <b>Fecha asignacion, Hora, Cédula, Número Celular, Correo, Campaña</b> (opcional: Asesor y columnas de gestión).'
          : 'Archivo con hoja <b>BASES</b>: BASE_PRECALIFICADOS, CEDULA, NOMBRE, TELEFONO, CORREO, TIPO_CREDITO_PATRONO, Salario…'}</p>
          <input type="file" id="dFile" accept=".xlsx,.xls,.csv"></div>
        ${esLeads ? '<label class="check" style="margin-top:10px"><input type="checkbox" id="dRepl"> Reemplazar toda la base del periodo</label>'
          : `<div class="field" style="margin-top:10px"><label>Asignar todo a</label><select id="dImpProm">${opts(activos.map((p) => [p.id, p.nombre]), '', 'Usar columna Asesor / sin asignar')}</select></div>`}
        <button class="btn primary" id="dImp" style="margin-top:10px;width:100%;justify-content:center">Importar a ${esc(nombrePeriodo(S.periodo))}</button>
      </div></div>
      <div class="card"><div class="card-h"><h3>2. Promotores</h3><div class="spacer"></div><span class="small muted">marque para repartir</span></div>
        <div class="tbl-wrap free"><table class="tbl-compact"><thead><tr><th></th><th>Promotor</th><th class="num">Asignados</th><th class="num">Pend.</th><th class="num">Form.</th></tr></thead>
        <tbody>${activos.map((p) => { const c = carga(p.id); return `<tr><td><input type="checkbox" data-prom="${p.id}" ${d.prom.has(p.id) ? 'checked' : ''}></td>
          <td>${esc(p.nombre)}</td><td class="num">${c.n}</td><td class="num">${c.pend}</td><td class="num">${c.f}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td></td><td>Sin asignar</td><td class="num">${src.filter((r) => !r.promotor_id).length}</td><td colspan="2"></td></tr></tfoot></table></div></div>
    </div>
    <div class="card"><div class="card-h"><h3>3. Seleccione registros</h3><div class="spacer"></div><span class="badge" id="dCount">${d.sel.size} seleccionados</span></div>
      <div class="card-b" style="padding-bottom:0"><div class="toolbar">
        <div class="field"><label>Mostrar</label><select id="dVer">${opts([['sin', 'Sin asignar'], ['todos', 'Todos'], ...S.promotores.map((p) => [String(p.id), 'De ' + p.nombre])], d.ver, null)}</select></div>
        <div class="field"><label>${esLeads ? 'Campaña' : 'Base'}</label><select id="dCamp">${opts(esLeads ? S.cat.campana || [] : S.cat.tipo_base || [], d.campana, 'Todas')}</select></div>
        <div class="field grow"><label>Buscar</label><input type="search" id="dQ" value="${esc(d.q)}"></div>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="dRep" ${d.sel.size && d.prom.size ? '' : 'disabled'}>Repartir equitativamente entre ${d.prom.size} promotor(es)</button>
        <select id="dTo" style="width:auto">${opts(activos.map((p) => [p.id, p.nombre]), '', 'Asignar a…')}</select>
        <button class="btn" id="dAsig" ${d.sel.size ? '' : 'disabled'}>Asignar</button>
        <button class="btn" id="dQuitar" ${d.sel.size ? '' : 'disabled'}>Quitar asignación</button>
      </div></div>
      <div class="tbl-wrap" style="border:0;border-top:1px solid var(--line);border-radius:0"><table class="tbl-compact"><thead><tr>
        <th><input type="checkbox" id="dAll" ${rows.length && rows.every((r) => d.sel.has(r.id)) ? 'checked' : ''} title="Seleccionar todos los visibles"></th>
        ${esLeads ? '<th>Fecha</th><th>Hora</th><th>Cédula</th><th>Celular</th><th>Campaña</th>' : '<th>Base</th><th>Cédula</th><th>Nombre</th><th>Teléfono</th>'}<th>Ejecutivo</th><th>Estado</th></tr></thead>
        <tbody>${rows.slice(0, 1000).map((r) => `<tr class="${d.sel.has(r.id) ? 'sel' : ''}"><td><input type="checkbox" data-sel="${r.id}" ${d.sel.has(r.id) ? 'checked' : ''}></td>
          ${esLeads ? `<td>${esc(fdate(r.fecha_asignacion))}</td><td>${esc(r.hora || '')}</td><td>${esc(r.cedula || '')}</td><td>${esc(r.celular || '')}</td><td>${esc(r.campana || '')}</td>`
            : `<td>${esc(r.tipo_base || '')}</td><td>${esc(r.cedula || '')}</td><td>${esc(r.nombre || '')}</td><td>${esc(r.telefono || '')}</td>`}
          <td>${esc(r.promotor || '—')}</td><td>${esLeads ? badge(r.estado) : esc(r.tipificacion || '')}</td></tr>`).join('')}</tbody></table>
        ${rows.length ? '' : '<div class="empty">No hay registros. Importe un archivo o cambie el filtro "Mostrar".</div>'}</div></div>
  </div>`;
  const re = () => viewDistribucion();
  $('#content').querySelectorAll('[data-modo]').forEach((c) => c.onclick = () => { d.modo = c.dataset.modo; d.sel.clear(); d.campana = ''; re(); });
  $('#dVer').onchange = (e) => { d.ver = e.target.value; re(); };
  $('#dCamp').onchange = (e) => { d.campana = e.target.value; re(); };
  $('#dQ').onchange = (e) => { d.q = e.target.value; re(); };
  $('#content').querySelectorAll('[data-prom]').forEach((c) => c.onchange = () => { const id = c.dataset.prom; c.checked ? d.prom.add(id) : d.prom.delete(id); re(); });
  $('#content').querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => { const id = Number(c.dataset.sel); c.checked ? d.sel.add(id) : d.sel.delete(id); re(); });
  $('#dAll').onchange = (e) => { rows.forEach((r) => (e.target.checked ? d.sel.add(r.id) : d.sel.delete(r.id))); re(); };
  const ep = esLeads ? 'leads' : 'bases';
  const recargar = async () => { d.sel.clear(); await (esLeads ? loadLeads() : loadBases()); re(); };
  // Asigna en bloques (la URL de la consulta no admite miles de ids a la vez)
  const asignar = async (ids, pid) => { for (const c of chunks(ids, 150)) await q(sb.from(ep).update({ promotor_id: pid }).in('id', c)); };
  $('#dRep').onclick = async () => {
    try {
      // Reparto equitativo: cada registro va al promotor con menos carga en el periodo
      const cargaAct = new Map([...d.prom].map((p) => [p, src.filter((r) => r.promotor_id === p && !d.sel.has(r.id)).length]));
      const plan = new Map([...d.prom].map((p) => [p, []]));
      for (const id of d.sel) {
        let min = null; for (const [p, n] of cargaAct) if (min === null || n < cargaAct.get(min)) min = p;
        plan.get(min).push(id); cargaAct.set(min, cargaAct.get(min) + 1);
      }
      for (const [p, ids] of plan) if (ids.length) await asignar(ids, p);
      toast('Repartido: ' + [...plan].filter(([, ids]) => ids.length).map(([p, ids]) => `${nombreDe(p)} ${ids.length}`).join(', '), 'ok'); await recargar();
    } catch (e) { fail(e); }
  };
  $('#dAsig').onclick = async () => {
    const to = $('#dTo').value; if (!to) return toast('Elija el promotor en "Asignar a…"', 'error');
    try { await asignar([...d.sel], to); toast(`${d.sel.size} registros asignados`, 'ok'); await recargar(); } catch (e) { fail(e); }
  };
  $('#dQuitar').onclick = async () => {
    if (!(await confirmar('Quitar asignación', `Los ${d.sel.size} registros quedarán sin ejecutivo. ¿Continuar?`))) return;
    try { await asignar([...d.sel], null); await recargar(); } catch (e) { fail(e); }
  };
  if ($('#dDrive')) $('#dDrive').onclick = () => traerDelDrive(recargar).catch((e) => { fail(e); $('#dDrive').disabled = false; });
  $('#dImp').onclick = async () => {
    const file = $('#dFile').files[0]; if (!file) return toast('Seleccione un archivo Excel', 'error');
    const repl = esLeads && $('#dRepl').checked;
    if (repl && !(await confirmar('Reemplazar base', `Se eliminarán los <b>${S.leads.length}</b> leads de ${esc(nombrePeriodo(S.periodo))} y sus gestiones antes de importar. ¿Continuar?`))) return;
    const btn = $('#dImp'); btn.disabled = true; btn.textContent = 'Importando…';
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const buscar = (nombre) => {
        if (!nombre) return null; const k = norm(nombre).trim();
        const p = S.promotores.find((x) => norm(x.nombre) === k || norm(x.username) === k) || S.promotores.find((x) => !k.includes(' ') && norm(x.nombre).split(' ')[0] === k);
        return p ? p.id : null;
      };
      let filas, hoja; const noEnc = new Set(); let sinProm = 0;
      if (esLeads) {
        const r = Importer.parseLeads(buf, S.cat); hoja = r.sheet;
        if (!r.columnas.includes('cedula') && !r.columnas.includes('celular')) throw new Error(`La hoja "${r.sheet}" no tiene columnas de Cédula o Celular`);
        filas = r.leads.map(({ promotor, ...l }) => { const pid = buscar(promotor); if (!pid) { sinProm++; if (promotor) noEnc.add(promotor); } return { ...l, periodo: S.periodo, promotor_id: pid }; });
      } else {
        const r = Importer.parseBases(buf, S.cat); hoja = r.sheet; const fijo = $('#dImpProm').value || null;
        filas = r.bases.map(({ promotor, ...b }) => ({ ...b, periodo: S.periodo, promotor_id: fijo || buscar(promotor) }));
      }
      if (!filas.length) throw new Error(`La hoja "${hoja}" no tiene registros para importar`);
      if (repl) await q(sb.from('leads').delete().eq('periodo', S.periodo));
      for (const c of chunks(filas, 500)) await q(sb.from(ep).insert(c));
      let msg = `Hoja "${hoja}": ${filas.length} registros importados.`;
      if (sinProm) msg += ` ${sinProm} quedaron sin asignar.`;
      if (noEnc.size) msg += ` Asesores no encontrados: ${[...noEnc].join(', ')} (créelos en Usuarios).`;
      toast(msg, 'ok');
      if (!S.periodos.includes(S.periodo)) S.periodos.unshift(S.periodo);
      await recargar();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = `Importar a ${nombrePeriodo(S.periodo)}`; }
  };
}

// ================= Leads del formulario web (Google Drive) =================
// La hoja debe estar compartida como "Cualquier persona con el enlace puede ver".
// Se consulta con la API de visualización de Google, filtrando por fecha (columna A) en el servidor.
async function traerDelDrive(recargar) {
  const btn = $('#dDrive'); btn.disabled = true; btn.textContent = 'Consultando el Drive…';
  const y = Number(S.periodo.slice(0, 4)), m = Number(S.periodo.slice(5));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const desde = iso(new Date(y, m - 1, 1)), hasta = iso(new Date(y, m, 0));
  const tq = `select * where A >= date '${desde}' and A <= date '${hasta}'`;
  const url = `https://docs.google.com/spreadsheets/d/${CFG.DRIVE_LEADS_SHEET}/gviz/tq?tqx=out:csv&gid=${CFG.DRIVE_LEADS_GID || 0}&tq=${encodeURIComponent(tq)}`;
  const r = await fetch(url);
  const texto = await r.text();
  if (!r.ok || /^\s*</.test(texto)) throw new Error('No se pudo leer la hoja del Drive. Verifique que esté compartida como "Cualquier persona con el enlace".');
  const filas = XLSX.utils.sheet_to_json(XLSX.read(texto, { type: 'string', raw: true }).Sheets.Sheet1, { defval: '', raw: false });
  // Cédulas y teléfonos ya cargados en este periodo y en el anterior
  const prev = iso(new Date(y, m - 2, 1)).slice(0, 7);
  const exist = await fetchAll(() => sb.from('leads').select('cedula,celular').in('periodo', [S.periodo, prev]));
  const clave = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const ya = new Set(exist.flatMap((l) => [clave(l.cedula), 'T' + clave(l.celular)]).filter((k) => k && k !== 'T'));
  const campana = (src) => { const s = norm(src); return /google/.test(s) ? 'Google' : /facebook|instagram|meta|fb|ig/.test(s) ? 'Meta' : 'Organico'; };
  const nuevos = []; let repetidos = 0;
  for (const f of filas) {
    const ced = clave(f.cedula), tel = clave(f.telefono);
    if (!ced && !tel) continue;
    if ((ced && ya.has(ced)) || (tel && ya.has('T' + tel))) { repetidos++; continue; }
    if (ced) ya.add(ced); if (tel) ya.add('T' + tel);
    const hm = String(f.time || '').match(/(\d{1,2}):(\d{2})/);
    nuevos.push({ periodo: S.periodo, fecha_asignacion: /^\d{4}-\d{2}-\d{2}/.test(f.fecha) ? f.fecha.slice(0, 10) : null,
      hora: hm ? `${hm[1].padStart(2, '0')}:${hm[2]}` : null, cedula: String(f.cedula || '').trim().toUpperCase() || null,
      celular: String(f.telefono || '').trim() || null, correo: String(f.correoElectronico || '').trim() || null, campana: campana(f.utm_source) });
  }
  btn.disabled = false; btn.textContent = '⟳ Traer leads nuevos del Drive';
  const out = $('#dDriveOut');
  if (!nuevos.length) { out.innerHTML = `<p class="small" style="margin:10px 0 0">No hay leads nuevos. ${filas.length} en el Drive del ${fdate(desde)} al ${fdate(hasta)}, ${repetidos} ya estaban en la base.</p>`; return; }
  out.innerHTML = `<p class="small" style="margin:10px 0 6px"><b>${nuevos.length} leads nuevos</b> · ${repetidos} ya estaban en la base.</p>
    <div class="tbl-wrap free" style="max-height:220px"><table class="tbl-compact"><thead><tr><th>Fecha</th><th>Hora</th><th>Cédula</th><th>Celular</th><th>Campaña</th></tr></thead>
    <tbody>${nuevos.map((n) => `<tr><td>${esc(fdate(n.fecha_asignacion))}</td><td>${esc(n.hora || '')}</td><td>${esc(n.cedula || '')}</td><td>${esc(n.celular || '')}</td><td>${esc(n.campana)}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn azul" id="dDriveOk" style="margin-top:8px;width:100%;justify-content:center">Agregar ${nuevos.length} a ${esc(nombrePeriodo(S.periodo))} (sin asignar)</button>`;
  $('#dDriveOk').onclick = async () => {
    try {
      $('#dDriveOk').disabled = true;
      for (const c of chunks(nuevos, 500)) await q(sb.from('leads').insert(c));
      toast(`${nuevos.length} leads agregados. Ahora selecciónelos y repártalos.`, 'ok');
      S.f.dist.ver = 'sin'; await recargar();
    } catch (e) { fail(e); $('#dDriveOk').disabled = false; }
  };
}

// ================= Usuarios y catálogos (Jefe) =================
async function viewConfig() {
  const users = await q(sb.from('perfiles').select('*').order('rol').order('nombre'));
  const nombres = { campana: 'Campañas', perfil: 'Perfil lead', tipificacion: 'Tipificaciones', estado: 'Estados', seguro: 'Seguros', tipo_base: 'Tipos de base' };
  $('#content').innerHTML = `
  <div class="grid g2">
    <div class="card"><div class="card-h"><h3>Usuarios</h3><div class="spacer"></div><button class="btn primary sm" id="uNew">+ Nuevo usuario</button></div>
      <div class="tbl-wrap free"><table class="tbl-compact"><thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Estado</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.username)}</td><td>${u.rol === 'jefe' ? 'Jefe' : 'Promotor'}</td>
        <td>${u.activo ? '<span class="badge Formalizado">Activo</span>' : '<span class="badge Rechazado">Inactivo</span>'}${u.must_change ? ' <span class="badge">Clave temporal</span>' : ''}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-ren="${u.id}">Renombrar</button> <button class="btn sm" data-pw="${u.id}">Restablecer clave</button>
        ${u.id !== S.me.id ? `<button class="btn sm" data-act="${u.id}" data-v="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-h"><h3>Catálogos (listas desplegables)</h3></div><div class="card-b">
      <p class="small muted" style="margin-top:0">Un valor por línea. Cambiar un nombre aquí no modifica los registros que ya lo usan.</p>
      <div class="form-grid">${Object.entries(nombres).map(([k, l]) => `<div class="field"><label>${l}</label><textarea data-cat="${k}" rows="6">${esc((S.cat[k] || []).join('\n'))}</textarea>
        <button class="btn sm" data-catsave="${k}" style="align-self:flex-end">Guardar</button></div>`).join('')}</div></div></div>
  </div>`;
  const reload = async () => { await cargarPerfil(); viewConfig(); };
  $('#uNew').onclick = () => modal('Nuevo usuario', `
    <div class="field"><label>Nombre completo</label><input type="text" id="un"></div>
    <div class="field"><label>Usuario (para ingresar)</label><input type="text" id="uu" autocomplete="off"></div>
    <div class="field"><label>Perfil</label><select id="ur"><option value="promotor">Promotor de Telemercadeo</option><option value="jefe">Jefe de Telemercadeo</option></select></div>
    <div class="field"><label>Contraseña temporal (mín. 8)</label><input type="text" id="up" autocomplete="off"></div>
    <p class="small muted" style="margin:0">Se le pedirá cambiarla al primer ingreso.</p>`,
  [{ label: 'Cancelar' }, { label: 'Crear', cls: 'primary', onClick: async (r) => {
    await q(sb.rpc('crear_usuario', { p_username: $('#uu', r).value, p_nombre: $('#un', r).value, p_rol: $('#ur', r).value, p_password: $('#up', r).value }));
    toast('Usuario creado', 'ok'); setTimeout(reload);
  } }]);
  $('#content').querySelectorAll('[data-ren]').forEach((b) => b.onclick = () => { const u = users.find((x) => x.id === b.dataset.ren);
    modal('Renombrar usuario', `<div class="field"><label>Nombre</label><input type="text" id="rn" value="${esc(u.nombre)}"></div>`,
      [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async (r) => { const n = $('#rn', r).value.trim(); if (!n) throw new Error('Indique el nombre'); await q(sb.from('perfiles').update({ nombre: n }).eq('id', u.id)); setTimeout(reload); } }]); });
  $('#content').querySelectorAll('[data-pw]').forEach((b) => b.onclick = () => { const u = users.find((x) => x.id === b.dataset.pw);
    modal('Restablecer contraseña', `<p style="margin:0">Nueva contraseña temporal para <b>${esc(u.nombre)}</b>:</p><div class="field"><input type="text" id="np" autocomplete="off"></div>`,
      [{ label: 'Cancelar' }, { label: 'Restablecer', cls: 'primary', onClick: async (r) => { await q(sb.rpc('restablecer_clave', { p_id: u.id, p_password: $('#np', r).value })); toast('Contraseña restablecida', 'ok'); setTimeout(reload); } }]); });
  $('#content').querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => { try { await q(sb.from('perfiles').update({ activo: !!Number(b.dataset.v) }).eq('id', b.dataset.act)); reload(); } catch (e) { fail(e); } });
  $('#content').querySelectorAll('[data-catsave]').forEach((b) => b.onclick = async () => {
    const k = b.dataset.catsave; const valores = $(`[data-cat="${k}"]`).value.split('\n');
    try { await q(sb.rpc('guardar_catalogo', { p_tipo: k, p_valores: valores })); toast('Catálogo guardado', 'ok'); reload(); } catch (e) { fail(e); }
  });
}

boot();
