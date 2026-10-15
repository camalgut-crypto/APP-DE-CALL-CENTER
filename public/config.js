// Conexión a Supabase. La clave "anon/publishable" es pública por diseño:
// la seguridad la dan las políticas RLS definidas en supabase/schema.sql.
window.CRM_CONFIG = {
  SUPABASE_URL: 'https://osigpjjokeecfihcyzxk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BvyeNi_H2exf_mWMPpl7mA_gwShSQfE',
  // Hoja de Google Drive donde llegan los leads del formulario web (debe estar compartida con el enlace)
  DRIVE_LEADS_SHEET: '10c9dsQsr-N5akfVtDBfXsiVbUcuSLz9o2pk_i_kWs9k',
  DRIVE_LEADS_GID: 0,
};
