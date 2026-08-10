-- ══════════════════════════════════════════════════════════════
-- SERIES_DOBLE_HISTORIAL_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: MULTIEMPRESA_SERIES_MIGRATION.sql ya ejecutado.
--
-- Resuelve:
--   1. BUG: "column reference serie is ambiguous" al Habilitar —
--      activar_boleto_manual() comparaba "serie"/"correlativo" sin
--      indicar la tabla, y esos mismos nombres son columnas de salida
--      de la función (RETURNS TABLE(serie, correlativo, ...)).
--   2. Historial de movimientos por boleto (venta, reserva,
--      postergación, anulación, habilitación, transferencia entre
--      empresas) — vía un trigger que registra CADA cambio de estado,
--      sin importar por qué camino del código haya pasado.
--   3. Segunda serie de boletos por agencia+empresa (Boleto 1 /
--      Boleto 2), con un selector de cuál está activa. Las facturas
--      siguen usando una sola serie (no se duplican).
--   4. Un mismo número de serie+correlativo no puede repetirse en
--      todo el sistema (necesario para que "Consulta de Documentos"
--      y "Habilitar" lo puedan ubicar sin ambigüedad).
-- ══════════════════════════════════════════════════════════════

-- 1) Segunda serie de boletos + selector de cuál está activa --------
ALTER TABLE public.series_agencia_empresa
  ADD COLUMN IF NOT EXISTS serie_boleto_2        TEXT    NULL,
  ADD COLUMN IF NOT EXISTS correlativo_boleto_2   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS serie_boleto_activa    SMALLINT NOT NULL DEFAULT 1
    CHECK (serie_boleto_activa IN (1, 2));

-- 2) Un mismo serie+correlativo no puede repetirse en todo el sistema
--    (permite ubicar un boleto sin ambigüedad en Consulta de
--    Documentos y en Habilitar). Si ya tuvieras datos duplicados de
--    antes, este CREATE fallará avisándote cuáles son — corrígelos y
--    vuelve a correr la migración.
CREATE UNIQUE INDEX IF NOT EXISTS idx_boletos_serie_correlativo_unico
  ON public.boletos (serie, correlativo) WHERE serie IS NOT NULL;

-- 3) Historial de movimientos de cada boleto -------------------------
CREATE TABLE IF NOT EXISTS public.boletos_movimientos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boleto_id     UUID        NOT NULL REFERENCES public.boletos(id) ON DELETE CASCADE,
  tipo          TEXT        NOT NULL,
  descripcion   TEXT        NOT NULL,
  usuario_id    UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  serie         TEXT        NULL,
  correlativo   INTEGER     NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boletos_movimientos_boleto ON public.boletos_movimientos(boleto_id);
ALTER TABLE public.boletos_movimientos DISABLE ROW LEVEL SECURITY;

-- Registra automáticamente un movimiento cada vez que un boleto se
-- crea o cambia de estado — sin importar si vino de
-- registrar_venta_asiento, activar_boleto_manual, o de un UPDATE
-- directo (anular/reservar/postergar en routes/boletaje.js).
CREATE OR REPLACE FUNCTION public.registrar_movimiento_boleto()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo    TEXT;
  v_usuario UUID;
  v_desc    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    -- Se actualizó el boleto pero sin cambiar de estado (p.ej. se
    -- corrigió el teléfono) — no cuenta como un "movimiento".
    RETURN NEW;
  END IF;

  v_usuario := COALESCE(NEW.vendido_por, NEW.anulado_por);

  v_tipo := CASE
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

DROP TRIGGER IF EXISTS trg_registrar_movimiento_boleto ON public.boletos;
CREATE TRIGGER trg_registrar_movimiento_boleto
  AFTER INSERT OR UPDATE ON public.boletos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_movimiento_boleto();

-- Trae al historial todos los boletos que ya existían antes de esta
-- migración (un único movimiento con su estado actual, para que no
-- aparezcan sin ningún registro en Consulta de Documentos).
INSERT INTO public.boletos_movimientos (boleto_id, tipo, descripcion, usuario_id, serie, correlativo, creado_en)
SELECT b.id, 'venta', 'REGISTRO PREVIO A HISTORIAL — ' || UPPER(b.estado) || '/', b.vendido_por, b.serie, b.correlativo, COALESCE(b.creado_en, NOW())
FROM public.boletos b
WHERE NOT EXISTS (SELECT 1 FROM public.boletos_movimientos m WHERE m.boleto_id = b.id);

