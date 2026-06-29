-- ══════════════════════════════════════════════════════════════
-- PERSONAL_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Crea la tabla de personal/tripulantes
-- NO modifica nada existente
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.personal_tripulantes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombres     TEXT         NOT NULL,
  apellidos   TEXT         NOT NULL,
  tipo        TEXT         NOT NULL                          -- Chofer | Terramoza | Ayudante
                           CHECK (tipo IN ('Chofer', 'Terramoza', 'Ayudante')),
  dni         TEXT         NOT NULL,
  telefono    TEXT         NULL,
  licencia    TEXT         NULL,                             -- Solo aplica si tipo = Chofer
  activo      BOOLEAN      NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_dni    ON public.personal_tripulantes(dni);
CREATE INDEX IF NOT EXISTS idx_personal_tipo   ON public.personal_tripulantes(tipo);
CREATE INDEX IF NOT EXISTS idx_personal_activo ON public.personal_tripulantes(activo);

ALTER TABLE public.personal_tripulantes DISABLE ROW LEVEL SECURITY;

-- Verifica
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'personal_tripulantes'
ORDER BY ordinal_position;
