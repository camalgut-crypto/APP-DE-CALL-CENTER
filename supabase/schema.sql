-- =====================================================================
-- CRM de Telemercadeo — esquema para Supabase
-- Pegar completo en: Supabase > SQL Editor > New query > Run
-- Se puede ejecutar más de una vez sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  nombre text not null,
  rol text not null check (rol in ('jefe','promotor')),
  activo boolean not null default true,
  must_change boolean not null default true,
  created_at timestamptz not null default now()
);

-- Base de leads del mes (pestaña OCTUBRE de la Tabla Madre)
create table if not exists public.leads (
  id bigint generated always as identity primary key,
  periodo text not null check (periodo ~ '^\d{4}-\d{2}$'),
  fecha_asignacion date,
  hora text,
  cedula text,
  celular text,
  correo text,
  campana text,
  promotor_id uuid references public.perfiles(id) on delete set null,
  -- Gestión del promotor (columnas azules)
  cedula_lead text,
  perfil_lead text,
  tipificacion text,
  estado text,
  monto numeric,
  fecha_formalizado date,
  seguro text,
  comentarios text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid
);
create index if not exists ix_leads_periodo on public.leads (periodo, promotor_id);

-- Bases precalificadas (pestaña BASES del promotor)
create table if not exists public.bases (
  id bigint generated always as identity primary key,
  periodo text not null check (periodo ~ '^\d{4}-\d{2}$'),
  promotor_id uuid references public.perfiles(id) on delete set null,
  tipo_base text,
  cedula text,
  nombre text,
  telefono text,
  correo text,
  tipo_credito_patrono text,
  salario numeric,
  hit text,
  razon_no_aplica text,
  tipificacion text,
  estado text,
  monto numeric,
  fecha_formalizado date,
  seguro text,
  comentario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid
);
create index if not exists ix_bases_periodo on public.bases (periodo, promotor_id);

create table if not exists public.catalogos (
  tipo text not null,
  valor text not null,
  orden int not null default 0,
  primary key (tipo, valor)
);

-- Parámetros de "Cálculo Desface"
create table if not exists public.metas (
  periodo text primary key,
  meta_mensual numeric not null default 0,
  dias_habiles numeric,          -- null = calcular (L-V = 1, sábado = 0.5)
  dias_fecha numeric,            -- null = calcular a la fecha
  tipo_cambio numeric not null default 36.6243,
  conversion numeric not null default 0.026,
  campanas jsonb not null default '[]'
);

create table if not exists public.historial (
  id bigint generated always as identity primary key,
  entidad text not null,
  entidad_id bigint not null,
  user_id uuid,
  at timestamptz not null default now(),
  cambios jsonb not null
);
create index if not exists ix_historial on public.historial (entidad, entidad_id);

-- ---------- Funciones de apoyo ----------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;
create or replace function public.es_jefe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = 'jefe', false)
$$;
-- Llamada desde el SQL Editor (administrador) y no desde la app
create or replace function public.es_admin_sql() returns boolean
language sql stable as $$ select session_user <> 'authenticator' $$;

-- Al modificar un lead/base: el promotor solo puede tocar sus columnas de gestión,
-- Formalizado exige monto, y todo cambio queda en el historial.
create or replace function public.trg_gestion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gestion text[] := tg_argv::text[] || array['updated_at','updated_by'];
  n jsonb; o jsonb; antes jsonb := '{}'; despues jsonb := '{}'; k text;
begin
  n := to_jsonb(new); o := to_jsonb(old);
  if not public.es_jefe() and not public.es_admin_sql() and (n - gestion) is distinct from (o - gestion) then
    raise exception 'Solo el Jefe de Telemercadeo puede modificar los datos de asignación';
  end if;
  if (new.estado is distinct from old.estado or new.monto is distinct from old.monto)
     and new.estado = 'Formalizado' and coalesce(new.monto, 0) <= 0 then
    raise exception 'Para marcar "Formalizado" debe indicar el monto colocado';
  end if;
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at','updated_by') and n->k is distinct from o->k then
      antes := antes || jsonb_build_object(k, o->k);
      despues := despues || jsonb_build_object(k, n->k);
    end if;
  end loop;
  if despues <> '{}'::jsonb then
    new.updated_at := now();
    new.updated_by := auth.uid();
    insert into public.historial (entidad, entidad_id, user_id, cambios)
    values (tg_table_name, new.id, auth.uid(), jsonb_build_object('antes', antes, 'despues', despues));
  end if;
  return new;
