-- ══════════════════════════════════════════════════════════════
-- FIX_MANIFIESTO_AMBIGUOUS_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Corrige el error:
--   "column reference 'correlativo' is ambiguous"
-- al generar el número de Manifiesto.
--
-- Causa: la función devuelve una columna llamada "correlativo"
-- (RETURNS TABLE(serie TEXT, correlativo INTEGER)), y Postgres
-- automáticamente crea una variable interna con ese mismo nombre.
-- Dentro del UPDATE a contador_manifiestos, "correlativo" quedaba
-- ambiguo entre esa variable y la columna de la tabla. Esta versión
-- califica cada referencia con el nombre de la tabla para eliminar
-- la ambigüedad de raíz.
-- ══════════════════════════════════════════════════════════════

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

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'obtener_o_generar_manifiesto';
