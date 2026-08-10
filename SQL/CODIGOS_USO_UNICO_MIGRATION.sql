-- ══════════════════════════════════════════════════════════════
-- CODIGOS_USO_UNICO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: CODIGOS_AUTORIZACION_SETUP.sql y SERIES_BOLETA_FACTURA_MIGRATION.sql
-- ya ejecutados (reemplaza la función registrar_venta_asiento definida ahí).
--
-- Hasta ahora, un código de autorización podía usarse en CUALQUIER
-- cantidad de boletos: la columna boletos.codigo_usado solo guardaba
-- el texto como referencia, sin validar ni bloquear nada.
--
-- Esta migración impone que cada código solo pueda usarse UNA vez:
--   1. Agrega a codigos_autorizacion las columnas "usado",
--      "usado_en" y "usado_en_boleto_id" (qué boleto lo consumió).
--   2. Reescribe registrar_venta_asiento para que, dentro de la
--      MISMA transacción atómica de la venta:
--        - bloquee (FOR UPDATE) la fila del código,
--        - rechace la venta si el código no existe, está inactivo
--          o ya fue usado (RAISE EXCEPTION),
--        - y si todo está bien, lo marque como usado por ESE boleto.
--      Así se evita que dos ventas simultáneas alcancen a usar el
--      mismo código (condición de carrera).
--   3. Si el boleto que usó un código se ANULA o se le cambia el
--      código a otro, libera automáticamente el código anterior
--      para que pueda volver a usarse (un boleto anulado no debe
--      dejar "quemado" un código que nunca llegó a viajar).
-- ══════════════════════════════════════════════════════════════

-- 1) Columnas de control de uso único ---------------------------
ALTER TABLE public.codigos_autorizacion
  ADD COLUMN IF NOT EXISTS usado              BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usado_en           TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS usado_en_boleto_id UUID        NULL REFERENCES public.boletos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_codigos_autorizacion_usado ON public.codigos_autorizacion(usado);

-- Por si ya había códigos usados en ventas previas a esta migración:
-- los marca como "usado" según el último boleto vendido (no anulado)
-- que los tenga registrados en codigo_usado, para no dejar huecos.
UPDATE public.codigos_autorizacion ca
SET usado = true,
    usado_en = b.actualizado_en,
    usado_en_boleto_id = b.id
FROM public.boletos b
WHERE b.codigo_usado = ca.codigo
  AND b.estado = 'vendido'
  AND ca.usado = false;

