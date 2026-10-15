# CRM de Telemercadeo

Aplicación web en línea (GitHub Pages + Supabase) que reemplaza la "Tabla Madre" y los archivos de cada promotor.
Se abre en Google Chrome desde cualquier computadora: **https://camalgut-crypto.github.io/APP-DE-CALL-CENTER/**

| Perfil | Qué ve |
|---|---|
| **Jefe de Telemercadeo** | Base General (pestaña del mes), Cálculo Desfase, Tablas, Campañas, Tabla Dinámica, **Distribución** (importar y repartir bases), Producción, Bases, Usuarios y catálogos |
| **Promotor de Telemercadeo** | Mi Base (solo los leads asignados), **Gestión** (se abre al hacer clic en un lead, con las columnas azules), Producción y Bases |

## Cómo está armado

- `public/` — la página (HTML/CSS/JS). Cada `push` a `main` la publica en GitHub Pages (`.github/workflows/pages.yml`).
- `supabase/schema.sql` — tablas, seguridad por rol (RLS) y funciones. El promotor solo puede ver y editar sus registros y solo las columnas de gestión; eso lo hace cumplir la base de datos, no la página.
- `public/config.js` — URL del proyecto Supabase y su clave pública (anon/publishable). Es pública por diseño.

## Puesta en marcha (una sola vez)

1. Crear un proyecto en [supabase.com](https://supabase.com) y copiar la **Project URL** y la clave **anon public** en `public/config.js`.
2. En Supabase › **SQL Editor**, pegar y ejecutar `supabase/schema.sql`.
3. Generar la carga inicial desde los Excel y ejecutarla también en el SQL Editor:

   ```bash
   npm install
   npm run carga -- "C:/ruta/Tabla Madre Octubre 2026.xlsx" "C:/ruta/Luis Brenes.xlsx" "Luis Brenes" --periodo 2026-10
   ```

   Crea `data/carga_inicial.sql` (para pegar en el SQL Editor) y `data/credenciales_iniciales.txt` con las contraseñas iniciales.
   Ninguno de los dos se sube a Git.
4. Recomendado: en Supabase › Authentication › Sign In / Providers, desactivar **Allow new users to sign up** (los usuarios los crea el Jefe desde la app).

## Flujo mensual

1. El Jefe agrega el mes (**+ Mes**) y define la meta en **Cálculo Desfase**.
2. En **Distribución** importa el Excel de leads (Fecha asignacion, Hora, Cédula, Número Celular, Correo, Campaña) o de bases precalificadas (hoja BASES).
3. Selecciona registros y los asigna a un promotor o los **reparte equitativamente** (al que tenga menos carga).
4. Cada promotor gestiona sus leads: tipificación, estado, monto, fecha formalizado, seguro y comentarios. Todo cambio queda en el historial.
5. Producción, Desfase, Tablas y Campañas se recalculan solas. **⬇ Excel** descarga el mes en el formato de la Tabla Madre.

## Usuarios

Se ingresa con el **usuario** (por ejemplo `jefe` o `luis.brenes`), no con correo. El Jefe crea promotores, restablece
contraseñas y desactiva usuarios en **Usuarios y catálogos**. Cada usuario debe cambiar su contraseña al primer ingreso.

## Probar localmente

```bash
npm run dev
```

y abrir `http://localhost:3000` (usa el mismo Supabase configurado en `public/config.js`).
