-- ══════════════════════════════════════════════════════════════
-- DESTINO_CIUDADES_ADICIONALES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Permite que una ruta (ej: LIMA - SULLANA) también ofrezca agencias
-- de llegada de OTRAS ciudades relacionadas (ej: PIURA, por
-- pertenecer al mismo departamento), sin cambiar la ciudad destino
-- principal de la ruta.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.destino_ciudades_adicionales (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  destino_id  UUID    NOT NULL REFERENCES public.destinos(id) ON DELETE CASCADE,
  ciudad_id   INTEGER NOT NULL REFERENCES public.ciudades(id) ON DELETE CASCADE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(destino_id, ciudad_id)
);

ALTER TABLE public.destino_ciudades_adicionales DISABLE ROW LEVEL SECURITY;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'destino_ciudades_adicionales';
