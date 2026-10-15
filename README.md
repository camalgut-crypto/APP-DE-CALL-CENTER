# CRM de Telemercadeo

Aplicación web que reemplaza la "Tabla Madre" de Google Sheets y los archivos de cada promotor.
Tiene dos perfiles:

| Perfil | Qué ve |
|---|---|
| **Jefe de Telemercadeo** | Base General (pestaña del mes), Cálculo Desfase, Tablas, Campañas, Tabla Dinámica, **Distribución** (importar y repartir bases), Producción, Bases, Usuarios y catálogos |
| **Promotor de Telemercadeo** | Mi Base (solo los leads asignados), **Gestión** (se abre al hacer clic en un lead, con las columnas azules), Producción y Bases |

## Requisitos

- Node.js 22.13 o superior (usa el SQLite integrado de Node; no requiere instalar base de datos).

## Instalación

```bash
npm install
```

Carga inicial desde los Excel actuales (crea usuarios, importa la pestaña del mes y la hoja BASES de un promotor):

```bash
npm run seed -- "C:/ruta/Tabla Madre Octubre 2026.xlsx" "C:/ruta/Luis Brenes.xlsx" "Luis Brenes" --periodo 2026-10
```

Las contraseñas iniciales quedan en `data/credenciales_iniciales.txt`. Cada usuario debe cambiarla en su primer ingreso.

## Ejecutar

```bash
npm start
```

Abrir `http://localhost:3000`. Para que el equipo entre desde otras PCs, ejecutarlo en un servidor de la red y usar `http://<ip-del-servidor>:3000` (variable `PORT` para cambiar el puerto, `DATA_DIR` para la carpeta de la base de datos).

## Flujo mensual

1. El Jefe agrega el mes (**+ Mes**) y define la meta en **Cálculo Desfase**.
2. En **Distribución** importa el Excel de leads (Fecha asignacion, Hora, Cédula, Número Celular, Correo, Campaña) o de bases precalificadas (hoja BASES).
3. Selecciona registros y los asigna a un promotor o los **reparte equitativamente** (al que tenga menos carga).
4. Cada promotor gestiona sus leads: tipificación, estado, monto, fecha formalizado, seguro y comentarios. Todo cambio queda en el historial.
5. Producción, Desfase, Tablas y Campañas se recalculan solas. **⬇ Excel** descarga el mes en el formato de la Tabla Madre.

## Datos

- La base de datos está en `data/telemercadeo.db` y **no se sube a Git** (contiene datos personales de clientes). Respáldela copiando esa carpeta.
- Los Excel tampoco se versionan (`.gitignore`).
