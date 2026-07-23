-- ══════════════════════════════════════════════════════════════
-- SERIES_BOLETA_FACTURA_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Hasta ahora cada agencia tenía UNA sola serie/correlativo, usada
-- tanto para boletas como para facturas (por eso salían con la misma
-- serie, ej. ambas "B773"). Esta migración agrega una serie y un
-- correlativo INDEPENDIENTES para facturas, y actualiza la función
-- de venta para que:
--   - Si la venta NO lleva RUC  → usa la serie/correlativo de BOLETA
--     (las columnas que ya existían: serie_boleto / correlativo_actual).
--   - Si la venta SÍ lleva RUC  → usa la nueva serie/correlativo de
--     FACTURA (serie_factura / correlativo_factura).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.agencias
  ADD COLUMN IF NOT EXISTS serie_factura       TEXT    NULL,
  ADD COLUMN IF NOT EXISTS correlativo_factura INTEGER NOT NULL DEFAULT 0;

-- Reemplaza la función de venta atómica para que elija la serie
-- correcta (boleta o factura) según si la venta lleva RUC.
-- El tipo de retorno cambia (se agrega la columna tipo_comprobante),
-- y Postgres no permite que CREATE OR REPLACE cambie el tipo de
-- retorno de una función existente — por eso primero se elimina.
DROP FUNCTION IF EXISTS public.registrar_venta_asiento(
  UUID, INTEGER, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT,
  INTEGER, TEXT, TEXT, TEXT, UUID, UUID, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.registrar_venta_asiento(
  p_programacion_id      UUID,
  p_piso                 INTEGER,
  p_numero_asiento       TEXT,
  p_agencia_id           UUID,
  p_precio               NUMERIC,
  p_metodo_pago          TEXT,
  p_tipo_documento       TEXT,
  p_numero_documento     TEXT,
  p_nombre_completo      TEXT,
  p_edad                 INTEGER,
  p_telefono             TEXT,
  p_ruc                  TEXT,
  p_razon_social         TEXT,
  p_agencia_embarque_id  UUID,
  p_agencia_llegada_id   UUID,
  p_codigo_usado         TEXT,
  p_vendido_por          UUID
) RETURNS TABLE(serie TEXT, correlativo INTEGER, tipo_comprobante TEXT) AS $$
DECLARE
  v_boleto_id     UUID;
  v_correlativo   INTEGER;
  v_serie         TEXT;
  v_es_factura    BOOLEAN;
  v_tipo_comprobante TEXT;
BEGIN
  v_es_factura := (p_ruc IS NOT NULL AND btrim(p_ruc) <> '');
  v_tipo_comprobante := CASE WHEN v_es_factura THEN 'factura' ELSE 'boleta' END;

  -- Bloquea (si existe) el registro de este asiento en este viaje,
  -- para que dos ventas simultáneas del mismo asiento no se pisen.
  SELECT id, boletos.correlativo, boletos.serie
    INTO v_boleto_id, v_correlativo, v_serie
    FROM public.boletos
    WHERE programacion_id = p_programacion_id
      AND piso = p_piso
      AND numero_asiento = p_numero_asiento
    FOR UPDATE;

  IF v_boleto_id IS NOT NULL AND v_correlativo IS NOT NULL THEN
    -- Ya tenía número de boleto/factura (venta previa): se actualizan
    -- los datos y se CONSERVA la misma serie/correlativo — nunca se
    -- genera otro, ni siquiera si ahora cambia entre boleta y factura
    -- (para eso debe anularse y venderse de nuevo el asiento).
    UPDATE public.boletos SET
      estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
      tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
      nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
      ruc = p_ruc, razon_social = p_razon_social,
      agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
      codigo_usado = p_codigo_usado, vendido_por = p_vendido_por, actualizado_en = NOW()
    WHERE id = v_boleto_id;
  ELSE
    -- No tenía número todavía: bloquea la fila de la agencia y genera
    -- el siguiente correlativo de la serie que corresponda (boleta o
    -- factura) de forma atómica.
    IF v_es_factura THEN
      UPDATE public.agencias
        SET correlativo_factura = COALESCE(correlativo_factura, 0) + 1
        WHERE id = p_agencia_id
        RETURNING agencias.serie_factura, agencias.correlativo_factura
        INTO v_serie, v_correlativo;
    ELSE
      UPDATE public.agencias
        SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1
        WHERE id = p_agencia_id
        RETURNING agencias.serie_boleto, agencias.correlativo_actual
        INTO v_serie, v_correlativo;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AGENCIA_NO_ENCONTRADA';
    END IF;
    IF v_serie IS NULL THEN
      RAISE EXCEPTION '%', CASE WHEN v_es_factura THEN 'AGENCIA_SIN_SERIE_FACTURA' ELSE 'AGENCIA_SIN_SERIE' END;
    END IF;

    IF v_boleto_id IS NOT NULL THEN
      -- Existía (reservado/postergado/anulado) pero sin número: se le asigna ahora
      UPDATE public.boletos SET
        estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
        serie = v_serie, correlativo = v_correlativo,
        tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
        nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
        ruc = p_ruc, razon_social = p_razon_social,
        agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
        codigo_usado = p_codigo_usado, vendido_por = p_vendido_por, actualizado_en = NOW()
      WHERE id = v_boleto_id;
    ELSE
      -- No existía ningún registro: se crea directamente con su número
      INSERT INTO public.boletos (
        programacion_id, piso, numero_asiento, estado, precio, metodo_pago,
        serie, correlativo, tipo_documento, numero_documento, nombre_completo,
        edad, telefono, ruc, razon_social, agencia_embarque_id, agencia_llegada_id,
        codigo_usado, vendido_por, creado_en, actualizado_en
      ) VALUES (
        p_programacion_id, p_piso, p_numero_asiento, 'vendido', p_precio, p_metodo_pago,
        v_serie, v_correlativo, p_tipo_documento, p_numero_documento, p_nombre_completo,
        p_edad, p_telefono, p_ruc, p_razon_social, p_agencia_embarque_id, p_agencia_llegada_id,
        p_codigo_usado, p_vendido_por, NOW(), NOW()
      );
    END IF;
  END IF;

  RETURN QUERY SELECT v_serie, v_correlativo, v_tipo_comprobante;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

SELECT id, nombre, serie_boleto, correlativo_actual, serie_factura, correlativo_factura
FROM public.agencias ORDER BY creado_en;
