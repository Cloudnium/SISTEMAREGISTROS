-- ══════════════════════════════════════════════════════════════
-- MULTIEMPRESA_SERIES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: CODIGOS_USO_UNICO_MIGRATION.sql ya ejecutado.
--
-- Resuelve:
--   1. Las series/correlativos de boletos y facturas dejan de ser
--      SOLO por agencia — ahora son por AGENCIA + EMPRESA (porque
--      cada empresa dueña de buses tiene su propia numeración legal).
--   2. Cada boleto guarda con qué EMPRESA fue emitido (para imprimir
--      su RUC/Razón Social/Domicilio real, y para el logo).
--   3. Las empresas pueden guardar un logo (imagen en base64) para
--      mostrarlo en boletas/facturas.
--   4. Nuevo estado 'usado' para un boleto cuyo número fue trasladado
--      a otro boleto (activación cruzada entre empresas).
--   5. Función activar_boleto_manual(): reemplaza el INSERT/UPDATE
--      manual de "Habilitar" — si la serie/correlativo pertenecen a
--      OTRA empresa, genera un boleto NUEVO con la numeración de la
--      empresa del bus actual y deja el boleto original marcado como
--      'usado', enlazado al nuevo.
-- ══════════════════════════════════════════════════════════════

-- 1) Logo de la empresa (imagen en base64: "data:image/png;base64,...") --
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS logo_data_url TEXT NULL;

-- 2) Series por AGENCIA + EMPRESA --------------------------------
CREATE TABLE IF NOT EXISTS public.series_agencia_empresa (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_id           UUID        NOT NULL REFERENCES public.agencias(id) ON DELETE CASCADE,
  empresa_id           UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  serie_boleto         TEXT        NULL,
  correlativo_actual   INTEGER     NOT NULL DEFAULT 0,
  serie_factura        TEXT        NULL,
  correlativo_factura  INTEGER     NOT NULL DEFAULT 0,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agencia_id, empresa_id)
);
CREATE INDEX IF NOT EXISTS idx_series_agencia_empresa_agencia ON public.series_agencia_empresa(agencia_id);
ALTER TABLE public.series_agencia_empresa DISABLE ROW LEVEL SECURITY;

-- Migra los datos existentes: crea, para cada agencia que ya tenía
-- serie configurada, una fila en la empresa que hoy tiene más buses
-- activos (la mejor suposición posible sin intervención manual) y
-- CONSERVA su serie/correlativo actual para no romper la numeración
-- ya emitida. Además crea filas vacías (correlativo en 0) para el
-- resto de combinaciones agencia×empresa, listas para configurar.
--
-- ⚠️ IMPORTANTE: revisa la pantalla Ciudades y Agencias → "Series"
-- después de correr esto, para confirmar que cada agencia quedó
-- vinculada a la empresa correcta.
WITH empresa_principal_por_agencia AS (
  SELECT DISTINCT ON (a.id)
    a.id AS agencia_id, b.empresa_id
  FROM public.agencias a
  JOIN public.buses b ON b.empresa_id IS NOT NULL AND b.activo = true
  ORDER BY a.id, (SELECT COUNT(*) FROM public.buses b2 WHERE b2.empresa_id = b.empresa_id) DESC
)
INSERT INTO public.series_agencia_empresa (agencia_id, empresa_id, serie_boleto, correlativo_actual, serie_factura, correlativo_factura)
SELECT a.id, epa.empresa_id, a.serie_boleto, COALESCE(a.correlativo_actual, 0), a.serie_factura, COALESCE(a.correlativo_factura, 0)
FROM public.agencias a
JOIN empresa_principal_por_agencia epa ON epa.agencia_id = a.id
ON CONFLICT (agencia_id, empresa_id) DO NOTHING;

-- Filas vacías para el resto de combinaciones (todas las agencias × todas las empresas activas)
INSERT INTO public.series_agencia_empresa (agencia_id, empresa_id)
SELECT a.id, e.id
FROM public.agencias a
CROSS JOIN public.empresas e
WHERE e.activo = true
ON CONFLICT (agencia_id, empresa_id) DO NOTHING;

