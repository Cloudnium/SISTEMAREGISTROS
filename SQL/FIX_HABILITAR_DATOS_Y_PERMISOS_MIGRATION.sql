-- ══════════════════════════════════════════════════════════════
-- FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: SERIES_DOBLE_HISTORIAL_MIGRATION.sql ya ejecutado.
--
-- Resuelve:
--   1. Al Habilitar un boleto que pertenece a otro (misma empresa u
--      otra), ahora SÍ copia todos los datos del pasajero original:
--      nombre, documento, edad, teléfono, RUC/razón social, agencia
--      de embarque y agencia de llegada — antes solo se guardaba lo
--      que hubiera escrito en el formulario (normalmente vacío).
--   2. Nuevo permiso "Puede usar Reintegro" por usuario.
-- ══════════════════════════════════════════════════════════════

-- 1) Permiso de Reintegro -------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_reintegro BOOLEAN NOT NULL DEFAULT true;

-- 2) activar_boleto_manual: copia los datos del pasajero del boleto
--    original cuando lo encuentra (sea de la misma empresa o de otra) --
CREATE OR REPLACE FUNCTION public.activar_boleto_manual(
  p_programacion_id      UUID,
  p_piso                 INTEGER,
  p_numero_asiento       TEXT,
  p_agencia_id           UUID,
  p_empresa_id           UUID,
  p_serie_manual         TEXT,
  p_correlativo_manual   INTEGER,
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
  p_vendido_por          UUID
) RETURNS TABLE(serie TEXT, correlativo INTEGER, transferido BOOLEAN) AS $$
DECLARE
  v_destino_id     UUID;
  v_destino_existe BOOLEAN := false;
  v_origen         public.boletos%ROWTYPE;
  v_serie_final    TEXT;
  v_correlativo_final INTEGER;
  v_es_factura     BOOLEAN;
  v_transferido    BOOLEAN := false;
  v_boleto_activo  SMALLINT;
  -- Datos finales del pasajero a guardar en el asiento destino: por
  -- defecto lo que venga del formulario, pero si se encuentra un
  -- boleto original (misma empresa u otra), se sobrescriben con SUS
  -- datos — es el sentido de "activar" ese boleto puntual.
  v_tipo_documento    TEXT    := p_tipo_documento;
  v_numero_documento  TEXT    := p_numero_documento;
  v_nombre_completo   TEXT    := p_nombre_completo;
  v_edad              INTEGER := p_edad;
  v_telefono          TEXT    := p_telefono;
  v_ruc               TEXT    := p_ruc;
  v_razon_social      TEXT    := p_razon_social;
  v_agencia_embarque_id UUID  := p_agencia_embarque_id;
  v_agencia_llegada_id  UUID  := p_agencia_llegada_id;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'BUS_SIN_EMPRESA';
  END IF;
  p_serie_manual := upper(btrim(p_serie_manual));

  SELECT id INTO v_destino_id
    FROM public.boletos
    WHERE programacion_id = p_programacion_id AND piso = p_piso AND numero_asiento = p_numero_asiento
    FOR UPDATE;
  IF v_destino_id IS NULL THEN
    v_destino_id := gen_random_uuid();
  ELSE
    v_destino_existe := true;
  END IF;

  SELECT * INTO v_origen
    FROM public.boletos
    WHERE public.boletos.serie = p_serie_manual AND public.boletos.correlativo = p_correlativo_manual
    FOR UPDATE;

  IF NOT FOUND THEN
    v_serie_final := p_serie_manual;
    v_correlativo_final := p_correlativo_manual;
    v_transferido := false;

  ELSIF v_origen.id = v_destino_id THEN
    v_serie_final := p_serie_manual;
    v_correlativo_final := p_correlativo_manual;
    v_transferido := false;

  ELSE
    IF v_origen.estado NOT IN ('postergado', 'reservado') THEN
      RAISE EXCEPTION 'BOLETO_ORIGEN_NO_DISPONIBLE';
    END IF;

    -- Se encontró el boleto original: se activa CON SUS DATOS
    -- (nombre, documento, edad, teléfono, facturación, agencias de
    -- embarque/llegada), no con lo que hubiera en el formulario.
    v_tipo_documento      := v_origen.tipo_documento;
    v_numero_documento    := v_origen.numero_documento;
    v_nombre_completo     := v_origen.nombre_completo;
    v_edad                := v_origen.edad;
    v_telefono            := v_origen.telefono;
    v_ruc                 := v_origen.ruc;
    v_razon_social        := v_origen.razon_social;
    v_agencia_embarque_id := v_origen.agencia_embarque_id;
    v_agencia_llegada_id  := v_origen.agencia_llegada_id;

    IF v_origen.empresa_id IS NULL OR v_origen.empresa_id = p_empresa_id THEN
      v_serie_final := p_serie_manual;
      v_correlativo_final := p_correlativo_manual;
      v_transferido := false;

      UPDATE public.boletos SET estado = 'usado', activado_desde_boleto_id = NULL, actualizado_en = NOW()
        WHERE id = v_origen.id;
    ELSE
      v_transferido := true;
      v_es_factura := (v_origen.ruc IS NOT NULL AND btrim(v_origen.ruc) <> '');

      IF NOT EXISTS (SELECT 1 FROM public.series_agencia_empresa WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id) THEN
        INSERT INTO public.series_agencia_empresa (agencia_id, empresa_id) VALUES (p_agencia_id, p_empresa_id)
        ON CONFLICT (agencia_id, empresa_id) DO NOTHING;
      END IF;

      IF v_es_factura THEN
        UPDATE public.series_agencia_empresa
          SET correlativo_factura = COALESCE(correlativo_factura, 0) + 1, actualizado_en = NOW()
          WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
          RETURNING serie_factura, correlativo_factura INTO v_serie_final, v_correlativo_final;
      ELSE
        SELECT serie_boleto_activa INTO v_boleto_activo
          FROM public.series_agencia_empresa
          WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
          FOR UPDATE;

        IF v_boleto_activo = 2 THEN
          UPDATE public.series_agencia_empresa
            SET correlativo_boleto_2 = COALESCE(correlativo_boleto_2, 0) + 1, actualizado_en = NOW()
            WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
            RETURNING serie_boleto_2, correlativo_boleto_2 INTO v_serie_final, v_correlativo_final;
        ELSE
          UPDATE public.series_agencia_empresa
            SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1, actualizado_en = NOW()
            WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
            RETURNING serie_boleto, correlativo_actual INTO v_serie_final, v_correlativo_final;
        END IF;
      END IF;
      IF v_serie_final IS NULL THEN
        RAISE EXCEPTION '%', CASE WHEN v_es_factura THEN 'AGENCIA_SIN_SERIE_FACTURA' ELSE 'AGENCIA_SIN_SERIE' END;
      END IF;

      IF v_origen.codigo_usado IS NOT NULL THEN
        UPDATE public.codigos_autorizacion
          SET usado_en_boleto_id = v_destino_id
          WHERE codigo = v_origen.codigo_usado AND usado_en_boleto_id = v_origen.id;
      END IF;

      UPDATE public.boletos SET estado = 'usado', activado_desde_boleto_id = NULL, actualizado_en = NOW()
        WHERE id = v_origen.id;
    END IF;
  END IF;

  IF v_destino_existe THEN
    UPDATE public.boletos SET
      estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
      serie = v_serie_final, correlativo = v_correlativo_final,
      tipo_documento = v_tipo_documento, numero_documento = v_numero_documento,
      nombre_completo = v_nombre_completo, edad = v_edad, telefono = v_telefono,
      ruc = v_ruc, razon_social = v_razon_social,
      agencia_embarque_id = v_agencia_embarque_id, agencia_llegada_id = v_agencia_llegada_id,
      codigo_usado = CASE WHEN v_transferido THEN v_origen.codigo_usado ELSE codigo_usado END,
      vendido_por = p_vendido_por, empresa_id = p_empresa_id,
      activado_desde_boleto_id = CASE WHEN v_transferido THEN v_origen.id ELSE NULL END,
      transferido_otra_empresa = v_transferido,
      actualizado_en = NOW()
    WHERE id = v_destino_id;
  ELSE
    INSERT INTO public.boletos (
      id, programacion_id, piso, numero_asiento, estado, precio, metodo_pago,
      serie, correlativo, tipo_documento, numero_documento, nombre_completo,
      edad, telefono, ruc, razon_social, agencia_embarque_id, agencia_llegada_id,
      codigo_usado, vendido_por, empresa_id, activado_desde_boleto_id, transferido_otra_empresa,
      creado_en, actualizado_en
    ) VALUES (
      v_destino_id, p_programacion_id, p_piso, p_numero_asiento, 'vendido', p_precio, p_metodo_pago,
      v_serie_final, v_correlativo_final, v_tipo_documento, v_numero_documento, v_nombre_completo,
      v_edad, v_telefono, v_ruc, v_razon_social, v_agencia_embarque_id, v_agencia_llegada_id,
      CASE WHEN v_transferido THEN v_origen.codigo_usado ELSE NULL END,
      p_vendido_por, p_empresa_id, CASE WHEN v_transferido THEN v_origen.id ELSE NULL END, v_transferido,
      NOW(), NOW()
    );
  END IF;

  RETURN QUERY SELECT v_serie_final, v_correlativo_final, v_transferido;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
