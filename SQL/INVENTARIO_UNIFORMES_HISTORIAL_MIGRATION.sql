-- ══════════════════════════════════════════════════════════════
-- INVENTARIO_UNIFORMES_HISTORIAL_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Para poder mostrar un historial de movimientos completo (con stock
-- ANTES → DESPUÉS de cada movimiento, quién lo hizo y por qué), hace
-- falta guardar esos datos en el momento exacto en que ocurre cada
-- movimiento — hoy no se guardaban.
--
-- Agrega:
--   • stock_anterior / stock_nuevo: la foto del stock justo antes y
--     justo después de ese movimiento puntual.
--   • motivo: texto libre ("Ingreso de stock", "Entrega a Juan Pérez",
--     "Precio actualizado: S/80.00 → S/95.00", etc.)
--   • Permite un tercer tipo de movimiento, 'modificacion', para
--     cuando se edita un uniforme (nombre/precio/activo) sin que
--     cambie el stock — así también queda en el historial.
--
-- Los movimientos que ya existían (de antes de esta migración) se
-- quedan sin stock_anterior/stock_nuevo (no se puede reconstruir con
-- certeza hacia atrás) — de ahora en adelante todos los nuevos sí lo
-- van a tener.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.inventario_uniformes_movimientos
  ADD COLUMN IF NOT EXISTS stock_anterior INTEGER NULL,
  ADD COLUMN IF NOT EXISTS stock_nuevo    INTEGER NULL,
  ADD COLUMN IF NOT EXISTS motivo         TEXT NULL;

ALTER TABLE public.inventario_uniformes_movimientos DROP CONSTRAINT IF EXISTS inventario_uniformes_movimientos_tipo_check;
ALTER TABLE public.inventario_uniformes_movimientos
  ADD CONSTRAINT inventario_uniformes_movimientos_tipo_check
  CHECK (tipo IN ('ingreso', 'entrega', 'modificacion'));

-- La entrega ya no solo genera el descuento en Planilla: también deja
-- registrado el stock antes/después y el motivo, en la misma
-- transacción atómica de siempre.
CREATE OR REPLACE FUNCTION public.entregar_uniforme(
  p_uniforme_id UUID,
  p_personal_id UUID,
  p_cantidad    INTEGER,
  p_observacion TEXT,
  p_usuario_id  UUID
) RETURNS UUID AS $$
DECLARE
  v_uniforme     public.inventario_uniformes%ROWTYPE;
  v_concepto_id  UUID;
  v_descuento_id UUID;
  v_monto        NUMERIC;
  v_nombre_pers  TEXT;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_uniforme FROM public.inventario_uniformes WHERE id = p_uniforme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNIFORME_NO_ENCONTRADO'; END IF;
  IF v_uniforme.stock < p_cantidad THEN RAISE EXCEPTION 'STOCK_INSUFICIENTE'; END IF;

  SELECT (nombres || ' ' || apellidos) INTO v_nombre_pers FROM public.personal_tripulantes WHERE id = p_personal_id;
  IF v_nombre_pers IS NULL THEN RAISE EXCEPTION 'PERSONAL_NO_ENCONTRADO'; END IF;

  SELECT id INTO v_concepto_id FROM public.planilla_conceptos_descuento WHERE clave = 'uniforme';

  UPDATE public.inventario_uniformes SET stock = stock - p_cantidad WHERE id = p_uniforme_id;

  v_monto := v_uniforme.precio * p_cantidad;

  INSERT INTO public.planilla_descuentos (personal_id, concepto_id, origen_codigo, importe_original, saldo, observacion, creado_por)
  VALUES (
    p_personal_id, v_concepto_id,
    'Uniforme — ' || v_uniforme.nombre || ' (x' || p_cantidad || ')',
    v_monto, v_monto, p_observacion, p_usuario_id
  )
  RETURNING id INTO v_descuento_id;

  INSERT INTO public.inventario_uniformes_movimientos
    (uniforme_id, tipo, cantidad, personal_id, usuario_id, valor_unitario, valor_total, observacion, descuento_id,
     stock_anterior, stock_nuevo, motivo)
  VALUES (
    p_uniforme_id, 'entrega', p_cantidad, p_personal_id, p_usuario_id, v_uniforme.precio, v_monto, p_observacion, v_descuento_id,
    v_uniforme.stock, v_uniforme.stock - p_cantidad, 'Entrega a ' || v_nombre_pers
  );

  RETURN v_descuento_id;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='inventario_uniformes_movimientos' AND column_name='stock_anterior') AS columnas_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entregar_uniforme') AS funcion_ok;
