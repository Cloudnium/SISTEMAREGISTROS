-- ══════════════════════════════════════════════════════════════
-- PLANILLA_DESCUENTOS_SALDO_AUDITORIA_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere ya ejecutados, en este orden:
--   1. PLANILLA_INVENTARIO_DESARROLLADOR_MIGRATION.sql
--   2. PLANILLA_AVANZADA_INVENTARIO_SECCIONES_MIGRATION.sql
--   3. este archivo
--
-- Qué agrega (todo aditivo — no borra nada existente):
--   1. Campo "Área" del trabajador.
--   2. Permiso separado para EDITAR Planilla (RRHH) vs solo
--      CONSULTAR (ver, imprimir, reportes).
--   3. Roster propio por periodo (snapshot al crear el periodo +
--      "agregar trabajador a planilla").
--   4. Bonos ligados a trabajador + periodo (ya no son un pool
--      global).
--   5. Rediseño de Descuentos: catálogo de conceptos, un descuento
--      = una obligación con saldo, y N cobros (parciales o totales)
--      contra planillas distintas. DESCUENTO ≠ COBRO.
--   6. Entrega de uniforme ahora genera un planilla_descuentos (ya
--      no un movimiento plano) — así se puede cobrar en varias
--      planillas con saldo, igual que cualquier otro descuento.
--   7. Vacaciones y Permisos como entidades separadas y completas
--      (permisos con hora, con/sin goce, catálogo de tipos, estados
--      de aprobación).
--   8. Reapertura de periodos cerrados (con motivo obligatorio).
--   9. Auditoría de acciones de Planilla.
--
-- NOTA IMPORTANTE: planilla_movimientos (el modelo plano anterior de
-- "pendiente/cobrado") queda REEMPLAZADO por planilla_bonos +
-- planilla_descuentos + planilla_descuento_cobros. La tabla vieja NO
-- se borra (se conserva su historial), pero el código ya no la usa.
-- Si tenías movimientos pendientes sin cobrar ahí, tendrás que
-- volver a registrarlos como bono/descuento en el nuevo sistema —
-- no se migran automáticamente porque no hay forma segura de saber
-- a qué periodo futuro correspondían.
-- ══════════════════════════════════════════════════════════════

-- 1) Área del trabajador --------------------------------------------------
ALTER TABLE public.personal_tripulantes
  ADD COLUMN IF NOT EXISTS area TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_area ON public.personal_tripulantes(area);

-- 2) Permiso separado: ver vs editar Planilla -----------------------------
-- puede_ver_planilla     → Consulta: ver, buscar, imprimir, reportes.
-- puede_editar_planilla  → Planillas/RR.HH.: todo lo anterior + crear
--                           periodos, bonos, descuentos, cobros,
--                           vacaciones, permisos, cerrar/reabrir.
-- admin/desarrollador siempre tienen acceso total.
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_editar_planilla BOOLEAN NOT NULL DEFAULT false;

-- 3) Periodos: campos para reapertura -------------------------------------
ALTER TABLE public.planilla_periodos
  ADD COLUMN IF NOT EXISTS cerrado_por       UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reabierto_por     UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reabierto_en      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS motivo_reapertura TEXT NULL;

-- 4) Roster propio de cada periodo (snapshot al crear el periodo) --------
CREATE TABLE IF NOT EXISTS public.planilla_periodo_trabajadores (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id           UUID        NOT NULL REFERENCES public.planilla_periodos(id) ON DELETE CASCADE,
  personal_id          UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  -- snapshot histórico — no cambia aunque el trabajador cambie después:
  sueldo_base          NUMERIC     NOT NULL DEFAULT 0,
  cargo                TEXT        NULL,
  area                 TEXT        NULL,
  categoria            TEXT        NULL,
  tipo                 TEXT        NULL,
  agregado_manualmente BOOLEAN     NOT NULL DEFAULT false,
  agregado_por         UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (periodo_id, personal_id)
);
CREATE INDEX IF NOT EXISTS idx_pln_periodo_trab_periodo  ON public.planilla_periodo_trabajadores(periodo_id);
CREATE INDEX IF NOT EXISTS idx_pln_periodo_trab_personal ON public.planilla_periodo_trabajadores(personal_id);
ALTER TABLE public.planilla_periodo_trabajadores DISABLE ROW LEVEL SECURITY;

