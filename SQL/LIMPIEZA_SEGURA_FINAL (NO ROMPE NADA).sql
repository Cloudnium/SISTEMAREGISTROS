
-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA_SEGURA.sql
-- ⚠️ MUY DESTRUCTIVO para todo lo demás — lee esto antes de correrlo ⚠️
--
-- Reemplaza/actualiza a LIMPIEZA_TOTAL_MENOS_COMBUSTIBLE.sql: borra
-- ABSOLUTAMENTE TODO el sistema (ventas, programación, buses,
-- ciudades, agencias, empresas, destinos, servicios, personal,
-- planilla completa, inventario de uniformes e inventario general,
-- chat, códigos de autorización, configuración de secciones y roles)
-- y reinicia todos los correlativos a 0.
--
-- Lo ÚNICO que se conserva intacto, pase lo que pase:
--   • public.usuarios                (nadie se borra, ni sus contraseñas/roles/permisos)
--   • public.combustible_registros   (todo el historial de combustible)
--   • public.estaciones              (catálogo de estaciones)
--   • public.placas                  (catálogo de placas)
--
-- ── Por qué es "segura" (a diferencia de un TRUNCATE a mano) ──
-- Un TRUNCATE ... CASCADE arrastra automáticamente a CUALQUIER tabla
-- que tenga una llave foránea apuntando a una tabla truncada — sin
-- importar que esa llave sea "ON DELETE SET NULL". Como "usuarios"
-- tiene una llave hacia "agencias" (agencia_id), truncar "agencias"
-- de forma ingenua truncaría también "usuarios" por completo.
--
-- Este script se protege de eso de forma GENÉRICA: antes de tocar
-- nada, detecta TODAS las llaves foráneas que salen de "usuarios"
-- hacia cualquier otra tabla (hoy es solo agencia_id, pero si en el
-- futuro se agrega otra, este script la protege igual sin que nadie
-- tenga que acordarse de actualizarlo), las guarda, las quita, hace
-- la limpieza, y las vuelve a crear EXACTAMENTE como estaban.
--
-- combustible_registros, estaciones y placas simplemente nunca
-- aparecen en el TRUNCATE de abajo — no dependen de este mecanismo,
-- así que ninguna sección del script puede borrarlas por accidente.
--
-- Ejecuta en Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════
 
BEGIN;
 
-- 0) Verificación ANTES de tocar nada (para comparar con el "después")
CREATE TEMP TABLE _limpieza_antes ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*) FROM public.usuarios)              AS usuarios,
  (SELECT COUNT(*) FROM public.combustible_registros) AS combustible_registros,
  (SELECT COUNT(*) FROM public.estaciones)             AS estaciones,
  (SELECT COUNT(*) FROM public.placas)                 AS placas;
 
-- 1) Detecta y guarda TODAS las llaves foráneas que salen de
--    "usuarios" hacia otra tabla, y las quita temporalmente.
CREATE TEMP TABLE _fks_usuarios_respaldo (conname TEXT, definicion TEXT) ON COMMIT DROP;
 
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'usuarios' AND con.contype = 'f'
  LOOP
    INSERT INTO _fks_usuarios_respaldo VALUES (r.conname, r.definicion);
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
 
-- 2) Limpia las columnas de usuarios que apuntaban a filas que están
--    a punto de desaparecer (hoy: agencia_id → agencias). Si en el
--    futuro se agrega otra llave de usuarios hacia una tabla que este
--    script también trunca, agrega aquí su misma limpieza.
UPDATE public.usuarios SET agencia_id = NULL WHERE agencia_id IS NOT NULL;
 
-- 3) Todo lo transaccional, de catálogo y de configuración, en un
--    solo TRUNCATE con CASCADE (arrastra automáticamente cualquier
--    tabla dependiente que no esté listada aquí). Como ya no queda
--    ninguna llave foránea de "usuarios" hacia estas tablas, y
--    combustible_registros/estaciones/placas ni siquiera aparecen en
--    esta lista, ninguna de las cuatro tablas protegidas puede verse
--    afectada por este CASCADE.
TRUNCATE TABLE
  -- Ventas / operación diaria
  public.boletos,
  public.boletos_movimientos,
  public.programacion_escalas,
  public.programaciones,
  public.codigos_autorizacion,
  public.series_agencia_empresa,
  -- Flota / buses
  public.bus_asientos,
  public.bus_config_asientos,
  public.buses,
  -- Datos maestros comerciales
  public.empresas,
  public.destino_ciudades_adicionales,
  public.destinos,
  public.agencias,
  public.ciudades,
  public.servicios,
  -- Personal y Planilla (completa)
  public.personal_tripulantes,
  public.personal_empleados,
  public.personal_vacaciones,
  public.planilla_periodo_trabajadores,
  public.planilla_bonos,
  public.planilla_descuento_cobros,
  public.planilla_descuentos,
  public.planilla_conceptos_descuento,
  public.planilla_vacaciones,
  public.planilla_permisos,
  public.planilla_tipos_permiso,
  public.planilla_auditoria,
  public.planilla_periodos,
  public.planilla_movimientos,
  public.planilla_pagos,
  public.planilla_empresa_datos,
  -- Inventario (uniformes + inventario general)
  public.inventario_uniformes_movimientos,
  public.inventario_uniformes,
  public.inventario_items_movimientos,
  public.inventario_items,
  public.inventario_categorias,
  public.inventario_movimientos,
  public.inventario_productos,
  -- Chat interno
  public.chat_grupo_lecturas,
  public.chat_grupo_mensajes,
  public.chat_grupo_miembros,
  public.chat_grupos,
  public.chat_mensajes,
  public.chat_reacciones,
  -- Configuración (Desarrollador): visibilidad de secciones y
  -- permisos por defecto de cada rol. Es seguro reiniciar esto: el
  -- sistema trata cualquier sección sin fila como "visible" por
  -- defecto, así que nada desaparece del menú por truncar esto.
  public.configuracion_secciones,
  public.configuracion_roles_permisos
