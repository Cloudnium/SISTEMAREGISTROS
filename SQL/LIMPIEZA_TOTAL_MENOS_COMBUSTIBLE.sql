-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA_TOTAL_MENOS_COMBUSTIBLE.sql
-- ⚠️ MUY DESTRUCTIVO — lee esto antes de correrlo ⚠️
--
-- Borra ABSOLUTAMENTE TODO el sistema (ventas, programación, buses,
-- ciudades, agencias, empresas, destinos, servicios, personal,
-- planilla completa, inventario de uniformes e inventario general,
-- chat, códigos de autorización, configuración de secciones) y
-- reinicia todos los correlativos a 0.
--
-- Lo ÚNICO que se conserva intacto es:
--   • public.usuarios       (nadie se borra, ni sus contraseñas/roles)
--   • public.combustible_registros
--   • public.estaciones
--   • public.placas
--
-- ── CORRECCIÓN IMPORTANTE (respecto a la versión anterior) ──
-- La versión anterior de este script SÍ borraba a los usuarios,
-- aunque decía que no. La causa: usuarios.agencia_id tiene una
-- llave foránea hacia agencias, y un TRUNCATE ... CASCADE arrastra
-- automáticamente a CUALQUIER tabla que apunte a las tablas
-- truncadas — sin importar que esa llave sea "ON DELETE SET NULL".
-- Al truncar "agencias" con CASCADE, Postgres truncaba también
-- "usuarios" por completo.
--
-- Esta versión corrige eso: quita esa llave foránea antes de
-- truncar, limpia el agencia_id de los usuarios (ya no existirá esa
-- agencia), y vuelve a crear la misma llave al final. Los usuarios
-- nunca se tocan como tabla — solo se les limpia ese campo, como
-- hubiera pasado siempre que se borrara una agencia.
--
-- Ejecuta en Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Quita temporalmente la llave foránea usuarios.agencia_id → agencias
--    (se busca por su definición real, no por nombre, para que funcione
--    sin importar cómo se haya llamado al crearse).
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'usuarios' AND con.contype = 'f'
    AND pg_get_constraintdef(con.oid) ILIKE '%agencia_id%REFERENCES%agencias%';

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

-- 2) Todo lo transaccional y de catálogo, en un solo TRUNCATE con
--    CASCADE (arrastra automáticamente cualquier tabla dependiente
--    que no esté listada aquí). Como ya no queda ninguna llave
--    foránea de "usuarios" hacia estas tablas, usuarios YA NO puede
--    verse afectado por este CASCADE.
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
  -- Configuración de secciones (Desarrollador)
  public.configuracion_secciones
RESTART IDENTITY CASCADE;

-- 3) Limpia la referencia a agencia en los usuarios (esa agencia ya
--    no existe) y vuelve a crear la llave foránea que se quitó en el
--    paso 1, exactamente con el mismo comportamiento de antes.
UPDATE public.usuarios SET agencia_id = NULL WHERE agencia_id IS NOT NULL;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_agencia_id_fkey
  FOREIGN KEY (agencia_id) REFERENCES public.agencias(id) ON DELETE SET NULL;

-- 4) Reinicia el correlativo del manifiesto (fila única, no se borra)
UPDATE public.contador_manifiestos SET correlativo = 0;

-- 5) Vuelve a sembrar las filas/catálogos mínimos que el sistema
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

COMMIT;

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM public.usuarios)              AS usuarios_intactos,
  (SELECT COUNT(*) FROM public.combustible_registros) AS combustible_intacto,
  (SELECT COUNT(*) FROM public.estaciones)             AS estaciones_intactas,
  (SELECT COUNT(*) FROM public.placas)                 AS placas_intactas,
  (SELECT COUNT(*) FROM public.boletos)                AS boletos_restantes,
  (SELECT COUNT(*) FROM public.ciudades)               AS ciudades_restantes,
  (SELECT COUNT(*) FROM public.buses)                  AS buses_restantes,
  (SELECT COUNT(*) FROM public.personal_tripulantes)   AS personal_restante,
  (SELECT COUNT(*) FROM public.planilla_periodos)      AS periodos_restantes,
  (SELECT COUNT(*) FROM public.usuarios WHERE agencia_id IS NOT NULL) AS usuarios_con_agencia_huerfana;