-- 5) Bonos ligados a trabajador + periodo ---------------------------------
CREATE TABLE IF NOT EXISTS public.planilla_bonos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id  UUID        NOT NULL REFERENCES public.planilla_periodos(id) ON DELETE CASCADE,
  personal_id UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  concepto    TEXT        NOT NULL,               -- ej. "Bono productividad"
  descripcion TEXT        NULL,
  importe     NUMERIC     NOT NULL CHECK (importe > 0),
  fecha       DATE        NOT NULL DEFAULT CURRENT_DATE,
  observacion TEXT        NULL,
  creado_por  UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_bonos_periodo_personal ON public.planilla_bonos(periodo_id, personal_id);
ALTER TABLE public.planilla_bonos DISABLE ROW LEVEL SECURITY;

-- 6) Catálogo de conceptos de descuento ------------------------------------
CREATE TABLE IF NOT EXISTS public.planilla_conceptos_descuento (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clave      TEXT        NOT NULL UNIQUE,
  nombre     TEXT        NOT NULL,
  es_sistema BOOLEAN     NOT NULL DEFAULT false,   -- 'uniforme' lo genera el sistema, no se borra
  activo     BOOLEAN     NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.planilla_conceptos_descuento DISABLE ROW LEVEL SECURITY;

INSERT INTO public.planilla_conceptos_descuento (clave, nombre, es_sistema) VALUES
  ('adelanto',  'Adelanto de sueldo', false),
  ('prestamo',  'Préstamo',           false),
  ('falta',     'Falta',              false),
  ('uniforme',  'Uniforme',           true),
  ('equipo',    'Equipo',             false),
  ('dano',      'Daño',               false),
  ('afp',       'AFP',                false),
  ('onp',       'ONP',                false),
  ('otro',      'Otro',               false)
ON CONFLICT (clave) DO NOTHING;

-- 7) Descuentos: obligación con saldo (DESCUENTO ≠ COBRO) -----------------
CREATE TABLE IF NOT EXISTS public.planilla_descuentos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id      UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  concepto_id      UUID        NOT NULL REFERENCES public.planilla_conceptos_descuento(id),
  origen_codigo    TEXT        NULL,               -- ej. "PRÉSTAMO #001" (autogenerado o libre)
  importe_original NUMERIC     NOT NULL CHECK (importe_original >= 0),
  saldo            NUMERIC     NOT NULL,
  estado           TEXT        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'cancelado')),
  fecha            DATE        NOT NULL DEFAULT CURRENT_DATE,
  observacion      TEXT        NULL,
  creado_por       UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_descuentos_personal ON public.planilla_descuentos(personal_id);
CREATE INDEX IF NOT EXISTS idx_pln_descuentos_estado   ON public.planilla_descuentos(estado);
ALTER TABLE public.planilla_descuentos DISABLE ROW LEVEL SECURITY;

