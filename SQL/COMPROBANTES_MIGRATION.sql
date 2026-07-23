-- ══════════════════════════════════════════════════════════════
-- COMPROBANTES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Agrega método de pago y auditoría de anulación a los boletos,
-- para la nueva sección "Comprobantes".
-- Es seguro ejecutarlo aunque la tabla ya exista: no borra datos.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS metodo_pago  TEXT        NOT NULL DEFAULT 'efectivo',
  ADD COLUMN IF NOT EXISTS anulado_por  UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulado_en   TIMESTAMPTZ NULL;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'boletos'
  AND column_name IN ('metodo_pago','anulado_por','anulado_en');
