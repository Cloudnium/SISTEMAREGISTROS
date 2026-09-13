-- ══════════════════════════════════════════════════════════════
-- PLANILLA_FIX_ETIQUETA_MES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- BUG ENCONTRADO: en planilla_crear_periodo(), el arreglo de nombres
-- de mes se escribió como:
--     ARRAY['', 'Enero', 'Febrero', ..., 'Diciembre']
-- pensando en indexación desde 0 (como en JavaScript). Pero en
-- PostgreSQL los arreglos empiezan en el índice 1, así que:
--     v_meses[1]  = ''         (no 'Enero')
--     v_meses[9]  = 'Agosto'   (no 'Septiembre')
--     v_meses[10] = 'Septiembre' (no 'Octubre')
-- Por eso, al elegir "Septiembre 2026" se creaba un periodo con el
-- número de mes correcto (9) pero con el TEXTO "Planilla Agosto
-- 2026". El campo numérico "mes" siempre estuvo bien — solo el
-- texto (etiqueta) que se guardó junto con él salía corrido en 1.
--
-- Esta migración:
--   1. Corrige la función para futuros periodos.
--   2. Repara el texto de los periodos que ya se crearon mal
--      (recalculando la etiqueta a partir del mes/año reales, que
--      nunca estuvieron mal).
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.planilla_crear_periodo(
  p_mes        INTEGER,
  p_anio       INTEGER,
  p_usuario_id UUID
) RETURNS UUID AS $$
DECLARE
  v_periodo_id UUID;
  v_etiqueta   TEXT;
  -- OJO: en PostgreSQL este arreglo queda indexado desde 1, así que
  -- NO debe llevar un elemento vacío al inicio (a diferencia del
  -- arreglo MESES usado en el JavaScript de routes/planilla.js, que
  -- sí lleva '' al inicio porque en JS los arreglos empiezan en 0).
  v_meses      TEXT[] := ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
BEGIN
  IF p_mes IS NULL OR p_mes < 1 OR p_mes > 12 OR p_anio IS NULL THEN
    RAISE EXCEPTION 'DATOS_INVALIDOS';
  END IF;
  v_etiqueta := 'Planilla ' || v_meses[p_mes] || ' ' || p_anio;

  INSERT INTO public.planilla_periodos (mes, anio, etiqueta, estado, creado_por)
  VALUES (p_mes, p_anio, v_etiqueta, 'abierto', p_usuario_id)
  RETURNING id INTO v_periodo_id;

  INSERT INTO public.planilla_periodo_trabajadores
    (periodo_id, personal_id, sueldo_base, cargo, area, categoria, tipo, agregado_manualmente)
  SELECT v_periodo_id, id, COALESCE(sueldo_base, 0), cargo, area, categoria, tipo, false
  FROM public.personal_tripulantes
  WHERE activo = true;

  RETURN v_periodo_id;
END;
$$ LANGUAGE plpgsql;

-- Repara las etiquetas de los periodos que ya se crearon con el bug.
-- El mes/año numéricos nunca estuvieron mal, así que esto es 100%
-- seguro: solo reescribe el texto para que coincida con el número.
UPDATE public.planilla_periodos
SET etiqueta = 'Planilla ' || (ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])[mes]
               || ' ' || anio;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final: la etiqueta debe coincidir con el mes/año ──
SELECT id, mes, anio, etiqueta FROM public.planilla_periodos ORDER BY anio, mes;
