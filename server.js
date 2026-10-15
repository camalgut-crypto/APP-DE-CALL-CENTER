// Servidor HTTP del CRM de Telemercadeo (sin frameworks)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword, tx } = require('./db');
const { parseLeads, parseBases, norm, XLSX } = require('./importer');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const SESSION_HOURS = 12;

// Campos que el promotor puede editar (columnas azules)
const LEAD_GESTION = ['cedula_lead', 'perfil_lead', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentarios'];
const LEAD_ASIGNACION = ['periodo', 'fecha_asignacion', 'hora', 'cedula', 'celular', 'correo', 'campana', 'promotor_id'];
const BASE_GESTION = ['tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentario'];
const BASE_DATOS = ['periodo', 'promotor_id', 'tipo_base', 'cedula', 'nombre', 'telefono', 'correo', 'tipo_credito_patrono', 'salario', 'hit', 'razon_no_aplica'];

// ---------- utilidades ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};
const periodoActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const validPeriodo = (p) => /^\d{4}-\d{2}$/.test(p || '') ? p : periodoActual();

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Archivo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function currentUser(req) {
  const token = cookies(req).sid;
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.nombre, u.rol, u.activo, u.must_change, s.expires
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row || row.expires < Date.now() || !row.activo) return null;
  return { id: row.id, username: row.username, nombre: row.nombre, rol: row.rol, must_change: !!row.must_change, token };
}
const requireJefe = (u) => { if (u.rol !== 'jefe') throw new HttpError(403, 'Solo el Jefe de Telemercadeo puede hacer esto'); };

function catalogos() {
  const out = {};
  for (const r of db.prepare('SELECT tipo, valor FROM catalogos ORDER BY tipo, orden, valor').all()) (out[r.tipo] ||= []).push(r.valor);
  return out;
}
function clean(field, v) {
  if (v === undefined) return undefined;
  if (v === '' || v === null) return null;
  if (['monto', 'salario'].includes(field)) { const n = Number(v); if (isNaN(n)) throw new HttpError(400, `Valor inválido en ${field}`); return n; }
  if (field === 'promotor_id') return v == null ? null : Number(v);
  if (['fecha_asignacion', 'fecha_formalizado'].includes(field) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `Fecha inválida en ${field}`);
  if (field === 'periodo' && !/^\d{4}-\d{2}$/.test(v)) throw new HttpError(400, 'Periodo inválido');
  return String(v).trim();
}
function updateRow(tabla, id, cambiosIn, permitidos, user) {
  const actual = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);
  if (!actual) throw new HttpError(404, 'Registro no encontrado');
  if (user.rol === 'promotor' && actual.promotor_id !== user.id) throw new HttpError(403, 'Este registro no está asignado a usted');
  const cambios = {};
  for (const f of permitidos) {
    const v = clean(f, cambiosIn[f]);
    if (v !== undefined && v !== actual[f]) cambios[f] = v;
  }
  // Regla de negocio: si el estado es Formalizado se requiere monto
  const estado = cambios.estado !== undefined ? cambios.estado : actual.estado;
  const monto = cambios.monto !== undefined ? cambios.monto : actual.monto;
  if (estado === 'Formalizado' && !(monto > 0)) throw new HttpError(400, 'Para marcar "Formalizado" debe indicar el monto colocado');
  if (!Object.keys(cambios).length) return actual;
  const sets = Object.keys(cambios).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ${tabla} SET ${sets}, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?`)
    .run(...Object.values(cambios), user.id, id);
  const antes = Object.fromEntries(Object.keys(cambios).map((k) => [k, actual[k]]));
  db.prepare('INSERT INTO historial (entidad, entidad_id, user_id, cambios) VALUES (?,?,?,?)')
    .run(tabla, id, user.id, JSON.stringify({ antes, despues: cambios }));
  return db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);
}

function promotorPorNombre() {
  const lista = db.prepare("SELECT id, nombre, username FROM users WHERE rol = 'promotor'").all();
  return (nombre) => {
    if (!nombre) return null;
    const k = norm(nombre);
    const u = lista.find((p) => norm(p.nombre) === k || norm(p.username) === k)
      || lista.find((p) => norm(p.nombre).split(' ')[0] === k.split(' ')[0] && k.split(' ').length === 1);
    return u ? u.id : null;
  };
}

// Reparto equitativo: asigna a quien tenga menos registros en el periodo
function distribuir(tabla, ids, promotorIds, periodo, user) {
  if (!ids.length || !promotorIds.length) throw new HttpError(400, 'Seleccione registros y promotores');
  const carga = new Map(promotorIds.map((p) => [Number(p), 0]));
  for (const r of db.prepare(`SELECT promotor_id, COUNT(*) n FROM ${tabla} WHERE periodo = ? AND promotor_id IS NOT NULL GROUP BY promotor_id`).all(periodo))
    if (carga.has(r.promotor_id)) carga.set(r.promotor_id, r.n);
  const upd = db.prepare(`UPDATE ${tabla} SET promotor_id = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?`);
  const resumen = {};
  tx(() => {
    for (const id of ids) {
      let min = null;
      for (const [p, n] of carga) if (min === null || n < carga.get(min)) min = p;
      upd.run(min, user.id, Number(id));
      carga.set(min, carga.get(min) + 1);
      resumen[min] = (resumen[min] || 0) + 1;
    }
  });
  return resumen;
}

// ---------- rutas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
};

route('POST', '/api/login', async (req, res, { body }) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(body.username || '').trim());
  if (!u || !u.activo || !verifyPassword(String(body.password || ''), u.pass_hash)) throw new HttpError(401, 'Usuario o contraseña incorrectos');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_HOURS * 3600e3);
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}` });
}, { auth: false });