end $$;

drop trigger if exists leads_gestion on public.leads;
create trigger leads_gestion before update on public.leads for each row
  execute function public.trg_gestion('cedula_lead','perfil_lead','tipificacion','estado','monto','fecha_formalizado','seguro','comentarios');
drop trigger if exists bases_gestion on public.bases;
create trigger bases_gestion before update on public.bases for each row
  execute function public.trg_gestion('tipificacion','estado','monto','fecha_formalizado','seguro','comentario');

-- ---------- Usuarios (sin necesidad de correo real) ----------
-- El usuario "luis.brenes" ingresa con su usuario; internamente es luis.brenes@telemercadeo.example
create or replace function public.crear_usuario(p_username text, p_nombre text, p_rol text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; correo text := lower(trim(p_username)) || '@telemercadeo.example';
begin
  if not (public.es_jefe() or public.es_admin_sql()) then raise exception 'Solo el Jefe de Telemercadeo puede crear usuarios'; end if;
  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_nombre), '') = '' then raise exception 'Usuario y nombre son obligatorios'; end if;
  if trim(p_username) !~ '^[A-Za-z0-9._-]+$' then raise exception 'El usuario solo puede tener letras, números, punto, guion o guion bajo'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if p_rol not in ('jefe','promotor') then raise exception 'Perfil inválido'; end if;
  select id into uid from public.perfiles where username = lower(trim(p_username));
  if uid is not null then
    if public.es_admin_sql() then return uid; end if;
    raise exception 'Ese nombre de usuario ya existe';
  end if;
  uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());
  insert into public.perfiles (id, username, nombre, rol) values (uid, lower(trim(p_username)), trim(p_nombre), p_rol);
  return uid;
end $$;

create or replace function public.restablecer_clave(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.es_jefe() or public.es_admin_sql()) then raise exception 'Solo el Jefe de Telemercadeo puede restablecer contraseñas'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_id;
  update public.perfiles set must_change = true where id = p_id;
end $$;

create or replace function public.marcar_clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update public.perfiles set must_change = false where id = auth.uid()
$$;

