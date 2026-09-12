-- ══════════════════════════════════════════════════════════════
-- PLANILLA_PERMISO_DESCUENTO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run (después de las 3 migraciones
-- anteriores de Planilla)
--
-- Qué agrega:
--   Cuando se registra un permiso SIN goce de haber, se puede indicar
--   cuánto se le va a descontar por esa ausencia. Eso genera un
--   planilla_descuentos normal (con saldo, historial de cobros
--   parciales en distintas planillas) enlazado a ese permiso — exactamente
--   el mismo patrón que ya existe para la entrega de uniformes.
--
--   Un permiso CON goce, o SIN goce pero sin monto indicado, no genera
--   ningún descuento (tal como pide la regla: una ausencia no debe
--   descontarse automáticamente salvo que se indique explícitamente).
-- ══════════════════════════════════════════════════════════════

-- 1) El permiso queda enlazado al descuento que generó (si generó alguno)
ALTER TABLE public.planilla_permisos
  ADD COLUMN IF NOT EXISTS descuento_id UUID NULL REFERENCES public.planilla_descuentos(id) ON DELETE SET NULL;

-- 2) Nuevo concepto de descuento del catálogo
INSERT INTO public.planilla_conceptos_descuento (clave, nombre, es_sistema) VALUES
  ('permiso_sin_goce', 'Permiso sin goce de haber', true)
ON CONFLICT (clave) DO NOTHING;

-- 3) Registra el permiso y, si corresponde, su descuento — en una sola
--    transacción atómica (si algo falla, no queda un permiso "suelto"
--    sin su descuento o viceversa).
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

  -- Solo se genera descuento si el permiso es SIN goce Y se indicó un monto > 0.
  -- No es una regla automática: si no se indica monto, no se descuenta nada.
  IF p_con_goce = false AND p_monto_descuento IS NOT NULL AND p_monto_descuento > 0 THEN
    SELECT id INTO v_concepto_id FROM public.planilla_conceptos_descuento WHERE clave = 'permiso_sin_goce';

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
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='planilla_permisos' AND column_name='descuento_id') AS columna_ok,
  (SELECT COUNT(*) FROM public.planilla_conceptos_descuento WHERE clave='permiso_sin_goce') AS concepto_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='planilla_registrar_permiso') AS funcion_ok;