route('POST', '/api/logout', (req, res, { user }) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
});

route('GET', '/api/me', (req, res, { user }) => {
  const promotores = db.prepare("SELECT id, nombre, username, activo FROM users WHERE rol = 'promotor' ORDER BY nombre").all();
  const periodos = db.prepare('SELECT periodo FROM leads UNION SELECT periodo FROM bases UNION SELECT periodo FROM metas ORDER BY 1 DESC').all().map((r) => r.periodo);
  if (!periodos.includes(periodoActual())) periodos.unshift(periodoActual());
  send(res, 200, { user: { id: user.id, nombre: user.nombre, rol: user.rol, username: user.username, must_change: user.must_change }, catalogos: catalogos(), promotores, periodos });
});

route('POST', '/api/password', (req, res, { user, body }) => {
  const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(body.actual || ''), u.pass_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
  if (String(body.nueva || '').length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(body.nueva), user.id);
  send(res, 200, { ok: true });
});

// ----- Leads (pestaña del mes) -----
route('GET', '/api/leads', (req, res, { user, query }) => {
  const periodo = validPeriodo(query.get('periodo'));
  const where = ['l.periodo = ?']; const args = [periodo];
  if (user.rol === 'promotor') { where.push('l.promotor_id = ?'); args.push(user.id); }
  else if (query.get('promotor') === 'sin') where.push('l.promotor_id IS NULL');
  else if (query.get('promotor')) { where.push('l.promotor_id = ?'); args.push(Number(query.get('promotor'))); }
  const rows = db.prepare(`SELECT l.*, u.nombre AS promotor FROM leads l LEFT JOIN users u ON u.id = l.promotor_id
    WHERE ${where.join(' AND ')} ORDER BY l.fecha_asignacion DESC, l.hora DESC, l.id DESC`).all(...args);
  send(res, 200, rows);
});
route('POST', '/api/leads', (req, res, { user, body }) => {
  requireJefe(user);
  const campos = [...LEAD_ASIGNACION, ...LEAD_GESTION];
  const vals = campos.map((f) => clean(f, body[f]) ?? null);
  if (!vals[0]) vals[0] = periodoActual();
  const r = db.prepare(`INSERT INTO leads (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`).run(...vals);
  send(res, 201, db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid));
});
route('PUT', '/api/leads/:id', (req, res, { user, body, params }) => {
  const permitidos = user.rol === 'jefe' ? [...LEAD_ASIGNACION, ...LEAD_GESTION] : LEAD_GESTION;
  send(res, 200, updateRow('leads', Number(params.id), body, permitidos, user));
});
route('DELETE', '/api/leads/:id', (req, res, { user, params }) => {
  requireJefe(user);
  db.prepare('DELETE FROM leads WHERE id = ?').run(Number(params.id));
  send(res, 200, { ok: true });
});
route('POST', '/api/leads/asignar', (req, res, { user, body }) => {
  requireJefe(user);
  const ids = (body.ids || []).map(Number);
  const upd = db.prepare("UPDATE leads SET promotor_id = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?");
  tx(() => ids.forEach((id) => upd.run(body.promotor_id ? Number(body.promotor_id) : null, user.id, id)));
  send(res, 200, { ok: true, n: ids.length });
});
route('POST', '/api/leads/distribuir', (req, res, { user, body }) => {
  requireJefe(user);
  send(res, 200, { ok: true, resumen: distribuir('leads', body.ids || [], body.promotor_ids || [], validPeriodo(body.periodo), user) });
});
route('GET', '/api/historial/:entidad/:id', (req, res, { user, params }) => {
  if (!['leads', 'bases'].includes(params.entidad)) throw new HttpError(404, 'No encontrado');
  const reg = db.prepare(`SELECT promotor_id FROM ${params.entidad} WHERE id = ?`).get(Number(params.id));
  if (!reg) throw new HttpError(404, 'No encontrado');
  if (user.rol === 'promotor' && reg.promotor_id !== user.id) throw new HttpError(403, 'Sin acceso');
  send(res, 200, db.prepare(`SELECT h.at, h.cambios, u.nombre FROM historial h LEFT JOIN users u ON u.id = h.user_id
    WHERE entidad = ? AND entidad_id = ? ORDER BY h.id DESC`).all(params.entidad, Number(params.id)));
});