-- 8) Cobros: cuánto de esa obligación se descontó en CADA planilla --------
CREATE TABLE IF NOT EXISTS public.planilla_descuento_cobros (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  descuento_id   UUID        NOT NULL REFERENCES public.planilla_descuentos(id) ON DELETE CASCADE,
  periodo_id     UUID        NOT NULL REFERENCES public.planilla_periodos(id) ON DELETE CASCADE,
  personal_id    UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE, -- denormalizado desde el descuento, para filtrar rápido por trabajador+periodo
  importe        NUMERIC     NOT NULL DEFAULT 0 CHECK (importe >= 0),
  cobrado        BOOLEAN     NOT NULL DEFAULT false,
  creado_por     UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NULL,
  UNIQUE (descuento_id, periodo_id)
);
CREATE INDEX IF NOT EXISTS idx_pln_desc_cobros_descuento ON public.planilla_descuento_cobros(descuento_id);
CREATE INDEX IF NOT EXISTS idx_pln_desc_cobros_periodo   ON public.planilla_descuento_cobros(periodo_id);
CREATE INDEX IF NOT EXISTS idx_pln_desc_cobros_personal_periodo ON public.planilla_descuento_cobros(personal_id, periodo_id);
ALTER TABLE public.planilla_descuento_cobros DISABLE ROW LEVEL SECURITY;

-- Registra (o corrige) el cobro de un descuento en un periodo puntual,
-- de forma atómica: valida que el periodo esté abierto, valida que el
-- importe no exceda el saldo disponible, guarda/actualiza el cobro y
-- recalcula el saldo del descuento a partir de TODO su historial.
CREATE OR REPLACE FUNCTION public.planilla_registrar_cobro(
  p_descuento_id UUID,
  p_periodo_id   UUID,
  p_importe      NUMERIC,
  p_cobrado      BOOLEAN,
  p_usuario_id   UUID
) RETURNS NUMERIC AS $$
DECLARE
  v_descuento       public.planilla_descuentos%ROWTYPE;
  v_periodo_estado  TEXT;
  v_cobro_anterior  NUMERIC := 0;
  v_saldo_sin_este  NUMERIC;
  v_nuevo_saldo     NUMERIC;
BEGIN
  IF p_importe IS NULL OR p_importe < 0 THEN
    RAISE EXCEPTION 'IMPORTE_INVALIDO';
  END IF;

  SELECT estado INTO v_periodo_estado FROM public.planilla_periodos WHERE id = p_periodo_id;
  IF v_periodo_estado IS NULL THEN
    RAISE EXCEPTION 'PERIODO_NO_ENCONTRADO';
  END IF;
  IF v_periodo_estado <> 'abierto' THEN
    RAISE EXCEPTION 'PERIODO_CERRADO';
  END IF;

  SELECT * INTO v_descuento FROM public.planilla_descuentos WHERE id = p_descuento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESCUENTO_NO_ENCONTRADO';
  END IF;

  -- Si ya existía un cobro cobrado=true para este mismo periodo, se
  -- "libera" primero para calcular cuánto saldo hay realmente disponible.
  SELECT COALESCE(importe, 0) INTO v_cobro_anterior
    FROM public.planilla_descuento_cobros
    WHERE descuento_id = p_descuento_id AND periodo_id = p_periodo_id AND cobrado = true;
  v_cobro_anterior := COALESCE(v_cobro_anterior, 0);

  v_saldo_sin_este := v_descuento.saldo + v_cobro_anterior;

  IF p_cobrado AND p_importe > v_saldo_sin_este THEN
    RAISE EXCEPTION 'IMPORTE_EXCEDE_SALDO';
  END IF;

  INSERT INTO public.planilla_descuento_cobros (descuento_id, periodo_id, personal_id, importe, cobrado, creado_por)
  VALUES (p_descuento_id, p_periodo_id, v_descuento.personal_id, p_importe, p_cobrado, p_usuario_id)
  ON CONFLICT (descuento_id, periodo_id) DO UPDATE
    SET importe = EXCLUDED.importe, cobrado = EXCLUDED.cobrado, actualizado_en = NOW();

  v_nuevo_saldo := v_saldo_sin_este - (CASE WHEN p_cobrado THEN p_importe ELSE 0 END);

  UPDATE public.planilla_descuentos
    SET saldo  = v_nuevo_saldo,
        estado = CASE WHEN v_nuevo_saldo <= 0 THEN 'cancelado' ELSE 'pendiente' END
    WHERE id = p_descuento_id;

  RETURN v_nuevo_saldo;
