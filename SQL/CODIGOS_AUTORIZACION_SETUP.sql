-- ══════════════════════════════════════════════════════════════
-- CODIGOS_AUTORIZACION_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Códigos que, al ingresarse en la venta de un asiento, cambian el
-- precio de venta al monto que tenga asignado ese código.
-- Solo usuarios con permiso pueden CREAR códigos; cualquier usuario
-- autenticado puede USARLOS al vender.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.codigos_autorizacion (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       TEXT         NOT NULL UNIQUE,
  monto        NUMERIC(10,2) NOT NULL,
  descripcion  TEXT         NULL,
  activo       BOOLEAN      NOT NULL DEFAULT true,
  creado_por   UUID         NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codigos_autorizacion_codigo ON public.codigos_autorizacion(codigo);

ALTER TABLE public.codigos_autorizacion DISABLE ROW LEVEL SECURITY;

-- Permiso de usuario para poder CREAR códigos (todos pueden usarlos igual)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_crear_codigos BOOLEAN NOT NULL DEFAULT false;

-- Guarda qué código (si hubo alguno) se usó al vender un boleto, para trazabilidad
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS codigo_usado TEXT NULL;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'codigos_autorizacion';