-- Función auxiliar: trae los movimientos de un boleto Y de toda la
-- cadena de boletos de los que proviene (si fue activado/transferido
-- desde otro, y ese a su vez desde otro, etc.), ordenados por fecha.
CREATE OR REPLACE FUNCTION public.obtener_movimientos_boleto(p_boleto_id UUID)
RETURNS TABLE(boleto_id UUID, tipo TEXT, descripcion TEXT, usuario_id UUID, serie TEXT, correlativo INTEGER, creado_en TIMESTAMPTZ) AS $$
  WITH RECURSIVE cadena AS (
    SELECT id, activado_desde_boleto_id FROM public.boletos WHERE id = p_boleto_id
    UNION ALL
    SELECT b.id, b.activado_desde_boleto_id
    FROM public.boletos b JOIN cadena c ON b.id = c.activado_desde_boleto_id
  )
  SELECT m.boleto_id, m.tipo, m.descripcion, m.usuario_id, m.serie, m.correlativo, m.creado_en
  FROM public.boletos_movimientos m
  JOIN cadena c ON m.boleto_id = c.id
  ORDER BY m.creado_en ASC;
$$ LANGUAGE sql STABLE;

-- 4) Reemplaza registrar_venta_asiento: usa Boleto 1 o Boleto 2 según
--    cuál esté activa para esa agencia+empresa (las facturas no se
--    duplican, usan siempre su misma serie) ------------------------
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

  SELECT id, boletos.correlativo, boletos.serie, boletos.codigo_usado
    INTO v_boleto_id, v_correlativo, v_serie, v_codigo_anterior
    FROM public.boletos
    WHERE programacion_id = p_programacion_id
      AND piso = p_piso
      AND numero_asiento = p_numero_asiento
    FOR UPDATE;

  IF v_boleto_id IS NULL THEN
    v_boleto_id := gen_random_uuid();
    v_es_nuevo  := true;
  END IF;

  -- ── Código de autorización: uso único por boleto emitido ──
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
    -- Bloquea/crea la fila de series de esta AGENCIA + EMPRESA
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

-- 5) Reemplaza activar_boleto_manual: corrige el bug de columna
--    ambigua (ahora todo referencia public.boletos.serie /
--    public.boletos.correlativo explícitamente) y agrega el soporte
--    de Boleto 1 / Boleto 2 en la rama de transferencia entre
--    empresas -------------------------------------------------------
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
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'BUS_SIN_EMPRESA';
  END IF;
  p_serie_manual := upper(btrim(p_serie_manual));

  -- Bloquea (si existe) el asiento DESTINO
  SELECT id INTO v_destino_id
    FROM public.boletos
    WHERE programacion_id = p_programacion_id AND piso = p_piso AND numero_asiento = p_numero_asiento
    FOR UPDATE;
  IF v_destino_id IS NULL THEN
    v_destino_id := gen_random_uuid();
  ELSE
    v_destino_existe := true;
  END IF;

  -- Busca en TODO el sistema un boleto con esa serie/correlativo (el "original")
  -- (se indican los nombres de columna con "public.boletos." para no
  -- confundirlos con "serie"/"correlativo", que son también los
  -- nombres de las columnas de retorno de esta función)
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
      tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
      nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
      ruc = p_ruc, razon_social = p_razon_social,
      agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
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
      v_serie_final, v_correlativo_final, p_tipo_documento, p_numero_documento, p_nombre_completo,
      p_edad, p_telefono, p_ruc, p_razon_social, p_agencia_embarque_id, p_agencia_llegada_id,
      CASE WHEN v_transferido THEN v_origen.codigo_usado ELSE NULL END,
      p_vendido_por, p_empresa_id, CASE WHEN v_transferido THEN v_origen.id ELSE NULL END, v_transferido,
      NOW(), NOW()
    );
  END IF;

  RETURN QUERY SELECT v_serie_final, v_correlativo_final, v_transferido;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'series_agencia_empresa'
  AND column_name IN ('serie_boleto_2','correlativo_boleto_2','serie_boleto_activa');
