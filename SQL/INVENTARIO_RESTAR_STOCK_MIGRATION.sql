-- ══════════════════════════════════════════════════════════════
-- INVENTARIO_RESTAR_STOCK_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Agrega:
--   1. Permiso puede_restar_stock en usuarios — por defecto solo
--      admin/desarrollador pueden restar stock manualmente; con este
--      permiso se le puede habilitar a cualquier otro rol (igual que
--      puede_gestionar_inventario, puede_ver_planilla, etc.)
--   2. Nuevo tipo de movimiento 'salida_manual' para cuando se resta
--      stock a mano (mermas, productos dañados, etc.) — se muestra en
--      el historial como "Salida", igual que una entrega, pero sin
--      generar ningún descuento en Planilla.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_restar_stock BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.inventario_uniformes_movimientos DROP CONSTRAINT IF EXISTS inventario_uniformes_movimientos_tipo_check;
ALTER TABLE public.inventario_uniformes_movimientos
  ADD CONSTRAINT inventario_uniformes_movimientos_tipo_check
  CHECK (tipo IN ('ingreso', 'entrega', 'modificacion', 'salida_manual'));

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='usuarios' AND column_name='puede_restar_stock') AS permiso_ok;
