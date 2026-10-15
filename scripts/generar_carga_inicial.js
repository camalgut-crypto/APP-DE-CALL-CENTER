// Genera data/carga_inicial.sql a partir de los Excel actuales, para pegarlo en el SQL Editor de Supabase.
// Uso: npm run carga -- "<Tabla Madre.xlsx>" ["<Archivo promotor con hoja BASES>" "<Nombre promotor>"] [--periodo 2026-10]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseLeads, parseBases, norm } = require('../public/importer');

const args = process.argv.slice(2);
const iP = args.indexOf('--periodo');
const periodo = iP >= 0 ? args.splice(iP, 2)[1] : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
const [madre, archivoBases, nombreBases] = args;
if (!madre) { console.error('Indique la ruta de la Tabla Madre (.xlsx)'); process.exit(1); }

// Catálogos iguales a los de supabase/schema.sql (para normalizar mayúsculas/acentos)
const sqlSchema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const catalogos = {};
for (const m of sqlSchema.matchAll(/\('(\w+)', array\[([^\]]+)\]\)/g)) catalogos[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);

const lit = (v) => (v == null || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const slug = (s) => norm(s).replace(/\s+/g, '.');
const clave = () => crypto.randomBytes(6).toString('base64url') + '9a';

const out = [`-- Carga inicial ${periodo} generada ${new Date().toLocaleString()}`, '-- Pegar en Supabase > SQL Editor > Run (después de schema.sql)', 'begin;'];
const credenciales = [];
const usuario = (nombre, rol) => {
  const username = rol === 'jefe' ? 'jefe' : slug(nombre); const pw = clave();
  credenciales.push(`${rol.padEnd(9)} ${username.padEnd(18)} ${pw}   (${nombre})`);
  out.push(`select public.crear_usuario(${lit(username)}, ${lit(nombre)}, ${lit(rol)}, ${lit(pw)});`);
  return username;
};

usuario('Jefe de Telemercadeo', 'jefe');
const { sheet, leads } = parseLeads(fs.readFileSync(madre), catalogos);
const users = {};
for (const n of [...new Set([...leads.map((l) => l.promotor).filter(Boolean), nombreBases].filter(Boolean))]) users[norm(n)] = usuario(n, 'promotor');
const pid = (n) => (n && users[norm(n)] ? `(select id from public.perfiles where username = ${lit(users[norm(n)])})` : 'null');

const cl = ['periodo', 'fecha_asignacion', 'hora', 'cedula', 'celular', 'correo', 'campana', 'cedula_lead', 'perfil_lead', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentarios'];
out.push(`delete from public.leads where periodo = ${lit(periodo)};`);
if (leads.length) out.push(`insert into public.leads (${cl.join(', ')}, promotor_id) values\n` +
  leads.map((l) => `(${[periodo, ...cl.slice(1).map((c) => l[c])].map(lit).join(', ')}, ${pid(l.promotor)})`).join(',\n') + ';');

let nb = 0;
if (archivoBases && nombreBases) {
  const { bases } = parseBases(fs.readFileSync(archivoBases), catalogos); nb = bases.length;
  const cb = ['periodo', 'tipo_base', 'cedula', 'nombre', 'telefono', 'correo', 'tipo_credito_patrono', 'salario', 'hit', 'razon_no_aplica', 'tipificacion', 'estado', 'monto', 'fecha_formalizado', 'seguro', 'comentario'];
  out.push(`delete from public.bases where periodo = ${lit(periodo)} and promotor_id = ${pid(nombreBases)};`);
  if (bases.length) out.push(`insert into public.bases (${cb.join(', ')}, promotor_id) values\n` +
    bases.map((b) => `(${[periodo, ...cb.slice(1).map((c) => b[c])].map(lit).join(', ')}, ${pid(nombreBases)})`).join(',\n') + ';');
}

// Parámetros de "Cálculo Desface" de la Tabla Madre
out.push(`insert into public.metas (periodo, meta_mensual, dias_habiles, tipo_cambio, conversion, campanas) values (${lit(periodo)}, 7279000, 24.5, 36.6243, 0.026,
  '[{"campana":"Google","leads_requeridos":2920,"ticket_esperado":34793},{"campana":"Respond","leads_requeridos":8000,"ticket_esperado":27468}]') on conflict (periodo) do nothing;`);
out.push('commit;');

const dir = path.join(__dirname, '..', 'data'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'carga_inicial.sql'), out.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'credenciales_iniciales.txt'),
  `# Usuarios del CRM (se pedirá cambiar la contraseña al primer ingreso)\n# Generadas ${new Date().toLocaleString()}\n${credenciales.join('\n')}\n`);
console.log(`Hoja "${sheet}": ${leads.length} leads · ${nb} bases · ${credenciales.length} usuarios`);
console.log('Archivos: data/carga_inicial.sql y data/credenciales_iniciales.txt');
