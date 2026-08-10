-- ══════════════════════════════════════════════════════════════
-- REINTEGRO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql ya ejecutado.
--
-- Implementa el botón "Reintegro" de Venta de Asientos:
--   1. Reintegro por Variación de Precio (Cambio de Servicio): emite
--      un boleto NUEVO para el boleto original (postergado/reservado),
--      con los MISMOS datos del pasajero, pudiendo cambiar el precio.
--   2. Cambio de Nombre o Pérdida de Boleto: emite un boleto NUEVO,
--      permitiendo cambiar nombre/documento del pasajero y el precio.
--
-- En ambos casos:
--   - Se genera un boleto/factura NUEVO con numeración propia (de la
--     empresa del bus ACTUAL — funciona igual si es la misma empresa
--     o si es de otra empresa distinta a la del boleto original).
--   - El boleto ORIGINAL queda con estado 'usado' (igual que al
--     Habilitar), enlazado (activado_desde_boleto_id) al nuevo.
--   - El boleto NUEVO queda con estado 'reintegro' (no 'vendido'),
--     para poder diferenciarlo en Comprobantes y en el mapa de
--     asientos (que lo pinta de un color distinto — ver el CSS del
--     proyecto, columna .bol-reintegro).
-- ══════════════════════════════════════════════════════════════

-- 1) Nuevo estado 'reintegro' ----------------------------------------
ALTER TABLE public.boletos DROP CONSTRAINT IF EXISTS boletos_estado_check;
ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_estado_check
  CHECK (estado IN ('vendido','reservado','postergado','anulado','usado','reintegro'));

-- 2) El historial de movimientos también debe reconocer 'reintegro' --
CREATE OR REPLACE FUNCTION public.registrar_movimiento_boleto()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo    TEXT;
  v_usuario UUID;
  v_desc    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  v_usuario := COALESCE(NEW.vendido_por, NEW.anulado_por);

  v_tipo := CASE
    WHEN NEW.estado = 'reintegro' THEN 'reintegro'
    WHEN NEW.estado = 'vendido' AND NEW.activado_desde_boleto_id IS NOT NULL THEN 'activacion_transferida'
    WHEN NEW.estado = 'vendido' AND TG_OP = 'INSERT' THEN 'venta'
    WHEN NEW.estado = 'vendido' AND TG_OP = 'UPDATE' AND OLD.estado IN ('reservado','postergado') THEN 'habilitacion'
    WHEN NEW.estado = 'vendido' THEN 'venta'
    WHEN NEW.estado = 'reservado'  THEN 'reserva'
    WHEN NEW.estado = 'postergado' THEN 'postergacion'
    WHEN NEW.estado = 'anulado'    THEN 'anulacion'
    WHEN NEW.estado = 'usado'      THEN 'transferido_a_otro_boleto'
    ELSE NEW.estado
  END;

  v_desc := UPPER(v_tipo) ||
    CASE WHEN NEW.metodo_pago IS NOT NULL THEN '-' || UPPER(NEW.metodo_pago) ELSE '' END ||
    ' ' || to_char(NOW(), 'Mon DD YYYY HH12:MIAM') || '/';

  INSERT INTO public.boletos_movimientos (boleto_id, tipo, descripcion, usuario_id, serie, correlativo, creado_en)
  VALUES (NEW.id, v_tipo, v_desc, v_usuario, NEW.serie, NEW.correlativo, NOW());

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- (el trigger ya existente sigue apuntando a esta misma función, no hace falta recrearlo)

-- 3) Función procesar_reintegro ---------------------------------------
CREATE OR REPLACE FUNCTION public.procesar_reintegro(
  p_programacion_id       UUID,
  p_piso                  INTEGER,
  p_numero_asiento        TEXT,
  p_agencia_id            UUID,
  p_empresa_id            UUID,
  p_serie_original        TEXT,
  p_correlativo_original  INTEGER,
  p_tipo_reintegro        SMALLINT,   -- 1 = variación de precio, 2 = cambio de nombre / pérdida
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

  -- Tipo 1 (variación de precio / cambio de servicio): se conservan
  -- TODOS los datos del pasajero del boleto original.
  -- Tipo 2 (cambio de nombre / pérdida de boleto): se usan los datos
  -- nuevos que llegan del formulario.
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

  -- Traslada el código de autorización del boleto original (si tenía uno)
  IF v_origen.codigo_usado IS NOT NULL THEN
    UPDATE public.codigos_autorizacion
      SET usado_en_boleto_id = v_destino_id
      WHERE codigo = v_origen.codigo_usado AND usado_en_boleto_id = v_origen.id;
  END IF;

  -- El boleto original queda "usado", enlazado al nuevo
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