// ----- Bases precalificadas -----
route('GET', '/api/bases', (req, res, { user, query }) => {
  const periodo = validPeriodo(query.get('periodo'));
  const where = ['b.periodo = ?']; const args = [periodo];
  if (user.rol === 'promotor') { where.push('b.promotor_id = ?'); args.push(user.id); }
  else if (query.get('promotor') === 'sin') where.push('b.promotor_id IS NULL');
  else if (query.get('promotor')) { where.push('b.promotor_id = ?'); args.push(Number(query.get('promotor'))); }
  send(res, 200, db.prepare(`SELECT b.*, u.nombre AS promotor FROM bases b LEFT JOIN users u ON u.id = b.promotor_id
    WHERE ${where.join(' AND ')} ORDER BY b.tipo_base, b.id`).all(...args));
});
route('PUT', '/api/bases/:id', (req, res, { user, body, params }) => {
  const permitidos = user.rol === 'jefe' ? [...BASE_DATOS, ...BASE_GESTION] : BASE_GESTION;
  send(res, 200, updateRow('bases', Number(params.id), body, permitidos, user));
});
route('DELETE', '/api/bases/:id', (req, res, { user, params }) => {
  requireJefe(user);
  db.prepare('DELETE FROM bases WHERE id = ?').run(Number(params.id));
  send(res, 200, { ok: true });
});
route('POST', '/api/bases/asignar', (req, res, { user, body }) => {
  requireJefe(user);
  const ids = (body.ids || []).map(Number);
  const upd = db.prepare("UPDATE bases SET promotor_id = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?");
  tx(() => ids.forEach((id) => upd.run(body.promotor_id ? Number(body.promotor_id) : null, user.id, id)));
  send(res, 200, { ok: true, n: ids.length });
});
route('POST', '/api/bases/distribuir', (req, res, { user, body }) => {
  requireJefe(user);
  send(res, 200, { ok: true, resumen: distribuir('bases', body.ids || [], body.promotor_ids || [], validPeriodo(body.periodo), user) });
});

