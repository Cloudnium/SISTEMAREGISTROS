-- ══════════════════════════════════════════════════════════════
-- AGENCIA_COLOR_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Agrega un color identificador por agencia, para que en el mapa de
-- asientos (Venta de Asientos) se pueda ver de un vistazo qué agencia
-- vendió cada asiento ocupado.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.agencias
  ADD COLUMN IF NOT EXISTS color TEXT NULL;

-- Le asigna automáticamente un color por defecto (variado) a las
-- agencias que todavía no tengan uno, para que se vea bien desde ya.
WITH paleta AS (
  SELECT unnest(ARRAY[
    '#6366f1', '#ef4444', '#10b981', '#f59e0b', '#3b82f6',
    '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4'
  ]) AS c
), numeradas AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY creado_en) AS rn
  FROM public.agencias WHERE color IS NULL
)
UPDATE public.agencias a
SET color = (SELECT c FROM paleta OFFSET (n.rn - 1) % 10 LIMIT 1)
FROM numeradas n
WHERE a.id = n.id;

NOTIFY pgrst, 'reload schema';

SELECT id, nombre, color FROM public.agencias ORDER BY creado_en;
