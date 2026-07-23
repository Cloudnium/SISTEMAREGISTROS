-- ══════════════════════════════════════════════════════════════
-- BUSES_EMPRESA_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Agrega los datos de la empresa propietaria (Razón Social y RUC) a
-- cada bus, para poder registrar a qué empresa pertenece.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.buses
  ADD COLUMN IF NOT EXISTS empresa_razon_social TEXT NULL,
  ADD COLUMN IF NOT EXISTS empresa_ruc          TEXT NULL;

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'buses'
  AND column_name IN ('empresa_razon_social','empresa_ruc');
