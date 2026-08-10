-- ══════════════════════════════════════════════════════════════
-- FIX_POSTERGAR_DESVINCULADO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: REINTEGRO_MIGRATION.sql ya ejecutado.
--
-- Corrige un bug importante: al postergar un asiento, éste debía
-- quedar TOTALMENTE desvinculado del boleto (libre para vender a
-- otra persona con una serie/correlativo NUEVA), pero como solo podía
-- existir UN registro por asiento+viaje, una venta nueva terminaba
-- reescribiendo encima del boleto postergado (le "robaba" su serie y
-- correlativo en vez de generar uno nuevo). Lo mismo podía pasar con
-- asientos anulados/usados.
--
-- Ahora: SOLO puede haber UN boleto "activo" (vendido, reservado o
-- reintegro) por asiento+viaje a la vez — postergado/anulado/usado
-- quedan como historial y ya NO cuentan como el ocupante actual, así
-- que una venta nueva siempre crea un registro NUEVO con su propia
-- serie/correlativo, sin tocar el anterior (que sigue existiendo tal
-- cual, para poder habilitarlo/reintegrarlo después por su serie).
-- ══════════════════════════════════════════════════════════════

-- 1) Reemplaza la restricción de un solo boleto por asiento+viaje por
--    una que solo aplica a los estados "activos" -----------------
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.boletos'::regclass
    AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = 'public.boletos'::regclass
        AND attname IN ('programacion_id', 'piso', 'numero_asiento')
    );
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.boletos DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

DROP INDEX IF EXISTS public.boletos_asiento_activo_unico;
CREATE UNIQUE INDEX boletos_asiento_activo_unico
  ON public.boletos (programacion_id, piso, numero_asiento)
  WHERE estado IN ('vendido', 'reservado', 'reintegro');

-- 2) Las tres funciones que "buscan el boleto de este asiento" deben
--    encontrar SOLO uno activo — si no hay ninguno, se crea uno
--    nuevo (con su propia serie/correlativo), sin tocar lo que haya
--    quedado postergado/anulado/usado en ese mismo asiento --------