create or replace function public.guardar_catalogo(p_tipo text, p_valores text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_jefe() then raise exception 'Solo el Jefe de Telemercadeo puede editar catálogos'; end if;
  delete from public.catalogos where tipo = p_tipo;
  insert into public.catalogos (tipo, valor, orden)
  select p_tipo, trim(v), min(i) from unnest(p_valores) with ordinality t(v, i) where trim(v) <> '' group by trim(v);
end $$;

create or replace function public.periodos() returns setof text
language sql stable as $$
  select periodo from public.leads union select periodo from public.bases union select periodo from public.metas order by 1 desc
$$;

revoke execute on function public.crear_usuario(text,text,text,text), public.restablecer_clave(uuid,text),
  public.guardar_catalogo(text,text[]), public.marcar_clave_cambiada() from public, anon;
grant execute on function public.crear_usuario(text,text,text,text), public.restablecer_clave(uuid,text),
  public.guardar_catalogo(text,text[]), public.marcar_clave_cambiada(), public.periodos(), public.es_jefe(), public.mi_rol() to authenticated;

-- ---------- Seguridad por fila (RLS) ----------
alter table public.perfiles enable row level security;
alter table public.leads enable row level security;
alter table public.bases enable row level security;
alter table public.catalogos enable row level security;
alter table public.metas enable row level security;
alter table public.historial enable row level security;

drop policy if exists perfiles_sel on public.perfiles;
create policy perfiles_sel on public.perfiles for select to authenticated using (id = auth.uid() or public.es_jefe());
drop policy if exists perfiles_upd on public.perfiles;
create policy perfiles_upd on public.perfiles for update to authenticated using (public.es_jefe()) with check (public.es_jefe());

drop policy if exists leads_sel on public.leads;
create policy leads_sel on public.leads for select to authenticated
  using (public.es_jefe() or (promotor_id = auth.uid() and public.mi_rol() = 'promotor'));
drop policy if exists leads_ins on public.leads;
create policy leads_ins on public.leads for insert to authenticated with check (public.es_jefe());
drop policy if exists leads_upd on public.leads;
create policy leads_upd on public.leads for update to authenticated
  using (public.es_jefe() or (promotor_id = auth.uid() and public.mi_rol() = 'promotor'))
  with check (public.es_jefe() or promotor_id = auth.uid());
drop policy if exists leads_del on public.leads;
create policy leads_del on public.leads for delete to authenticated using (public.es_jefe());

drop policy if exists bases_sel on public.bases;
create policy bases_sel on public.bases for select to authenticated
  using (public.es_jefe() or (promotor_id = auth.uid() and public.mi_rol() = 'promotor'));
drop policy if exists bases_ins on public.bases;
create policy bases_ins on public.bases for insert to authenticated with check (public.es_jefe());
drop policy if exists bases_upd on public.bases;
create policy bases_upd on public.bases for update to authenticated
  using (public.es_jefe() or (promotor_id = auth.uid() and public.mi_rol() = 'promotor'))
  with check (public.es_jefe() or promotor_id = auth.uid());
drop policy if exists bases_del on public.bases;
create policy bases_del on public.bases for delete to authenticated using (public.es_jefe());

drop policy if exists catalogos_sel on public.catalogos;
create policy catalogos_sel on public.catalogos for select to authenticated using (true);

drop policy if exists metas_sel on public.metas;
create policy metas_sel on public.metas for select to authenticated using (public.mi_rol() is not null);
drop policy if exists metas_all on public.metas;
create policy metas_all on public.metas for all to authenticated using (public.es_jefe()) with check (public.es_jefe());

drop policy if exists historial_sel on public.historial;
create policy historial_sel on public.historial for select to authenticated using (
  public.es_jefe()
  or (entidad = 'leads' and exists (select 1 from public.leads l where l.id = entidad_id and l.promotor_id = auth.uid()))
  or (entidad = 'bases' and exists (select 1 from public.bases b where b.id = entidad_id and b.promotor_id = auth.uid()))
);

-- ---------- Catálogos iniciales ----------
insert into public.catalogos (tipo, valor, orden)
select t.tipo, v.valor, v.orden from (values
  ('campana', array['Web','Respond','Google','Organico','Meta','Messenger','Whatsapp','Referido','Llamada','Base Datos','Cliente P','BD Renovación Activos','BD Renovación Inactiva','BD Renovación Manual']),
  ('perfil', array['Asalariado','No Asalariado','PYME','Pensionado','Remesante','Otro']),
  ('tipificacion', array['Aprobado','Saneado','P Restringido','Cobertura','Estabilidad L','No Aplica Score','No Hit','Zona franca','Seguimento','No contesta','Edad','Capacidad pago','Reporte de pago','Reno sin disponible','No cotiza','Poco inventario','Consulta','Desistió','No Acepta Monto','Repetido','Negocio pequeño','Convenio','Tasa de interés alta','Cliente en Mora','Número incorrecto','Salario Menor','No le interesa','Cliente potencial','Desea monto mayor','Préstamo con otra institución','Pensionado por invalidez','No productivo']),
  ('estado', array['Formalizado','Rechazado','En Analisis']),
  ('seguro', array['We Care','Asys','N/A']),
  ('tipo_base', array['Reasignacion','Renovacion'])
) t(tipo, vals), lateral unnest(t.vals) with ordinality v(valor, orden)
on conflict do nothing;