-- 3) Empresa, transferencias y nuevo estado 'usado' en boletos ----
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS empresa_id                UUID    NULL REFERENCES public.empresas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activado_desde_boleto_id   UUID    NULL REFERENCES public.boletos(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferido_otra_empresa   BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_boletos_empresa ON public.boletos(empresa_id);

ALTER TABLE public.boletos DROP CONSTRAINT IF EXISTS boletos_estado_check;
ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_estado_check
  CHECK (estado IN ('vendido','reservado','postergado','anulado','usado'));

-- Rellena empresa_id de boletos ya vendidos, a partir del bus de su programación
UPDATE public.boletos b
SET empresa_id = bu.empresa_id
FROM public.programaciones p
JOIN public.buses bu ON bu.id = p.bus_id
WHERE b.programacion_id = p.id
  AND b.empresa_id IS NULL
  AND bu.empresa_id IS NOT NULL;

-- 4) Reemplaza registrar_venta_asiento: ahora recibe la empresa del
--    bus y usa la serie de series_agencia_empresa (agencia + empresa) --
DROP FUNCTION IF EXISTS public.registrar_venta_asiento(
  UUID, INTEGER, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT,
  INTEGER, TEXT, TEXT, TEXT, UUID, UUID, TEXT, UUID
);

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
      UPDATE public.series_agencia_empresa
        SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1, actualizado_en = NOW()
        WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
        RETURNING serie_boleto, correlativo_actual INTO v_serie, v_correlativo;
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

-- 5) activar_boleto_manual(): reemplaza el "Habilitar" manual --------
-- Uso:
--  - Si la serie/correlativo indicados NO existen en el sistema →
--    se registran tal cual en el asiento elegido (boleto emitido
--    fuera del sistema), con la empresa del bus actual.
--  - Si SÍ existen y son de la MISMA empresa del bus actual → se
--    reasignan tal cual al asiento elegido (comportamiento anterior).
--  - Si SÍ existen pero son de OTRA empresa → NO se reutiliza ese
--    número: se genera un boleto NUEVO con la numeración propia de
--    la empresa del bus actual, copiando los datos del pasajero, y
--    el boleto ORIGINAL queda con estado 'usado', enlazado
--    (activado_desde_boleto_id) al nuevo.
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
  SELECT * INTO v_origen
    FROM public.boletos
    WHERE serie = p_serie_manual AND correlativo = p_correlativo_manual
    FOR UPDATE;

  IF NOT FOUND THEN
    -- No existe: boleto emitido fuera del sistema — se registra tal cual.
    v_serie_final := p_serie_manual;
    v_correlativo_final := p_correlativo_manual;
    v_transferido := false;

  ELSIF v_origen.id = v_destino_id THEN
    -- Es el mismo registro que ya está en este asiento: no hay nada que transferir.
    v_serie_final := p_serie_manual;
    v_correlativo_final := p_correlativo_manual;
    v_transferido := false;

  ELSE
    IF v_origen.estado NOT IN ('postergado', 'reservado') THEN
      RAISE EXCEPTION 'BOLETO_ORIGEN_NO_DISPONIBLE';
    END IF;

    IF v_origen.empresa_id IS NULL OR v_origen.empresa_id = p_empresa_id THEN
      -- Misma empresa (o boleto antiguo sin empresa registrada): se reasigna tal cual.
      v_serie_final := p_serie_manual;
      v_correlativo_final := p_correlativo_manual;
      v_transferido := false;

      UPDATE public.boletos SET estado = 'usado', activado_desde_boleto_id = NULL, actualizado_en = NOW()
        WHERE id = v_origen.id;
    ELSE
      -- Empresa distinta: se genera un boleto NUEVO con la numeración
      -- propia de la empresa del bus actual; el original queda 'usado'.
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
        UPDATE public.series_agencia_empresa
          SET correlativo_actual = COALESCE(correlativo_actual, 0) + 1, actualizado_en = NOW()
          WHERE agencia_id = p_agencia_id AND empresa_id = p_empresa_id
          RETURNING serie_boleto, correlativo_actual INTO v_serie_final, v_correlativo_final;
      END IF;
      IF v_serie_final IS NULL THEN
        RAISE EXCEPTION '%', CASE WHEN v_es_factura THEN 'AGENCIA_SIN_SERIE_FACTURA' ELSE 'AGENCIA_SIN_SERIE' END;
      END IF;

      -- Traslada el código de autorización (si el boleto original tenía uno) al nuevo
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
WHERE table_schema = 'public' AND table_name = 'boletos'
  AND column_name IN ('empresa_id','activado_desde_boleto_id','transferido_otra_empresa');
