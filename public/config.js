// Conexión a Supabase. La clave "anon/publishable" es pública por diseño:
// la seguridad la dan las políticas RLS definidas en supabase/schema.sql.
window.CRM_CONFIG = {
  SUPABASE_URL: 'https://TU_PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU_CLAVE_ANON',
};
