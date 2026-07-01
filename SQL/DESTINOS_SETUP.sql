-- ══════════════════════════════════════════════════════════════
-- DESTINOS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere que ya existan las tablas: ciudades, agencias
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.destinos (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  ciudad_origen   INTEGER   NOT NULL REFERENCES public.ciudades(id) ON DELETE CASCADE,
  ciudad_destino  INTEGER   NOT NULL REFERENCES public.ciudades(id) ON DELETE CASCADE,
  agencia_id      UUID      NOT NULL REFERENCES public.agencias(id) ON DELETE CASCADE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Evita registrar el mismo par origen-destino-agencia dos veces
  UNIQUE(ciudad_origen, ciudad_destino, agencia_id)
);

CREATE INDEX IF NOT EXISTS idx_destinos_origen  ON public.destinos(ciudad_origen);
CREATE INDEX IF NOT EXISTS idx_destinos_destino ON public.destinos(ciudad_destino);

ALTER TABLE public.destinos DISABLE ROW LEVEL SECURITY;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'destinos' ORDER BY ordinal_position;