// ----- Producción: todo lo formalizado (leads + bases) -----
route('GET', '/api/produccion', (req, res, { user, query }) => {
  const periodo = validPeriodo(query.get('periodo'));
  let filtro = ''; const args = [periodo, periodo];
  const pid = user.rol === 'promotor' ? user.id : (query.get('promotor') ? Number(query.get('promotor')) : null);
  if (pid) { filtro = 'AND promotor_id = ?'; args.splice(1, 0, pid); args.push(pid); }
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT 'lead' AS origen, id, promotor_id, fecha_asignacion, COALESCE(cedula_lead, cedula) AS cedula, campana, perfil_lead AS perfil,
             tipificacion, estado, monto, fecha_formalizado, seguro, comentarios AS comentario
        FROM leads WHERE periodo = ? AND estado = 'Formalizado' ${filtro}
      UNION ALL
      SELECT 'base', id, promotor_id, NULL, cedula, 'Base ' || COALESCE(tipo_base,''), tipo_credito_patrono,
             tipificacion, estado, monto, fecha_formalizado, seguro, comentario
        FROM bases WHERE periodo = ? AND estado = 'Formalizado' ${filtro}
    ) p LEFT JOIN (SELECT id AS uid, nombre AS promotor FROM users) u ON u.uid = p.promotor_id
    ORDER BY fecha_formalizado DESC`).all(...args);
  send(res, 200, rows);
});

// ----- Metas / Cálculo de desfase -----
route('GET', '/api/metas/:periodo', (req, res, { params }) => {
  const p = validPeriodo(params.periodo);
  const m = db.prepare('SELECT * FROM metas WHERE periodo = ?').get(p)
    || { periodo: p, meta_mensual: 0, dias_habiles: null, dias_fecha: null, tipo_cambio: 36.6243, conversion: 0.026, campanas: '[]' };
  send(res, 200, { ...m, campanas: JSON.parse(m.campanas || '[]') });
});
route('PUT', '/api/metas/:periodo', (req, res, { user, body, params }) => {
  requireJefe(user);
  const p = validPeriodo(params.periodo);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  db.prepare(`INSERT INTO metas (periodo, meta_mensual, dias_habiles, dias_fecha, tipo_cambio, conversion, campanas) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(periodo) DO UPDATE SET meta_mensual=excluded.meta_mensual, dias_habiles=excluded.dias_habiles, dias_fecha=excluded.dias_fecha,
    tipo_cambio=excluded.tipo_cambio, conversion=excluded.conversion, campanas=excluded.campanas`)
    .run(p, num(body.meta_mensual) || 0, num(body.dias_habiles), num(body.dias_fecha), num(body.tipo_cambio) || 36.6243,
      num(body.conversion) ?? 0.026, JSON.stringify(body.campanas || []));
  send(res, 200, { ok: true });
});

// ----- Importación desde Excel -----
route('POST', '/api/import/leads', (req, res, { user, body }) => {
  requireJefe(user);
  const periodo = validPeriodo(body.periodo);
  const { sheet, columnas, leads } = parseLeads(Buffer.from(body.data || '', 'base64'), catalogos(), body.hoja);
  if (!columnas.includes('cedula') && !columnas.includes('celular')) throw new HttpError(400, `La hoja "${sheet}" no tiene columnas de Cédula o Celular`);
  const buscar = promotorPorNombre();
  const campos = ['periodo', ...LEAD_ASIGNACION.slice(1), ...LEAD_GESTION];
  const ins = db.prepare(`INSERT INTO leads (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`);
  let sinPromotor = 0; const noEncontrados = new Set();
  tx(() => {
    if (body.reemplazar) db.prepare('DELETE FROM leads WHERE periodo = ?').run(periodo);
    for (const l of leads) {
      const pid = buscar(l.promotor);
      if (!pid) { sinPromotor++; if (l.promotor) noEncontrados.add(l.promotor); }
      ins.run(periodo, ...campos.slice(1).map((f) => (f === 'promotor_id' ? pid : l[f] ?? null)));
    }
  });
  send(res, 200, { ok: true, hoja: sheet, importados: leads.length, sin_promotor: sinPromotor, promotores_no_encontrados: [...noEncontrados] });
});
route('POST', '/api/import/bases', (req, res, { user, body }) => {
  requireJefe(user);
  const periodo = validPeriodo(body.periodo);
  const { sheet, bases } = parseBases(Buffer.from(body.data || '', 'base64'), catalogos());
  const buscar = promotorPorNombre();
  const campos = ['periodo', 'promotor_id', 'tipo_base', 'cedula', 'nombre', 'telefono', 'correo', 'tipo_credito_patrono', 'salario', 'hit',
    'razon_no_aplica', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentario'];
  const ins = db.prepare(`INSERT INTO bases (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`);
  tx(() => {
    for (const b of bases) {
      const pid = body.promotor_id ? Number(body.promotor_id) : buscar(b.promotor);
      ins.run(periodo, pid, ...campos.slice(2).map((f) => b[f] ?? null));
    }
  });
  send(res, 200, { ok: true, hoja: sheet, importados: bases.length });
});

// ----- Exportación a Excel -----
route('GET', '/api/export', (req, res, { user, query }) => {
  const periodo = validPeriodo(query.get('periodo'));
  const filtro = user.rol === 'promotor' ? 'AND l.promotor_id = ' + Number(user.id) : '';
  const leads = db.prepare(`SELECT l.fecha_asignacion AS "Fecha asignacion", l.hora AS "Hora", l.cedula AS "Cédula", l.celular AS "Número Celular",
    l.correo AS "Correo", l.campana AS "Campaña", u.nombre AS "Asesor", l.cedula_lead AS "Cedula Lead", l.perfil_lead AS "Perfil Lead",
    l.tipificacion AS "Tipificacion", l.estado AS "Estado", l.monto AS "Monto Colocado", l.fecha_formalizado AS "Fecha formalizado",
    l.seguro AS "Seguro", l.comentarios AS "Comentarios"
    FROM leads l LEFT JOIN users u ON u.id = l.promotor_id WHERE l.periodo = ? ${filtro} ORDER BY l.fecha_asignacion, l.hora`).all(periodo);
  const bases = db.prepare(`SELECT b.tipo_base AS "BASE_PRECALIFICADOS", b.cedula AS "CEDULA", b.nombre AS "NOMBRE", b.telefono AS "TELEFONO",
    b.correo AS "CORREO", b.tipo_credito_patrono AS "TIPO_CREDITO_PATRONO", b.salario AS "Salario", b.hit AS "HIT_PFORMALIZACION",
    b.razon_no_aplica AS "Razon_no_aplica", b.tipificacion AS "Tipificación", b.estado AS "Estado", b.monto AS "Monto",
    b.comentario AS "COMENTARIO", u.nombre AS "Asesor"
    FROM bases b LEFT JOIN users u ON u.id = b.promotor_id WHERE b.periodo = ? ${filtro.replace('l.', 'b.')} ORDER BY b.id`).all(periodo);
  const wb = XLSX.utils.book_new();
  const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const hoja = meses[Number(periodo.slice(5)) - 1];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leads), hoja);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bases), 'BASES');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="Telemercadeo_${hoja}_${periodo.slice(0, 4)}.xlsx"`,
  });
  res.end(buf);
});

