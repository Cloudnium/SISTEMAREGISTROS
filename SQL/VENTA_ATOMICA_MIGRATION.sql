-- ══════════════════════════════════════════════════════════════
-- VENTA_ATOMICA_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Corrige de raíz el problema de boletos emitidos sin serie/correlativo
-- y garantiza que NUNCA puedan existir series/correlativos duplicados,
-- incluso si dos usuarios venden al mismo tiempo.
--
-- Antes: el backend hacía "SELECT si existe" → "RPC para el siguiente
-- correlativo" → "INSERT o UPDATE" en 3 pasos separados. Si algo fallaba
-- (o dos ventas coincidían) a mitad de camino, podía quedar el boleto
-- guardado SIN serie.
--
-- Ahora: TODO ese proceso ocurre en una sola función de base de datos
-- (una sola transacción atómica). O se completa todo correctamente
-- (boleto + serie + correlativo), o no se guarda nada.
-- ══════════════════════════════════════════════════════════════

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
) RETURNS TABLE(serie TEXT, correlativo INTEGER) AS $$
DECLARE
  v_boleto_id     UUID;
  v_correlativo   INTEGER;
  v_serie         TEXT;
BEGIN
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
    -- Ya tenía número de boleto (venta previa): se actualizan los datos
    -- y se CONSERVA la misma serie/correlativo, nunca se genera otro.
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
    -- el siguiente correlativo de forma atómica (nadie más puede tomar
    -- el mismo número mientras esta transacción no termine).
    UPDATE public.agencias
      SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1
      WHERE id = p_agencia_id
      RETURNING agencias.serie_boleto, agencias.correlativo_actual
      INTO v_serie, v_correlativo;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AGENCIA_NO_ENCONTRADA';
    END IF;
    IF v_serie IS NULL THEN
      RAISE EXCEPTION 'AGENCIA_SIN_SERIE';
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

  RETURN QUERY SELECT v_serie, v_correlativo;
END;
$$ LANGUAGE plpgsql;

-- IMPORTANTE: PostgREST (la capa que usa Supabase para exponer la BD
-- como API) mantiene en caché la lista de funciones disponibles. Si no
-- se le avisa, puede tardar en darse cuenta de que esta función nueva
-- existe y responder "Could not find the function... in the schema
-- cache" aunque la función ya esté creada. Esta línea fuerza la
-- recarga inmediata de ese caché.
NOTIFY pgrst, 'reload schema';

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'registrar_venta_asiento';