-- registrar_venta_asiento (venta normal) -----------------------------
CREATE OR REPLACE FUNCTION public.registrar_venta_asiento(
  p_programacion_id      UUID,
  p_piso                 INTEGER,
  p_numero_asiento       TEXT,
  p_agencia_id           UUID,
  p_empresa_id           UUID,
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
  v_boleto_id        UUID;
  v_correlativo      INTEGER;
  v_serie            TEXT;
  v_es_factura       BOOLEAN;
  v_tipo_comprobante TEXT;
  v_codigo_anterior  TEXT;
  v_codigo_row       public.codigos_autorizacion%ROWTYPE;
  v_es_nuevo         BOOLEAN := false;
  v_codigo_normalizado TEXT;
  v_boleto_activo    SMALLINT;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'BUS_SIN_EMPRESA';
  END IF;

  v_es_factura := (p_ruc IS NOT NULL AND btrim(p_ruc) <> '');
  v_tipo_comprobante := CASE WHEN v_es_factura THEN 'factura' ELSE 'boleta' END;
  v_codigo_normalizado := NULLIF(btrim(upper(COALESCE(p_codigo_usado, ''))), '');

  -- Solo cuenta como "boleto de este asiento" uno ACTIVO (vendido,
  -- reservado o reintegro); uno postergado/anulado/usado no cuenta.
  SELECT id, boletos.correlativo, boletos.serie, boletos.codigo_usado
    INTO v_boleto_id, v_correlativo, v_serie, v_codigo_anterior
    FROM public.boletos
    WHERE programacion_id = p_programacion_id
      AND piso = p_piso
      AND numero_asiento = p_numero_asiento
      AND estado IN ('vendido', 'reservado', 'reintegro')
    FOR UPDATE;

  IF v_boleto_id IS NULL THEN
    v_boleto_id := gen_random_uuid();
    v_es_nuevo  := true;
  END IF;

  IF v_codigo_normalizado IS DISTINCT FROM v_codigo_anterior THEN
    IF v_codigo_anterior IS NOT NULL THEN
      UPDATE public.codigos_autorizacion
        SET usado = false, usado_en = NULL, usado_en_boleto_id = NULL
        WHERE codigo = v_codigo_anterior AND usado_en_boleto_id = v_boleto_id;
    END IF;
    IF v_codigo_normalizado IS NOT NULL THEN
      SELECT * INTO v_codigo_row FROM public.codigos_autorizacion WHERE codigo = v_codigo_normalizado FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CODIGO_INVALIDO'; END IF;
      IF v_codigo_row.activo IS NOT TRUE THEN RAISE EXCEPTION 'CODIGO_INACTIVO'; END IF;
      IF v_codigo_row.usado IS TRUE THEN RAISE EXCEPTION 'CODIGO_YA_USADO'; END IF;
      UPDATE public.codigos_autorizacion
        SET usado = true, usado_en = NOW(), usado_en_boleto_id = v_boleto_id
        WHERE codigo = v_codigo_normalizado;
    END IF;
  END IF;

  IF (NOT v_es_nuevo) AND v_correlativo IS NOT NULL THEN
    UPDATE public.boletos SET
      estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
      tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
      nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
      ruc = p_ruc, razon_social = p_razon_social,
      agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
      codigo_usado = v_codigo_normalizado, vendido_por = p_vendido_por,
      empresa_id = p_empresa_id, actualizado_en = NOW()
    WHERE id = v_boleto_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.series_agencia_empresa WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id) THEN
      INSERT INTO public.series_agencia_empresa (agencia_id, empresa_id) VALUES (p_agencia_id, p_empresa_id)
      ON CONFLICT (agencia_id, empresa_id) DO NOTHING;
    END IF;

    IF v_es_factura THEN
      UPDATE public.series_agencia_empresa
        SET correlativo_factura = COALESCE(correlativo_factura, 0) + 1, actualizado_en = NOW()
        WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
        RETURNING serie_factura, correlativo_factura INTO v_serie, v_correlativo;
    ELSE
      SELECT serie_boleto_activa INTO v_boleto_activo
        FROM public.series_agencia_empresa
        WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
        FOR UPDATE;

      IF v_boleto_activo = 2 THEN
        UPDATE public.series_agencia_empresa
          SET correlativo_boleto_2 = COALESCE(correlativo_boleto_2, 0) + 1, actualizado_en = NOW()
          WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
          RETURNING serie_boleto_2, correlativo_boleto_2 INTO v_serie, v_correlativo;
      ELSE
        UPDATE public.series_agencia_empresa
          SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1, actualizado_en = NOW()
          WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
          RETURNING serie_boleto, correlativo_actual INTO v_serie, v_correlativo;
      END IF;
    END IF;

    IF NOT FOUND THEN RAISE EXCEPTION 'AGENCIA_NO_ENCONTRADA'; END IF;
    IF v_serie IS NULL THEN
      RAISE EXCEPTION '%', CASE WHEN v_es_factura THEN 'AGENCIA_SIN_SERIE_FACTURA' ELSE 'AGENCIA_SIN_SERIE' END;
    END IF;

    IF v_es_nuevo THEN
      INSERT INTO public.boletos (
        id, programacion_id, piso, numero_asiento, estado, precio, metodo_pago,
        serie, correlativo, tipo_documento, numero_documento, nombre_completo,
        edad, telefono, ruc, razon_social, agencia_embarque_id, agencia_llegada_id,
        codigo_usado, vendido_por, empresa_id, creado_en, actualizado_en
      ) VALUES (
        v_boleto_id, p_programacion_id, p_piso, p_numero_asiento, 'vendido', p_precio, p_metodo_pago,
        v_serie, v_correlativo, p_tipo_documento, p_numero_documento, p_nombre_completo,
        p_edad, p_telefono, p_ruc, p_razon_social, p_agencia_embarque_id, p_agencia_llegada_id,
        v_codigo_normalizado, p_vendido_por, p_empresa_id, NOW(), NOW()
      );
    ELSE
      UPDATE public.boletos SET
        estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
        serie = v_serie, correlativo = v_correlativo,
        tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
        nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
        ruc = p_ruc, razon_social = p_razon_social,
        agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
        codigo_usado = v_codigo_normalizado, vendido_por = p_vendido_por,
        empresa_id = p_empresa_id, actualizado_en = NOW()
      WHERE id = v_boleto_id;
    END IF;
  END IF;

  RETURN QUERY SELECT v_serie, v_correlativo, v_tipo_comprobante;
END;
$$ LANGUAGE plpgsql;

-- activar_boleto_manual (Habilitar) — mismo fix en la búsqueda del DESTINO --
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
  v_tipo_documento    TEXT := p_tipo_documento;
  v_numero_documento  TEXT := p_numero_documento;
  v_nombre_completo   TEXT := p_nombre_completo;
  v_edad              INTEGER := p_edad;
  v_telefono          TEXT := p_telefono;
  v_agencia_embarque_id UUID := p_agencia_embarque_id;
  v_agencia_llegada_id  UUID := p_agencia_llegada_id;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'BUS_SIN_EMPRESA';
  END IF;
  p_serie_manual := upper(btrim(p_serie_manual));

  SELECT id INTO v_destino_id
    FROM public.boletos
    WHERE programacion_id = p_programacion_id AND piso = p_piso AND numero_asiento = p_numero_asiento
      AND estado IN ('vendido', 'reservado', 'reintegro')
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

    v_tipo_documento      := v_origen.tipo_documento;
    v_numero_documento    := v_origen.numero_documento;
    v_nombre_completo     := v_origen.nombre_completo;
    v_edad                := v_origen.edad;
    v_telefono            := v_origen.telefono;
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
      ruc = p_ruc, razon_social = p_razon_social,
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
      v_edad, v_telefono, p_ruc, p_razon_social, v_agencia_embarque_id, v_agencia_llegada_id,
      CASE WHEN v_transferido THEN v_origen.codigo_usado ELSE NULL END,
      p_vendido_por, p_empresa_id, CASE WHEN v_transferido THEN v_origen.id ELSE NULL END, v_transferido,
      NOW(), NOW()
    );
  END IF;

  RETURN QUERY SELECT v_serie_final, v_correlativo_final, v_transferido;
