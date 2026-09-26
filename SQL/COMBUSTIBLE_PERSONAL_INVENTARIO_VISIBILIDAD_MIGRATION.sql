-- =============================================
-- COMBUSTIBLE_PERSONAL_INVENTARIO_VISIBILIDAD_MIGRATION.sql
--
-- Combustible, Personal e Inventario dejan de estar siempre visibles
-- para todos. Pasan a comportarse igual que el resto de secciones:
--   - Se pueden ocultar/mostrar desde "Visibilidad de secciones".
--   - admin también queda sujeto a esa visibilidad (solo
--     "desarrollador" siempre puede entrar, igual que las demás).
--   - Para roles distintos de admin/desarrollador, además hace falta
--     el permiso explícito correspondiente (ver checkboxes en
--     Usuarios): puede_ver_combustible, puede_ver_personal,
--     puede_ver_inventario.
--
-- Seguro de ejecutar varias veces (IF NOT EXISTS / ON CONFLICT).
-- =============================================

-- 1) Nuevos permisos de usuario ----------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_ver_combustible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puede_ver_personal    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puede_ver_inventario   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuarios.puede_ver_combustible IS 'Permite ver/usar la sección Combustible (además de admin/desarrollador, que siempre pueden si la sección está visible)';
COMMENT ON COLUMN public.usuarios.puede_ver_personal    IS 'Permite ver/usar la sección Personal (además de admin/desarrollador, que siempre pueden si la sección está visible)';
COMMENT ON COLUMN public.usuarios.puede_ver_inventario  IS 'Permite ver/usar la sección Inventario (además de admin/desarrollador, que siempre pueden si la sección está visible). No reemplaza a puede_gestionar_inventario/puede_restar_stock, que siguen controlando editar catálogo y restar stock.';

-- 2) Se agregan como secciones controlables en "Visibilidad de secciones" ---
INSERT INTO public.configuracion_secciones (clave, visible) VALUES
  ('combustible', true), ('personal', true), ('inventario', true)
ON CONFLICT (clave) DO NOTHING;

-- Verificación rápida
SELECT column_name FROM information_schema.columns
WHERE table_name = 'usuarios'
  AND column_name IN ('puede_ver_combustible','puede_ver_personal','puede_ver_inventario');

SELECT clave, visible FROM public.configuracion_secciones
WHERE clave IN ('combustible','personal','inventario');
