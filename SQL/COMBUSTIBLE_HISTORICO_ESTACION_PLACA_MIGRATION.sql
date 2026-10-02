-- ══════════════════════════════════════════════════════════════
-- COMBUSTIBLE_HISTORICO_ESTACION_PLACA_MIGRATION.sql
--
-- Problema: combustible_registros solo guardaba estacion_id/placa_id
-- (una referencia "viva" a estaciones/placas, con ON DELETE SET
-- NULL). Dos consecuencias no deseadas:
--   1) Si borras una estación/placa, sus registros de combustible YA
--      EXISTENTES pierden esa columna (queda en blanco).
--   2) Si renombras una estación/placa, el historial "cambia solo"
--      porque el nombre se lee en vivo en cada consulta.
--
-- Solución: guardar una FOTO FIJA del nombre en cada registro, al
-- momento de crearlo o editarlo (igual que una boleta no cambia si
-- renombras un producto después). El id se conserva igual (por si se
-- necesita filtrar/reportar por estación actual), pero la COLUMNA DE
-- TEXTO ya no depende de que esa fila siga existiendo ni de cómo se
-- llame hoy.
--
-- Aditivo y re-ejecutable (IF NOT EXISTS). No borra nada.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.combustible_registros
  ADD COLUMN IF NOT EXISTS estacion_nombre TEXT,
  ADD COLUMN IF NOT EXISTS placa_numero    TEXT;

-- Backfill: copia el nombre/número ACTUAL a los registros que ya
-- existen (antes de que nadie borre o renombre nada), para que el
-- historial de hoy quede protegido desde ya.
UPDATE public.combustible_registros cr
SET estacion_nombre = e.nombre
FROM public.estaciones e
WHERE cr.estacion_id = e.id AND cr.estacion_nombre IS NULL;

UPDATE public.combustible_registros cr
SET placa_numero = p.numero
FROM public.placas p
WHERE cr.placa_id = p.id AND cr.placa_numero IS NULL;

-- Verificación rápida
SELECT
  COUNT(*) AS total_registros,
  COUNT(estacion_nombre) AS con_nombre_estacion,
  COUNT(placa_numero)    AS con_numero_placa
FROM public.combustible_registros;
