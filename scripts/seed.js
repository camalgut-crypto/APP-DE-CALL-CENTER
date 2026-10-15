// Carga inicial desde los Excel actuales.
// Uso: npm run seed -- "<Tabla Madre.xlsx>" ["<Archivo promotor con hoja BASES>" "<Nombre promotor>"] [--periodo 2026-10]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, tx } = require('../db');
const { parseLeads, parseBases, norm } = require('../importer');

const args = process.argv.slice(2);
const iP = args.indexOf('--periodo');
const periodo = iP >= 0 ? args.splice(iP, 2)[1] : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
const [madre, archivoBases, nombreBases] = args;
if (!madre) { console.error('Indique la ruta de la Tabla Madre (.xlsx)'); process.exit(1); }

const catalogos = {};
for (const r of db.prepare('SELECT tipo, valor FROM catalogos ORDER BY orden').all()) (catalogos[r.tipo] ||= []).push(r.valor);

const credenciales = [];
const nuevaClave = () => crypto.randomBytes(6).toString('base64url') + '9a';
const slug = (s) => norm(s).replace(/\s+/g, '.');

function asegurarUsuario(nombre, rol) {
  const username = rol === 'jefe' ? 'jefe' : slug(nombre);
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (u) return u.id;
  const pw = nuevaClave();
  const r = db.prepare('INSERT INTO users (username, nombre, rol, pass_hash, must_change) VALUES (?,?,?,?,1)').run(username, nombre, rol, hashPassword(pw));
  credenciales.push(`${rol.padEnd(9)} ${username.padEnd(18)} ${pw}   (${nombre})`);
  return r.lastInsertRowid;
}

asegurarUsuario('Jefe de Telemercadeo', 'jefe');

const { sheet, leads } = parseLeads(fs.readFileSync(madre), catalogos);
const ids = {};
for (const n of [...new Set(leads.map((l) => l.promotor).filter(Boolean)), nombreBases].filter(Boolean)) ids[norm(n)] = asegurarUsuario(n, 'promotor');

const campos = ['periodo', 'fecha_asignacion', 'hora', 'cedula', 'celular', 'correo', 'campana', 'promotor_id', 'cedula_lead', 'perfil_lead',
  'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentarios'];
tx(() => {
  db.prepare('DELETE FROM leads WHERE periodo = ?').run(periodo);
  const ins = db.prepare(`INSERT INTO leads (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`);
  for (const l of leads) ins.run(periodo, ...campos.slice(1).map((f) => (f === 'promotor_id' ? (l.promotor ? ids[norm(l.promotor)] : null) : l[f] ?? null)));
});
console.log(`Leads importados de la hoja "${sheet}": ${leads.length} (periodo ${periodo})`);

if (archivoBases && nombreBases) {
  const { bases } = parseBases(fs.readFileSync(archivoBases), catalogos);
  const pid = ids[norm(nombreBases)];
  const cb = ['periodo', 'promotor_id', 'tipo_base', 'cedula', 'nombre', 'telefono', 'correo', 'tipo_credito_patrono', 'salario', 'hit',
    'razon_no_aplica', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentario'];
  tx(() => {
    db.prepare('DELETE FROM bases WHERE periodo = ? AND promotor_id = ?').run(periodo, pid);
    const ins = db.prepare(`INSERT INTO bases (${cb.join(',')}) VALUES (${cb.map(() => '?').join(',')})`);
    for (const b of bases) ins.run(periodo, pid, ...cb.slice(2).map((f) => b[f] ?? null));
  });
  console.log(`Bases importadas para ${nombreBases}: ${bases.length}`);
}

// Parámetros de "Cálculo Desface" de la Tabla Madre de octubre
db.prepare(`INSERT OR IGNORE INTO metas (periodo, meta_mensual, dias_habiles, dias_fecha, tipo_cambio, conversion, campanas) VALUES (?,?,?,?,?,?,?)`)
  .run(periodo, 7279000, 24.5, null, 36.6243, 0.026, JSON.stringify([
    { campana: 'Google', leads_requeridos: 2920, ticket_esperado: 34793 },
    { campana: 'Respond', leads_requeridos: 8000, ticket_esperado: 27468 },
  ]));

if (credenciales.length) {
  const file = path.join(__dirname, '..', 'data', 'credenciales_iniciales.txt');
  fs.appendFileSync(file, `# Generadas ${new Date().toLocaleString()} — se pedirá cambiarlas al primer ingreso\n${credenciales.join('\n')}\n\n`);
  console.log(`Usuarios creados: ${credenciales.length}. Credenciales guardadas en data/credenciales_iniciales.txt`);
}
