-- ══════════════════════════════════════════════════════════════
-- MAPA_ASIENTOS_ESCALERA_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Agrega el tipo de celda ('asiento' | 'escalera') para poder marcar
-- posiciones del grid como escalera en vez de asiento.
-- Es seguro ejecutarlo aunque la tabla ya exista: no borra datos.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.bus_asientos
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'asiento';

-- Permite que numero_asiento quede vacío para las celdas de escalera
-- (si la columna se creó originalmente como NOT NULL sin default).
ALTER TABLE public.bus_asientos
  ALTER COLUMN numero_asiento SET DEFAULT '';

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bus_asientos'
  AND column_name IN ('tipo','numero_asiento');
