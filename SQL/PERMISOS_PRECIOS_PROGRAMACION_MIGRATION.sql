-- ══════════════════════════════════════════════════════════════
-- PERMISOS_PRECIOS_PROGRAMACION_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Nuevos permisos por usuario:
--  - puede_editar_precios: puede cambiar el precio/horario de una
--    salida directamente desde Boletaje.
--  - puede_programar: puede crear/editar programación de salidas
--    (incluyendo la programación masiva por rango de fechas).
--
-- Por seguridad, ambos quedan en FALSE por defecto: un administrador
-- debe habilitarlos explícitamente para quien corresponda.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_editar_precios BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puede_programar      BOOLEAN NOT NULL DEFAULT false;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'usuarios'
  AND column_name IN ('puede_editar_precios','puede_programar');
