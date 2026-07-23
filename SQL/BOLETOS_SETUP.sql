-- ══════════════════════════════════════════════════════════════
-- BOLETOS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: programaciones, agencias, usuarios
-- Guarda la venta/reserva de cada asiento por programación (viaje).
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.boletos (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  programacion_id      UUID         NOT NULL REFERENCES public.programaciones(id) ON DELETE CASCADE,
  piso                 INTEGER      NOT NULL DEFAULT 1,
  numero_asiento       TEXT         NOT NULL,

  estado               TEXT         NOT NULL DEFAULT 'vendido'
                                     CHECK (estado IN ('vendido','reservado','postergado','anulado')),

  precio               NUMERIC(10,2) NULL,

  -- Datos del cliente
  tipo_documento       TEXT         NULL,      -- DNI, CE, PASAPORTE...
  numero_documento     TEXT         NULL,
  nombre_completo      TEXT         NULL,
  edad                 INTEGER      NULL,
  telefono             TEXT         NULL,
  ruc                  TEXT         NULL,
  razon_social         TEXT         NULL,

  -- Agencias de embarque / llegada (terminales dentro de la ciudad origen/destino)
  agencia_embarque_id  UUID         NULL REFERENCES public.agencias(id) ON DELETE SET NULL,
  agencia_llegada_id   UUID         NULL REFERENCES public.agencias(id) ON DELETE SET NULL,

  -- Auditoría: quién vendió/gestionó el boleto
  vendido_por          UUID         NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,

  creado_en            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  actualizado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Un solo registro activo por asiento/piso dentro de cada viaje
  UNIQUE(programacion_id, piso, numero_asiento)
);

CREATE INDEX IF NOT EXISTS idx_boletos_programacion ON public.boletos(programacion_id);
CREATE INDEX IF NOT EXISTS idx_boletos_estado        ON public.boletos(estado);

ALTER TABLE public.boletos DISABLE ROW LEVEL SECURITY;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'boletos';
