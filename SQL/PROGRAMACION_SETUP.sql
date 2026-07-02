-- ══════════════════════════════════════════════════════════════
-- PROGRAMACION_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: destinos, servicios, buses, personal_tripulantes, agencias
-- ══════════════════════════════════════════════════════════════

-- Tabla principal de programaciones
CREATE TABLE IF NOT EXISTS public.programaciones (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_salida     DATE         NOT NULL,
  destino_id       UUID         NOT NULL REFERENCES public.destinos(id)              ON DELETE RESTRICT,
  servicio_id      UUID         NULL     REFERENCES public.servicios(id)             ON DELETE SET NULL,
  bus_id           UUID         NULL     REFERENCES public.buses(id)                 ON DELETE SET NULL,

  -- Personal
  piloto_id        UUID         NOT NULL REFERENCES public.personal_tripulantes(id)  ON DELETE RESTRICT,
  copiloto1_id     UUID         NULL     REFERENCES public.personal_tripulantes(id)  ON DELETE SET NULL,
  copiloto2_id     UUID         NULL     REFERENCES public.personal_tripulantes(id)  ON DELETE SET NULL,
  terramoza_id     UUID         NULL     REFERENCES public.personal_tripulantes(id)  ON DELETE SET NULL,

  -- Tarifas
  precio_piso1     NUMERIC(10,2) NULL,
  precio_piso2     NUMERIC(10,2) NULL,

  -- Estado
  estado           TEXT         NOT NULL DEFAULT 'publicado'
                                CHECK (estado IN ('publicado','descartado','finalizado')),
  creado_en        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Escalas / puntos de parada (máx 6 por programación)
CREATE TABLE IF NOT EXISTS public.programacion_escalas (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  programacion_id  UUID         NOT NULL REFERENCES public.programaciones(id) ON DELETE CASCADE,
  orden            INTEGER      NOT NULL,     -- 1 al 6
  agencia_id       UUID         NOT NULL REFERENCES public.agencias(id)       ON DELETE RESTRICT,
  hora             TIME         NULL,
  UNIQUE(programacion_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_prog_fecha    ON public.programaciones(fecha_salida);
CREATE INDEX IF NOT EXISTS idx_prog_destino  ON public.programaciones(destino_id);
CREATE INDEX IF NOT EXISTS idx_prog_estado   ON public.programaciones(estado);
CREATE INDEX IF NOT EXISTS idx_escalas_prog  ON public.programacion_escalas(programacion_id);

ALTER TABLE public.programaciones       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.programacion_escalas DISABLE ROW LEVEL SECURITY;

SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('programaciones','programacion_escalas');
