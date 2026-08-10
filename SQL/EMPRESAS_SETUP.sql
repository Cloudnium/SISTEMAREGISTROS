-- ══════════════════════════════════════════════════════════════
-- EMPRESAS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Registro de empresas propietarias de los buses (RUC, Razón Social,
-- Domicilio Fiscal). Luego, al registrar/editar un bus, se elige la
-- empresa de una lista en vez de volver a escribirla cada vez.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.empresas (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ruc               TEXT         NOT NULL UNIQUE,
  razon_social      TEXT         NOT NULL,
  domicilio_fiscal  TEXT         NULL,
  activo            BOOLEAN      NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.empresas DISABLE ROW LEVEL SECURITY;

-- Vincula cada bus a una empresa registrada (además de los campos de
-- texto libre que ya existían, que se conservan como respaldo/legado
-- para buses que aún no tengan una empresa asignada de la lista).
ALTER TABLE public.buses
  ADD COLUMN IF NOT EXISTS empresa_id UUID NULL REFERENCES public.empresas(id) ON DELETE SET NULL;

-- Migra automáticamente los datos de texto libre ya cargados (si los
-- hubiera) a una empresa registrada, para no perder lo ya ingresado.
INSERT INTO public.empresas (ruc, razon_social, creado_en)
SELECT DISTINCT ON (empresa_ruc) empresa_ruc, empresa_razon_social, NOW()
FROM public.buses
WHERE empresa_ruc IS NOT NULL AND empresa_razon_social IS NOT NULL
  AND empresa_ruc NOT IN (SELECT ruc FROM public.empresas)
ON CONFLICT (ruc) DO NOTHING;

UPDATE public.buses b
SET empresa_id = e.id
FROM public.empresas e
WHERE b.empresa_ruc = e.ruc AND b.empresa_id IS NULL;

NOTIFY pgrst, 'reload schema';

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'empresas';
