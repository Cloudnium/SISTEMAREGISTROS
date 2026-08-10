-- ══════════════════════════════════════════════════════════════
-- CROQUIS_MANIFIESTO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Soporta las nuevas ventanas de Croquis y Manifiesto en Boletaje:
--  1. Ayudante asignado a cada salida (además de piloto, copilotos
--     y terramoza que ya existían).
--  2. Control de asistencia/embarque por pasajero (EMBARCÓ / NO
--     EMBARCÓ) — el "tablero" del Croquis.
--  3. Correlativo propio del Manifiesto por cada salida (se genera
--     una sola vez la primera vez que se imprime, y se reutiliza en
--     reimpresiones).
-- ══════════════════════════════════════════════════════════════

-- 1) Ayudante por salida
ALTER TABLE public.programaciones
  ADD COLUMN IF NOT EXISTS ayudante_id UUID NULL REFERENCES public.personal_tripulantes(id) ON DELETE SET NULL;

-- Nro de asientos y tarjeta de circulación pueden variar poco a poco;
-- se leen siempre del bus asignado (no se duplican en programaciones).

-- 2) Asistencia / control de embarque por boleto
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS embarco_estado     TEXT        NULL
    CHECK (embarco_estado IN ('embarco','no_embarco')),
  ADD COLUMN IF NOT EXISTS embarco_marcado_por UUID       NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS embarco_marcado_en  TIMESTAMPTZ NULL;

-- 3) Correlativo del Manifiesto — una serie única para toda la empresa,
-- correlativa por cada salida en la que se imprime por primera vez.
CREATE TABLE IF NOT EXISTS public.contador_manifiestos (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  serie        TEXT    NOT NULL DEFAULT '004',
  correlativo  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT solo_una_fila CHECK (id = 1)
);
INSERT INTO public.contador_manifiestos (id, serie, correlativo)
VALUES (1, '004', 0) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.programaciones
  ADD COLUMN IF NOT EXISTS manifiesto_serie       TEXT    NULL,
  ADD COLUMN IF NOT EXISTS manifiesto_correlativo INTEGER NULL;

-- Función atómica: si la programación aún no tiene número de
-- manifiesto, genera el siguiente y lo guarda; si ya tenía, devuelve
-- el mismo (para que reimprimir no genere números nuevos cada vez).
CREATE OR REPLACE FUNCTION public.obtener_o_generar_manifiesto(p_programacion_id UUID)
RETURNS TABLE(serie TEXT, correlativo INTEGER) AS $$
DECLARE
  v_serie TEXT;
  v_correlativo INTEGER;
BEGIN
  SELECT p.manifiesto_serie, p.manifiesto_correlativo
    INTO v_serie, v_correlativo
    FROM public.programaciones AS p
    WHERE p.id = p_programacion_id
    FOR UPDATE;

  IF v_correlativo IS NULL THEN
    UPDATE public.contador_manifiestos AS cm
      SET correlativo = cm.correlativo + 1
      WHERE cm.id = 1
      RETURNING cm.serie, cm.correlativo
      INTO v_serie, v_correlativo;

    UPDATE public.programaciones AS p
      SET manifiesto_serie = v_serie, manifiesto_correlativo = v_correlativo
      WHERE p.id = p_programacion_id;
  END IF;

  RETURN QUERY SELECT v_serie, v_correlativo;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'programaciones'
  AND column_name IN ('ayudante_id','manifiesto_serie','manifiesto_correlativo');