// ----- Usuarios y catálogos (Jefe) -----
route('GET', '/api/usuarios', (req, res, { user }) => {
  requireJefe(user);
  send(res, 200, db.prepare('SELECT id, username, nombre, rol, activo, must_change, created_at FROM users ORDER BY rol, nombre').all());
});
route('POST', '/api/usuarios', (req, res, { user, body }) => {
  requireJefe(user);
  const username = String(body.username || '').trim(); const nombre = String(body.nombre || '').trim();
  if (!username || !nombre) throw new HttpError(400, 'Usuario y nombre son obligatorios');
  if (String(body.password || '').length < 8) throw new HttpError(400, 'La contraseña inicial debe tener al menos 8 caracteres');
  const rol = body.rol === 'jefe' ? 'jefe' : 'promotor';
  try {
    db.prepare('INSERT INTO users (username, nombre, rol, pass_hash, must_change) VALUES (?,?,?,?,1)').run(username, nombre, rol, hashPassword(body.password));
  } catch { throw new HttpError(400, 'Ese nombre de usuario ya existe'); }
  send(res, 201, { ok: true });
});
route('PUT', '/api/usuarios/:id', (req, res, { user, body, params }) => {
  requireJefe(user);
  const id = Number(params.id);
  if (body.nombre) db.prepare('UPDATE users SET nombre = ? WHERE id = ?').run(String(body.nombre).trim(), id);
  if (body.activo !== undefined) {
    if (id === user.id && !body.activo) throw new HttpError(400, 'No puede desactivar su propio usuario');
    db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(body.activo ? 1 : 0, id);
    if (!body.activo) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(body.password), id);
  }
  send(res, 200, { ok: true });
});
route('PUT', '/api/catalogos/:tipo', (req, res, { user, body, params }) => {
  requireJefe(user);
  const valores = [...new Set((body.valores || []).map((v) => String(v).trim()).filter(Boolean))];
  tx(() => {
    db.prepare('DELETE FROM catalogos WHERE tipo = ?').run(params.tipo);
    const ins = db.prepare('INSERT INTO catalogos (tipo, valor, orden) VALUES (?,?,?)');
    valores.forEach((v, i) => ins.run(params.tipo, v, i));
  });
  send(res, 200, { ok: true });
});

// ---------- servidor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Ruta no encontrada');
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = currentUser(req);
      if (r.auth && !user) throw new HttpError(401, 'Sesión expirada, ingrese de nuevo');
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      return await r.handler(req, res, { user, body, params, query: url.searchParams });
    }
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Error interno del servidor' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`CRM Telemercadeo escuchando en http://localhost:${PORT}`));
}
module.exports = { server };
