-- ══════════════════════════════════════════════════════════════
-- BUSES_SETUP.sql — Módulo de Buses
-- Ejecuta en Supabase → SQL Editor → Run
-- NO modifica nada existente
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.buses (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Especificaciones técnicas ──
  placa                 TEXT         NOT NULL UNIQUE,
  marca                 TEXT         NULL,
  modelo                TEXT         NULL,
  anio_fabricacion      INTEGER      NULL,
  nro_ejes              INTEGER      NULL,
  nro_ruedas            INTEGER      NULL,
  nro_motor             TEXT         NULL,
  chasis                TEXT         NULL,

  -- ── SOAT ──
  soat_poliza           TEXT         NULL,
  soat_asientos         INTEGER      NULL,
  soat_vigencia         DATE         NULL,
  soat_poliza_dano      TEXT         NULL,
  soat_vigencia_dano    DATE         NULL,
  soat_monto_asegurado  NUMERIC(12,2) NULL,

  -- ── T.U.C. y Otros ──
  tuc_numero            TEXT         NULL,
  tuc_vigencia          DATE         NULL,
  extintor_vigencia     DATE         NULL,
  total_asientos        INTEGER      NULL,

  -- ── Tipo de servicio (FK a tabla servicios) ──
  servicio_id           UUID         NULL REFERENCES public.servicios(id) ON DELETE SET NULL,

  -- ── Control ──
  activo                BOOLEAN      NOT NULL DEFAULT true,
  creado_en             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buses_placa      ON public.buses(placa);
CREATE INDEX IF NOT EXISTS idx_buses_servicio   ON public.buses(servicio_id);
CREATE INDEX IF NOT EXISTS idx_buses_activo     ON public.buses(activo);

ALTER TABLE public.buses DISABLE ROW LEVEL SECURITY;

-- Verifica estructura
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'buses'
ORDER BY ordinal_position;
