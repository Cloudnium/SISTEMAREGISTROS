-- ══════════════════════════════════════════════════════════════
-- SERVICIOS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Crea la tabla de tipos de servicio
-- NO modifica nada existente
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.servicios (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT         NOT NULL,          -- Nombre del servicio (ej: S_BLACK, SUITE)
  descripcion  TEXT         NULL,              -- Características del servicio
  icono        TEXT         NOT NULL DEFAULT 'star',  -- Nombre del ícono Lucide
  categoria    TEXT         NULL,              -- Etiqueta/badge (ej: PREMIUM, VIP)
  activo       BOOLEAN      NOT NULL DEFAULT true,
  creado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servicios_activo ON public.servicios(activo);

ALTER TABLE public.servicios DISABLE ROW LEVEL SECURITY;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'servicios' ORDER BY ordinal_position;