END;
$$ LANGUAGE plpgsql;

-- 9) Periodos: crear con roster + agregar trabajador manualmente ----------
CREATE OR REPLACE FUNCTION public.planilla_crear_periodo(
  p_mes        INTEGER,
  p_anio       INTEGER,
  p_usuario_id UUID
) RETURNS UUID AS $$
DECLARE
  v_periodo_id UUID;
  v_etiqueta   TEXT;
  v_meses      TEXT[] := ARRAY['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
                                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
BEGIN
  IF p_mes IS NULL OR p_mes < 1 OR p_mes > 12 OR p_anio IS NULL THEN
    RAISE EXCEPTION 'DATOS_INVALIDOS';
  END IF;
  v_etiqueta := 'Planilla ' || v_meses[p_mes] || ' ' || p_anio;

  INSERT INTO public.planilla_periodos (mes, anio, etiqueta, estado, creado_por)
  VALUES (p_mes, p_anio, v_etiqueta, 'abierto', p_usuario_id)
  RETURNING id INTO v_periodo_id;

  INSERT INTO public.planilla_periodo_trabajadores
    (periodo_id, personal_id, sueldo_base, cargo, area, categoria, tipo, agregado_manualmente)
  SELECT v_periodo_id, id, COALESCE(sueldo_base, 0), cargo, area, categoria, tipo, false
  FROM public.personal_tripulantes
  WHERE activo = true;

  RETURN v_periodo_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.planilla_agregar_trabajador(
  p_periodo_id UUID,
  p_personal_id UUID,
  p_usuario_id  UUID
) RETURNS UUID AS $$
DECLARE
  v_periodo_estado TEXT;
  v_roster_id      UUID;
  v_trabajador     public.personal_tripulantes%ROWTYPE;
BEGIN
  SELECT estado INTO v_periodo_estado FROM public.planilla_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF v_periodo_estado IS NULL THEN RAISE EXCEPTION 'PERIODO_NO_ENCONTRADO'; END IF;
  IF v_periodo_estado <> 'abierto' THEN RAISE EXCEPTION 'PERIODO_CERRADO'; END IF;

  IF EXISTS (SELECT 1 FROM public.planilla_periodo_trabajadores WHERE periodo_id = p_periodo_id AND personal_id = p_personal_id) THEN
    RAISE EXCEPTION 'YA_EXISTE_EN_PERIODO';
  END IF;

  SELECT * INTO v_trabajador FROM public.personal_tripulantes WHERE id = p_personal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRABAJADOR_NO_ENCONTRADO'; END IF;

  INSERT INTO public.planilla_periodo_trabajadores
    (periodo_id, personal_id, sueldo_base, cargo, area, categoria, tipo, agregado_manualmente, agregado_por)
  VALUES (p_periodo_id, p_personal_id, COALESCE(v_trabajador.sueldo_base, 0), v_trabajador.cargo,
          v_trabajador.area, v_trabajador.categoria, v_trabajador.tipo, true, p_usuario_id)
  RETURNING id INTO v_roster_id;

  RETURN v_roster_id;
END;
$$ LANGUAGE plpgsql;

-- 10) Cierre y reapertura de periodos --------------------------------------
CREATE OR REPLACE FUNCTION public.planilla_cerrar_periodo(
  p_periodo_id UUID,
  p_usuario_id UUID
) RETURNS VOID AS $$
DECLARE
  v_estado TEXT;
