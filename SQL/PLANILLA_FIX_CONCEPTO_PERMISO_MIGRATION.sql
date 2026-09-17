-- ══════════════════════════════════════════════════════════════
-- PLANILLA_FIX_CONCEPTO_PERMISO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Arregla el error:
--   "null value in column concepto_id of relation planilla_descuentos
--    violates not-null constraint"
--
-- Causa: la migración PLANILLA_PERMISO_DESCUENTO_MIGRATION.sql no llegó
-- a sembrar el concepto 'permiso_sin_goce' en el catálogo (o se corrió
-- antes de que existiera planilla_conceptos_descuento). Sin ese
-- concepto, un permiso "sin goce" con monto no puede generar su
-- descuento.
--
-- Esta migración:
--   1. Vuelve a sembrar el concepto (100% seguro re-ejecutar, no
--      duplica nada gracias a ON CONFLICT).
--   2. Deja la función con un mensaje de error claro si esto volviera
--      a faltar, en vez de un error crudo de Postgres.
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.planilla_conceptos_descuento (clave, nombre, es_sistema) VALUES
  ('permiso_sin_goce', 'Permiso sin goce de haber', true)
ON CONFLICT (clave) DO NOTHING;

-- Por si además faltara el concepto de uniforme (mismo tipo de problema)
INSERT INTO public.planilla_conceptos_descuento (clave, nombre, es_sistema) VALUES
  ('uniforme', 'Uniforme', true)
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.planilla_registrar_permiso(
  p_personal_id     UUID,
  p_tipo_id         UUID,
  p_fecha           DATE,
  p_hora_inicio     TIME,
  p_hora_fin        TIME,
  p_dia_completo    BOOLEAN,
  p_con_goce        BOOLEAN,
  p_motivo          TEXT,
  p_observacion     TEXT,
  p_monto_descuento NUMERIC,
  p_usuario_id      UUID
) RETURNS UUID AS $$
DECLARE
  v_permiso_id   UUID;
  v_descuento_id UUID;
  v_concepto_id  UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.personal_tripulantes WHERE id = p_personal_id) THEN
    RAISE EXCEPTION 'PERSONAL_NO_ENCONTRADO';
  END IF;

  INSERT INTO public.planilla_permisos
    (personal_id, tipo_id, fecha, hora_inicio, hora_fin, dia_completo, con_goce, motivo, observacion, creado_por)
  VALUES (p_personal_id, p_tipo_id, p_fecha, p_hora_inicio, p_hora_fin, p_dia_completo, p_con_goce, p_motivo, p_observacion, p_usuario_id)
  RETURNING id INTO v_permiso_id;

  IF p_con_goce = false AND p_monto_descuento IS NOT NULL AND p_monto_descuento > 0 THEN
    SELECT id INTO v_concepto_id FROM public.planilla_conceptos_descuento WHERE clave = 'permiso_sin_goce';

    IF v_concepto_id IS NULL THEN
      RAISE EXCEPTION 'FALTA_CONCEPTO_PERMISO_SIN_GOCE';
    END IF;

    INSERT INTO public.planilla_descuentos (personal_id, concepto_id, origen_codigo, importe_original, saldo, fecha, observacion, creado_por)
    VALUES (
      p_personal_id, v_concepto_id,
      'Permiso sin goce — ' || to_char(p_fecha, 'DD/MM/YYYY'),
      p_monto_descuento, p_monto_descuento, p_fecha,
      COALESCE(p_motivo, p_observacion), p_usuario_id
    )
    RETURNING id INTO v_descuento_id;

    UPDATE public.planilla_permisos SET descuento_id = v_descuento_id WHERE id = v_permiso_id;
  END IF;

  RETURN v_permiso_id;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT clave, nombre FROM public.planilla_conceptos_descuento WHERE clave IN ('permiso_sin_goce', 'uniforme');
