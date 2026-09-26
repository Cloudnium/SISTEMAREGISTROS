-- =============================================
-- DASHBOARD_ESTACIONES_PLACAS_PERMISO_MIGRATION.sql
--
-- Agrega el permiso "puede_gestionar_estaciones_placas" a usuarios,
-- usado por el nuevo panel de Estaciones / Placas del Dashboard.
--
-- Reglas de visibilidad del panel (se aplican en el código, no aquí):
--   - admin / desarrollador → siempre lo ven
--   - resto de roles        → solo si puede_gestionar_estaciones_placas = true
--
-- Seguro de ejecutar varias veces (IF NOT EXISTS).
-- =============================================

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_gestionar_estaciones_placas BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuarios.puede_gestionar_estaciones_placas IS
  'Permite ver y administrar (agregar/editar/eliminar) Estaciones y Placas desde el panel del Dashboard, para roles distintos de admin/desarrollador';

-- Verificación rápida
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'usuarios' AND column_name = 'puede_gestionar_estaciones_placas';