BEGIN
  SELECT estado INTO v_estado FROM public.planilla_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'PERIODO_NO_ENCONTRADO'; END IF;
  IF v_estado <> 'abierto' THEN RAISE EXCEPTION 'PERIODO_YA_CERRADO'; END IF;

  UPDATE public.planilla_periodos
    SET estado = 'cerrado', cerrado_en = NOW(), cerrado_por = p_usuario_id
    WHERE id = p_periodo_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.planilla_reabrir_periodo(
  p_periodo_id UUID,
  p_usuario_id UUID,
  p_motivo     TEXT
) RETURNS VOID AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO';
  END IF;

  SELECT estado INTO v_estado FROM public.planilla_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'PERIODO_NO_ENCONTRADO'; END IF;
  IF v_estado <> 'cerrado' THEN RAISE EXCEPTION 'PERIODO_NO_CERRADO'; END IF;

  UPDATE public.planilla_periodos
    SET estado = 'abierto', reabierto_por = p_usuario_id, reabierto_en = NOW(), motivo_reapertura = p_motivo
    WHERE id = p_periodo_id;
END;
$$ LANGUAGE plpgsql;

-- 11) Vacaciones y Permisos completos --------------------------------------
CREATE TABLE IF NOT EXISTS public.planilla_vacaciones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  fecha_inicio DATE       NOT NULL,
  fecha_fin    DATE       NOT NULL CHECK (fecha_fin >= fecha_inicio),
  dias         NUMERIC    NOT NULL CHECK (dias > 0),
  estado       TEXT       NOT NULL DEFAULT 'Programada'
                           CHECK (estado IN ('Programada', 'Aprobada', 'Tomada', 'Cancelada')),
  observacion  TEXT       NULL,
  creado_por   UUID       NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_vacaciones_personal ON public.planilla_vacaciones(personal_id);
CREATE INDEX IF NOT EXISTS idx_pln_vacaciones_fechas    ON public.planilla_vacaciones(fecha_inicio, fecha_fin);
ALTER TABLE public.planilla_vacaciones DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.planilla_tipos_permiso (
  id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT    NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.planilla_tipos_permiso DISABLE ROW LEVEL SECURITY;
INSERT INTO public.planilla_tipos_permiso (nombre) VALUES
  ('Médico'), ('Personal'), ('Trámite'), ('Estudios'), ('Otro')
ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planilla_permisos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id   UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  tipo_id       UUID        NULL REFERENCES public.planilla_tipos_permiso(id),
  fecha         DATE        NOT NULL,
  hora_inicio   TIME        NULL,
  hora_fin      TIME        NULL,
  dia_completo  BOOLEAN     NOT NULL DEFAULT true,
  con_goce      BOOLEAN     NOT NULL DEFAULT true,
  motivo        TEXT        NULL,
  observacion   TEXT        NULL,
  estado        TEXT        NOT NULL DEFAULT 'Pendiente'
                             CHECK (estado IN ('Pendiente', 'Aprobado', 'Rechazado', 'Cancelado')),
  creado_por    UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_permisos_personal ON public.planilla_permisos(personal_id);
CREATE INDEX IF NOT EXISTS idx_pln_permisos_fecha    ON public.planilla_permisos(fecha);
ALTER TABLE public.planilla_permisos DISABLE ROW LEVEL SECURITY;

-- Migra lo que ya existía en personal_vacaciones (modelo viejo, mezclaba
-- vacaciones y permisos) hacia las tablas nuevas — una sola vez.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.planilla_vacaciones) = 0
     AND (SELECT COUNT(*) FROM public.planilla_permisos) = 0
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'personal_vacaciones') THEN

    INSERT INTO public.planilla_vacaciones (personal_id, fecha_inicio, fecha_fin, dias, estado, observacion, creado_por, creado_en)
    SELECT personal_id, fecha_inicio, fecha_fin, dias_utilizados, 'Aprobada', motivo, creado_por, creado_en
    FROM public.personal_vacaciones
    WHERE tipo = 'vacaciones';

    INSERT INTO public.planilla_permisos (personal_id, fecha, dia_completo, con_goce, motivo, estado, creado_por, creado_en)
    SELECT personal_id, fecha_inicio, true, true, motivo, 'Aprobado', creado_por, creado_en
    FROM public.personal_vacaciones
    WHERE tipo = 'permiso';
  END IF;
