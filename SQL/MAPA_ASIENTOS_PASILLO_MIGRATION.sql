-- ══════════════════════════════════════════════════════════════
-- MAPA_ASIENTOS_PASILLO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Agrega el guardado de la posición del pasillo (espacio entre
-- filas de asientos) para el nuevo diseño del Mapa de Asientos.
-- Es seguro ejecutarlo aunque la tabla ya exista: no borra datos.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.bus_config_asientos
  ADD COLUMN IF NOT EXISTS pasillo_p1 INTEGER NOT NULL DEFAULT 0,  -- pasillo tras esta fila (piso 1)
  ADD COLUMN IF NOT EXISTS pasillo_p2 INTEGER NOT NULL DEFAULT 0;  -- pasillo tras esta fila (piso 2)

-- Las filas por piso ahora están limitadas a un máximo de 4 desde el
-- editor (filas horizontales del bus). No se agrega un CHECK aquí
-- para no romper configuraciones antiguas que ya tengan más filas
-- guardadas; simplemente el editor ya no permitirá crear más de 4.

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bus_config_asientos'
  AND column_name IN ('pasillo_p1','pasillo_p2');
