-- ══════════════════════════════════════════════════════════════
-- CIUDADES_AGENCIAS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- NO modifica nada existente
-- ══════════════════════════════════════════════════════════════

-- TABLA: ciudades
CREATE TABLE IF NOT EXISTS public.ciudades (
  id        SERIAL       PRIMARY KEY,          -- ID numérico auto-incremental
  nombre    TEXT         NOT NULL UNIQUE,       -- Nombre de la ciudad (ej: LIMA)
  creado_en TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ciudades DISABLE ROW LEVEL SECURITY;

-- TABLA: agencias (terminales de embarque)
CREATE TABLE IF NOT EXISTS public.agencias (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT         NOT NULL,             -- Nombre/detalle de la agencia
  ciudad_id  INTEGER      NOT NULL REFERENCES public.ciudades(id) ON DELETE CASCADE,
  direccion  TEXT         NULL,                 -- Dirección de la agencia
  activo     BOOLEAN      NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agencias_ciudad ON public.agencias(ciudad_id);
ALTER TABLE public.agencias DISABLE ROW LEVEL SECURITY;

-- Verifica
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('ciudades','agencias');