RESTART IDENTITY CASCADE;
 
-- 4) Restaura EXACTAMENTE las llaves foráneas que se quitaron en el
--    paso 1 (mismo nombre, misma definición).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT conname, definicion FROM _fks_usuarios_respaldo LOOP
    EXECUTE format('ALTER TABLE public.usuarios ADD CONSTRAINT %I %s', r.conname, r.definicion);
  END LOOP;
END $$;
 
-- 5) Reinicia el correlativo del manifiesto (fila única, no se borra)
UPDATE public.contador_manifiestos SET correlativo = 0;
 
-- 6) Vuelve a sembrar las filas/catálogos mínimos que el sistema
--    necesita para seguir funcionando (si no, formularios como
--    "nuevo descuento" o "datos de la empresa" quedarían vacíos).
INSERT INTO public.planilla_empresa_datos (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
 
INSERT INTO public.planilla_conceptos_descuento (clave, nombre, es_sistema) VALUES
  ('adelanto',  'Adelanto de sueldo', false),
  ('prestamo',  'Préstamo',           false),
  ('falta',     'Falta',              false),
  ('uniforme',  'Uniforme',           true),
  ('permiso_sin_goce', 'Permiso sin goce de haber', true),
  ('equipo',    'Equipo',             false),
  ('dano',      'Daño',               false),
  ('afp',       'AFP',                false),
  ('onp',       'ONP',                false),
  ('otro',      'Otro',               false)
ON CONFLICT (clave) DO NOTHING;
 
INSERT INTO public.planilla_tipos_permiso (nombre) VALUES
  ('Médico'), ('Personal'), ('Trámite'), ('Estudios'), ('Otro')
ON CONFLICT (nombre) DO NOTHING;
 
-- La sección "Uniformes" de Inventario es fija/del sistema — sin esto,
-- desaparecería del todo al limpiar.
INSERT INTO public.inventario_categorias (clave, nombre, icono, tipo, orden, es_sistema)
VALUES ('uniformes', 'Uniformes', 'shirt', 'uniformes', 1, true)
ON CONFLICT (clave) DO NOTHING;
 
-- Permisos por defecto de rol: repone los mismos valores con los que
-- arrancó el sistema (Operador con los 5 básicos de Boletaje activos;
-- Visualizador sin ninguno). Esto es solo una plantilla — no afecta
-- a ningún usuario ya creado.
INSERT INTO public.configuracion_roles_permisos
  (rol, puede_anular, puede_postergar, puede_reservar, puede_habilitar, puede_reintegro)
VALUES
  ('operador', true, true, true, true, true),
  ('visualizador', false, false, false, false, false)
ON CONFLICT (rol) DO NOTHING;
 
-- ── Verificación final (dentro de la misma transacción, antes del
--    COMMIT, para poder comparar contra la tabla temporal del paso 0):
--    compara "antes" vs "después" de las 4 tablas protegidas (deben
--    salir exactamente iguales) y muestra que el resto quedó en cero ──
SELECT
  a.usuarios              AS usuarios_antes,
  (SELECT COUNT(*) FROM public.usuarios)              AS usuarios_despues,
  a.combustible_registros AS combustible_antes,
  (SELECT COUNT(*) FROM public.combustible_registros) AS combustible_despues,
  a.estaciones             AS estaciones_antes,
  (SELECT COUNT(*) FROM public.estaciones)             AS estaciones_despues,
  a.placas                 AS placas_antes,
  (SELECT COUNT(*) FROM public.placas)                 AS placas_despues,
  (SELECT COUNT(*) FROM public.boletos)                AS boletos_restantes,
  (SELECT COUNT(*) FROM public.ciudades)               AS ciudades_restantes,
  (SELECT COUNT(*) FROM public.buses)                  AS buses_restantes,
  (SELECT COUNT(*) FROM public.personal_tripulantes)   AS personal_restante,
  (SELECT COUNT(*) FROM public.planilla_periodos)      AS periodos_restantes,
  (SELECT COUNT(*) FROM public.inventario_categorias WHERE clave = 'uniformes') AS seccion_uniformes_ok,
  (SELECT COUNT(*) FROM public.configuracion_roles_permisos) AS roles_permisos_reseteados,
  (SELECT COUNT(*) FROM public.usuarios WHERE agencia_id IS NOT NULL) AS usuarios_con_agencia_huerfana
FROM _limpieza_antes a;
 
COMMIT;
 
