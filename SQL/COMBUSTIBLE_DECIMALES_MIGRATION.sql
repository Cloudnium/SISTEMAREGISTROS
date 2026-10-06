-- ══════════════════════════════════════════════════════════════
-- COMBUSTIBLE_DECIMALES_MIGRATION.sql
--
-- galones y precio de combustible_registros pasan a aceptar 3
-- decimales (antes estaban limitados a 2). Ensanchar un NUMERIC
-- nunca trunca ni pierde datos que ya tengas: lo que hoy tiene 2
-- decimales se queda exactamente igual, solo que de ahora en más
-- puedes guardar hasta 3.
--
-- Seguro de ejecutar varias veces.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.combustible_registros
  ALTER COLUMN galones TYPE NUMERIC(12,3),
  ALTER COLUMN precio  TYPE NUMERIC(12,3);

-- Verificación rápida
SELECT column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'combustible_registros' AND column_name IN ('galones', 'precio');