END $$;

-- 12) Auditoría de Planilla -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planilla_auditoria (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  usuario_nombre TEXT        NULL,
  accion         TEXT        NOT NULL,   -- ej. 'crear_periodo', 'cerrar_periodo', 'registrar_cobro'...
  entidad        TEXT        NOT NULL,   -- ej. 'periodo', 'bono', 'descuento', 'uniforme', 'vacacion', 'permiso'
  entidad_id     UUID        NULL,
  periodo_id     UUID        NULL REFERENCES public.planilla_periodos(id) ON DELETE SET NULL,
  valor_anterior JSONB       NULL,
  valor_nuevo    JSONB       NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_auditoria_entidad  ON public.planilla_auditoria(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_pln_auditoria_periodo  ON public.planilla_auditoria(periodo_id);
CREATE INDEX IF NOT EXISTS idx_pln_auditoria_creado_en ON public.planilla_auditoria(creado_en DESC);
ALTER TABLE public.planilla_auditoria DISABLE ROW LEVEL SECURITY;

-- 13) Uniforme: la entrega ahora genera un planilla_descuentos con saldo --
ALTER TABLE public.inventario_uniformes_movimientos
  ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS valor_total    NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS observacion    TEXT NULL,
  ADD COLUMN IF NOT EXISTS descuento_id   UUID NULL REFERENCES public.planilla_descuentos(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.entregar_uniforme(UUID, UUID, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.entregar_uniforme(
  p_uniforme_id UUID,
  p_personal_id UUID,
  p_cantidad    INTEGER,
  p_observacion TEXT,
  p_usuario_id  UUID
) RETURNS UUID AS $$
DECLARE
  v_uniforme    public.inventario_uniformes%ROWTYPE;
  v_concepto_id UUID;
  v_descuento_id UUID;
  v_monto       NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_uniforme FROM public.inventario_uniformes WHERE id = p_uniforme_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNIFORME_NO_ENCONTRADO'; END IF;
  IF v_uniforme.stock < p_cantidad THEN RAISE EXCEPTION 'STOCK_INSUFICIENTE'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.personal_tripulantes WHERE id = p_personal_id) THEN
    RAISE EXCEPTION 'PERSONAL_NO_ENCONTRADO';
  END IF;

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
    (uniforme_id, tipo, cantidad, personal_id, usuario_id, valor_unitario, valor_total, observacion, descuento_id)
  VALUES (p_uniforme_id, 'entrega', p_cantidad, p_personal_id, p_usuario_id, v_uniforme.precio, v_monto, p_observacion, v_descuento_id);

  RETURN v_descuento_id;
END;
$$ LANGUAGE plpgsql;

-- 14) Datos de la empresa emisora (para el encabezado de la boleta) ------
-- Fila única — se edita desde Configuración (Desarrollador/Admin).
CREATE TABLE IF NOT EXISTS public.planilla_empresa_datos (
  id              INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre          TEXT        NULL,
  ruc             TEXT        NULL,
  actualizado_por UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actualizado_en  TIMESTAMPTZ NULL
);
ALTER TABLE public.planilla_empresa_datos DISABLE ROW LEVEL SECURITY;
INSERT INTO public.planilla_empresa_datos (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='personal_tripulantes' AND column_name='area') AS area_ok,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='usuarios' AND column_name='puede_editar_planilla') AS permiso_editar_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_periodo_trabajadores') AS roster_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_bonos') AS bonos_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_descuentos') AS descuentos_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_descuento_cobros') AS cobros_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_vacaciones') AS vacaciones_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_permisos') AS permisos_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_auditoria') AS auditoria_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='planilla_registrar_cobro') AS fn_cobro_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='planilla_crear_periodo') AS fn_crear_periodo_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='planilla_reabrir_periodo') AS fn_reabrir_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entregar_uniforme') AS fn_entregar_uniforme_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_empresa_datos') AS empresa_datos_ok;
