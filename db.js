// Base de datos SQLite (módulo integrado de Node >= 22.13)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'telemercadeo.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('jefe','promotor')),
  pass_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
-- Base de leads del mes (pestaña OCTUBRE de la Tabla Madre)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo TEXT NOT NULL,              -- YYYY-MM
  fecha_asignacion TEXT,              -- YYYY-MM-DD
  hora TEXT,                          -- HH:MM
  cedula TEXT,
  celular TEXT,
  correo TEXT,
  campana TEXT,
  promotor_id INTEGER REFERENCES users(id),
  -- Gestión del promotor (columnas azules)
  cedula_lead TEXT,
  perfil_lead TEXT,
  tipificacion TEXT,
  estado TEXT,
  monto REAL,
  fecha_formalizado TEXT,
  seguro TEXT,
  comentarios TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_leads_periodo ON leads(periodo, promotor_id);
-- Bases precalificadas (pestaña BASES del promotor)
CREATE TABLE IF NOT EXISTS bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo TEXT NOT NULL,
  promotor_id INTEGER REFERENCES users(id),
  tipo_base TEXT,                     -- BASE_PRECALIFICADOS: Reasignacion, Renovacion...
  cedula TEXT,
  nombre TEXT,
  telefono TEXT,
  correo TEXT,
  tipo_credito_patrono TEXT,
  salario REAL,
  hit TEXT,
  razon_no_aplica TEXT,
  tipificacion TEXT,
  estado TEXT,
  monto REAL,
  fecha_formalizado TEXT,
  seguro TEXT,
  comentario TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_bases_periodo ON bases(periodo, promotor_id);
CREATE TABLE IF NOT EXISTS catalogos (
  tipo TEXT NOT NULL,
  valor TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, valor)
);
-- Parámetros de la pestaña "Cálculo Desface"
CREATE TABLE IF NOT EXISTS metas (
  periodo TEXT PRIMARY KEY,
  meta_mensual REAL NOT NULL DEFAULT 0,
  dias_habiles REAL,                  -- NULL = calcular (L-V = 1, sábado = 0.5)
  dias_fecha REAL,                    -- NULL = calcular a la fecha de hoy
  tipo_cambio REAL NOT NULL DEFAULT 36.6243,
  conversion REAL NOT NULL DEFAULT 0.026,
  campanas TEXT NOT NULL DEFAULT '[]' -- [{campana, leads_requeridos, ticket_esperado}]
);
CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad TEXT NOT NULL,
  entidad_id INTEGER NOT NULL,
  user_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cambios TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hist ON historial(entidad, entidad_id);
`);

const CATALOGOS_DEFAULT = {
  campana: ['Web', 'Respond', 'Google', 'Organico', 'Meta', 'Messenger', 'Whatsapp', 'Referido', 'Llamada',
    'Base Datos', 'Cliente P', 'BD Renovación Activos', 'BD Renovación Inactiva', 'BD Renovación Manual'],
  perfil: ['Asalariado', 'No Asalariado', 'PYME', 'Pensionado', 'Remesante', 'Otro'],
  tipificacion: ['Aprobado', 'Saneado', 'P Restringido', 'Cobertura', 'Estabilidad L', 'No Aplica Score', 'No Hit',
    'Zona franca', 'Seguimento', 'No contesta', 'Edad', 'Capacidad pago', 'Reporte de pago', 'Reno sin disponible',
    'No cotiza', 'Poco inventario', 'Consulta', 'Desistió', 'No Acepta Monto', 'Repetido', 'Negocio pequeño',
    'Convenio', 'Tasa de interés alta', 'Cliente en Mora', 'Número incorrecto', 'Salario Menor', 'No le interesa',
    'Cliente potencial', 'Desea monto mayor', 'Préstamo con otra institución', 'Pensionado por invalidez', 'No productivo'],
  estado: ['Formalizado', 'Rechazado', 'En Analisis'],
  seguro: ['We Care', 'Asys', 'N/A'],
  tipo_base: ['Reasignacion', 'Renovacion'],
};

function seedCatalogos() {
  const ins = db.prepare('INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES (?,?,?)');
  for (const [tipo, vals] of Object.entries(CATALOGOS_DEFAULT)) vals.forEach((v, i) => ins.run(tipo, v, i));
}
seedCatalogos();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, hashPassword, verifyPassword, tx, CATALOGOS_DEFAULT };