END;
$$ LANGUAGE plpgsql;

-- procesar_reintegro — mismo fix en la búsqueda del DESTINO ----------
CREATE OR REPLACE FUNCTION public.procesar_reintegro(
  p_programacion_id       UUID,
  p_piso                  INTEGER,
  p_numero_asiento        TEXT,
  p_agencia_id            UUID,
  p_empresa_id            UUID,
  p_serie_original        TEXT,
  p_correlativo_original  INTEGER,
  p_tipo_reintegro        SMALLINT,
  p_precio                NUMERIC,
  p_metodo_pago           TEXT,
  p_tipo_documento        TEXT,
  p_numero_documento      TEXT,
  p_nombre_completo       TEXT,
  p_edad                  INTEGER,
  p_telefono              TEXT,
  p_ruc                   TEXT,
  p_razon_social          TEXT,
  p_agencia_embarque_id   UUID,
  p_agencia_llegada_id    UUID,
  p_vendido_por           UUID
) RETURNS TABLE(serie TEXT, correlativo INTEGER) AS $$
DECLARE
  v_destino_id        UUID;
  v_destino_existe     BOOLEAN := false;
  v_origen             public.boletos%ROWTYPE;
  v_serie_final        TEXT;
  v_correlativo_final  INTEGER;
  v_es_factura         BOOLEAN;
  v_boleto_activo      SMALLINT;
  v_nombre             TEXT;
  v_edad               INTEGER;
  v_telefono           TEXT;
  v_tipo_documento     TEXT;
  v_numero_documento   TEXT;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'BUS_SIN_EMPRESA';
  END IF;
  IF p_tipo_reintegro NOT IN (1, 2) THEN
    RAISE EXCEPTION 'TIPO_REINTEGRO_INVALIDO';
  END IF;
  p_serie_original := upper(btrim(p_serie_original));

  SELECT id INTO v_destino_id
    FROM public.boletos
    WHERE programacion_id = p_programacion_id AND piso = p_piso AND numero_asiento = p_numero_asiento
      AND estado IN ('vendido', 'reservado', 'reintegro')
    FOR UPDATE;
  IF v_destino_id IS NULL THEN
    v_destino_id := gen_random_uuid();
  ELSE
    v_destino_existe := true;
  END IF;

  SELECT * INTO v_origen
    FROM public.boletos
    WHERE public.boletos.serie = p_serie_original AND public.boletos.correlativo = p_correlativo_original
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOLETO_ORIGEN_NO_ENCONTRADO';
  END IF;
  IF v_origen.id = v_destino_id THEN
    RAISE EXCEPTION 'BOLETO_ORIGEN_IGUAL_AL_DESTINO';
  END IF;
  IF v_origen.estado NOT IN ('postergado', 'reservado') THEN
    RAISE EXCEPTION 'BOLETO_ORIGEN_NO_DISPONIBLE';
  END IF;

  IF p_tipo_reintegro = 1 THEN
    v_nombre           := v_origen.nombre_completo;
    v_edad             := v_origen.edad;
    v_telefono         := v_origen.telefono;
    v_tipo_documento   := v_origen.tipo_documento;
    v_numero_documento := v_origen.numero_documento;
  ELSE
    v_nombre           := p_nombre_completo;
    v_edad             := p_edad;
    v_telefono         := p_telefono;
    v_tipo_documento   := p_tipo_documento;
    v_numero_documento := p_numero_documento;
  END IF;

  v_es_factura := (p_ruc IS NOT NULL AND btrim(p_ruc) <> '');

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

  IF v_destino_existe THEN
    UPDATE public.boletos SET
      estado = 'reintegro', precio = p_precio, metodo_pago = p_metodo_pago,
      serie = v_serie_final, correlativo = v_correlativo_final,
      tipo_documento = v_tipo_documento, numero_documento = v_numero_documento,
      nombre_completo = v_nombre, edad = v_edad, telefono = v_telefono,
      ruc = p_ruc, razon_social = p_razon_social,
      agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
      codigo_usado = v_origen.codigo_usado, vendido_por = p_vendido_por, empresa_id = p_empresa_id,
      activado_desde_boleto_id = v_origen.id,
      transferido_otra_empresa = (v_origen.empresa_id IS DISTINCT FROM p_empresa_id),
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
      v_destino_id, p_programacion_id, p_piso, p_numero_asiento, 'reintegro', p_precio, p_metodo_pago,
      v_serie_final, v_correlativo_final, v_tipo_documento, v_numero_documento, v_nombre,
      v_edad, v_telefono, p_ruc, p_razon_social, p_agencia_embarque_id, p_agencia_llegada_id,
      v_origen.codigo_usado, p_vendido_por, p_empresa_id, v_origen.id,
      (v_origen.empresa_id IS DISTINCT FROM p_empresa_id),
      NOW(), NOW()
    );
  END IF;

  RETURN QUERY SELECT v_serie_final, v_correlativo_final;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