-- 2) Reemplaza la función de venta atómica -----------------------
-- Se elimina primero porque cambia la lógica interna (no el tipo de
-- retorno, que sigue siendo el mismo de SERIES_BOLETA_FACTURA_MIGRATION).
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
  v_es_factura := (p_ruc IS NOT NULL AND btrim(p_ruc) <> '');
  v_tipo_comprobante := CASE WHEN v_es_factura THEN 'factura' ELSE 'boleta' END;
  v_codigo_normalizado := NULLIF(btrim(upper(COALESCE(p_codigo_usado, ''))), '');

  -- Bloquea (si existe) el registro de este asiento en este viaje,
  -- para que dos ventas simultáneas del mismo asiento no se pisen.
  SELECT id, boletos.correlativo, boletos.serie, boletos.codigo_usado
    INTO v_boleto_id, v_correlativo, v_serie, v_codigo_anterior
    FROM public.boletos
    WHERE programacion_id = p_programacion_id
      AND piso = p_piso
      AND numero_asiento = p_numero_asiento
    FOR UPDATE;

  -- Si el asiento todavía no tiene ningún registro, se genera desde
  -- ya el id que tendrá el boleto — así podemos dejar marcado el
  -- código de autorización como usado por ESTE boleto ANTES de
  -- insertarlo (todo dentro de la misma transacción atómica).
  IF v_boleto_id IS NULL THEN
    v_boleto_id := gen_random_uuid();
    v_es_nuevo  := true;
  END IF;

  -- ── Código de autorización: uso único por boleto emitido ──
  IF v_codigo_normalizado IS DISTINCT FROM v_codigo_anterior THEN

    -- Libera el código que este boleto tenía antes (si tenía uno),
    -- para que quede disponible de nuevo — p.ej. si se corrige la
    -- venta y se cambia el código, o se quita.
    IF v_codigo_anterior IS NOT NULL THEN
      UPDATE public.codigos_autorizacion
        SET usado = false, usado_en = NULL, usado_en_boleto_id = NULL
        WHERE codigo = v_codigo_anterior
          AND usado_en_boleto_id = v_boleto_id;
    END IF;

    -- Valida y reserva el nuevo código, si se indicó uno.
    IF v_codigo_normalizado IS NOT NULL THEN
      SELECT * INTO v_codigo_row
        FROM public.codigos_autorizacion
        WHERE codigo = v_codigo_normalizado
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CODIGO_INVALIDO';
      END IF;
      IF v_codigo_row.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'CODIGO_INACTIVO';
      END IF;
      IF v_codigo_row.usado IS TRUE THEN
        RAISE EXCEPTION 'CODIGO_YA_USADO';
      END IF;

      UPDATE public.codigos_autorizacion
        SET usado = true, usado_en = NOW(), usado_en_boleto_id = v_boleto_id
        WHERE codigo = v_codigo_normalizado;
    END IF;
  END IF;

  IF (NOT v_es_nuevo) AND v_correlativo IS NOT NULL THEN
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
      codigo_usado = v_codigo_normalizado, vendido_por = p_vendido_por, actualizado_en = NOW()
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

    IF v_es_nuevo THEN
      -- No existía ningún registro: se crea directamente con su
      -- número, usando el id ya reservado más arriba.
      INSERT INTO public.boletos (
        id, programacion_id, piso, numero_asiento, estado, precio, metodo_pago,
        serie, correlativo, tipo_documento, numero_documento, nombre_completo,
        edad, telefono, ruc, razon_social, agencia_embarque_id, agencia_llegada_id,
        codigo_usado, vendido_por, creado_en, actualizado_en
      ) VALUES (
        v_boleto_id, p_programacion_id, p_piso, p_numero_asiento, 'vendido', p_precio, p_metodo_pago,
        v_serie, v_correlativo, p_tipo_documento, p_numero_documento, p_nombre_completo,
        p_edad, p_telefono, p_ruc, p_razon_social, p_agencia_embarque_id, p_agencia_llegada_id,
        v_codigo_normalizado, p_vendido_por, NOW(), NOW()
      );
    ELSE
      -- Existía (reservado/postergado/anulado) pero sin número: se le asigna ahora
      UPDATE public.boletos SET
        estado = 'vendido', precio = p_precio, metodo_pago = p_metodo_pago,
        serie = v_serie, correlativo = v_correlativo,
        tipo_documento = p_tipo_documento, numero_documento = p_numero_documento,
        nombre_completo = p_nombre_completo, edad = p_edad, telefono = p_telefono,
        ruc = p_ruc, razon_social = p_razon_social,
        agencia_embarque_id = p_agencia_embarque_id, agencia_llegada_id = p_agencia_llegada_id,
        codigo_usado = v_codigo_normalizado, vendido_por = p_vendido_por, actualizado_en = NOW()
      WHERE id = v_boleto_id;
    END IF;
  END IF;

  RETURN QUERY SELECT v_serie, v_correlativo, v_tipo_comprobante;
END;
$$ LANGUAGE plpgsql;

-- 3) Libera automáticamente el código de un boleto que se ANULA ---
-- (fuera de la venta atómica: anular/reservar/postergar/habilitar se
-- manejan aparte en el backend con UPDATE directo a la tabla).
CREATE OR REPLACE FUNCTION public.liberar_codigo_si_boleto_anulado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'anulado' AND OLD.codigo_usado IS NOT NULL THEN
    UPDATE public.codigos_autorizacion
      SET usado = false, usado_en = NULL, usado_en_boleto_id = NULL
      WHERE codigo = OLD.codigo_usado
        AND usado_en_boleto_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_liberar_codigo_si_boleto_anulado ON public.boletos;
CREATE TRIGGER trg_liberar_codigo_si_boleto_anulado
  AFTER UPDATE ON public.boletos
  FOR EACH ROW
  WHEN (NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado')
  EXECUTE FUNCTION public.liberar_codigo_si_boleto_anulado();

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'codigos_autorizacion'
  AND column_name IN ('usado','usado_en','usado_en_boleto_id');
