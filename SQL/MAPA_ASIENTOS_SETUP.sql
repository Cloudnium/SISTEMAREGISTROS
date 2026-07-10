-- ══════════════════════════════════════════════════════════════
-- MAPA_ASIENTOS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- Configuración general por bus: pisos, filas, columnas
CREATE TABLE IF NOT EXISTS public.bus_config_asientos (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id        UUID    NOT NULL UNIQUE REFERENCES public.buses(id) ON DELETE CASCADE,
  num_pisos     INTEGER NOT NULL DEFAULT 1,      -- 1 o 2 pisos
  filas_p1      INTEGER NOT NULL DEFAULT 4,      -- filas piso 1
  columnas_p1   INTEGER NOT NULL DEFAULT 4,      -- columnas piso 1
  filas_p2      INTEGER NOT NULL DEFAULT 0,      -- filas piso 2
  columnas_p2   INTEGER NOT NULL DEFAULT 0,      -- columnas piso 2
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asientos individuales: posición y número por bus/piso
CREATE TABLE IF NOT EXISTS public.bus_asientos (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id         UUID  NOT NULL REFERENCES public.buses(id) ON DELETE CASCADE,
  piso           INTEGER NOT NULL DEFAULT 1,
  fila           INTEGER NOT NULL,
  columna        INTEGER NOT NULL,
  numero_asiento TEXT    NOT NULL,
  UNIQUE(bus_id, piso, fila, columna)
);

CREATE INDEX IF NOT EXISTS idx_asientos_bus  ON public.bus_asientos(bus_id);
CREATE INDEX IF NOT EXISTS idx_asientos_piso ON public.bus_asientos(bus_id, piso);

ALTER TABLE public.bus_config_asientos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_asientos        DISABLE ROW LEVEL SECURITY;

SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('bus_config_asientos','bus_asientos');
