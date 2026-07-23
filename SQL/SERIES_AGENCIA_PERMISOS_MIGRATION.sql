-- ══════════════════════════════════════════════════════════════
-- SERIES_AGENCIA_PERMISOS_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Es seguro ejecutarlo aunque las tablas ya existan: no borra datos.
--
-- Agrega:
--  1. Serie y correlativo de boletos POR AGENCIA.
--  2. Asignación de agencia a cada usuario.
--  3. Permisos por usuario para anular / postergar / reservar / habilitar.
--  4. Columnas de serie/correlativo en boletos (se llenan al vender).
--  5. Función atómica para obtener el siguiente correlativo.
-- ══════════════════════════════════════════════════════════════

-- 1) Serie y correlativo por agencia ---------------------------
ALTER TABLE public.agencias
  ADD COLUMN IF NOT EXISTS serie_boleto       TEXT    NULL,
  ADD COLUMN IF NOT EXISTS correlativo_actual INTEGER NOT NULL DEFAULT 0;

-- 2) Agencia asignada a cada usuario + permisos -----------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS agencia_id       UUID    NULL REFERENCES public.agencias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS puede_anular     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS puede_postergar  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS puede_reservar   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS puede_habilitar  BOOLEAN NOT NULL DEFAULT true;

-- 3) Serie/correlativo grabados en cada boleto vendido ----------
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS serie       TEXT    NULL,
  ADD COLUMN IF NOT EXISTS correlativo INTEGER NULL;

-- 4) Función atómica: reserva y devuelve el siguiente correlativo
--    de la agencia indicada (evita duplicados con ventas simultáneas).
CREATE OR REPLACE FUNCTION public.siguiente_correlativo(p_agencia_id UUID)
RETURNS TABLE(serie TEXT, correlativo INTEGER) AS $$
DECLARE
  v_serie TEXT;
  v_correlativo INTEGER;
BEGIN
  UPDATE public.agencias
  SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1
  WHERE id = p_agencia_id
  RETURNING agencias.serie_boleto, agencias.correlativo_actual
  INTO v_serie, v_correlativo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agencia % no encontrada', p_agencia_id;
  END IF;

  RETURN QUERY SELECT v_serie, v_correlativo;
END;
$$ LANGUAGE plpgsql;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'usuarios'
  AND column_name IN ('agencia_id','puede_anular','puede_postergar','puede_reservar','puede_habilitar');
