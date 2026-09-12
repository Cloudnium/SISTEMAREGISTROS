-- ══════════════════════════════════════════════════════════════
-- PLANILLA_INVENTARIO_DESARROLLADOR_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- EJECUTAR ANTES QUE: PLANILLA_AVANZADA_INVENTARIO_SECCIONES_MIGRATION.sql
--
-- Esta es la migración base que el código (routes/planilla.js,
-- routes/inventario.js, routes/personal.js, routes/configuracion.js,
-- middleware/auth.js) ya asume que existe, pero que no se había
-- generado. Sin esto, Planilla e Inventario de Uniformes no
-- funcionan (tablas y función RPC inexistentes). No borra ni
-- modifica ningún dato existente — todo es aditivo.
--
-- Contenido:
--   1. Rol "desarrollador" + permisos puede_gestionar_inventario /
--      puede_ver_planilla en usuarios.
--   2. Personal: categoría (tripulación/administrativo), cargo libre,
--      sueldo base, fecha de ingreso.
--   3. Visibilidad de secciones (Desarrollador).
--   4. Planilla: movimientos pendientes (bonos/descuentos) por
--      trabajador.
--   5. Inventario de Uniformes + función atómica que entrega un
--      uniforme, descuenta stock y genera el descuento en Planilla.
-- ══════════════════════════════════════════════════════════════

-- 1) Rol "desarrollador" + nuevos permisos en usuarios --------------------
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'usuarios' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%rol%IN%';

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', v_constraint);
  END IF;

  ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_rol_check
    CHECK (rol IN ('admin', 'operador', 'visualizador', 'desarrollador'));
END $$;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS puede_gestionar_inventario BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puede_ver_planilla         BOOLEAN NOT NULL DEFAULT false;

-- 2) Personal: categoría, cargo libre, sueldo base, fecha de ingreso -------
-- "tipo" (Chofer/Terramoza/Ayudante) deja de ser obligatorio porque el
-- personal administrativo no lo usa (usa "cargo" en su lugar).
ALTER TABLE public.personal_tripulantes
  ALTER COLUMN tipo DROP NOT NULL;

ALTER TABLE public.personal_tripulantes
  ADD COLUMN IF NOT EXISTS categoria     TEXT NOT NULL DEFAULT 'tripulacion'
                            CHECK (categoria IN ('tripulacion', 'administrativo')),
  ADD COLUMN IF NOT EXISTS cargo         TEXT NULL,             -- solo si categoria = administrativo
  ADD COLUMN IF NOT EXISTS sueldo_base   NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS fecha_ingreso DATE NULL;

CREATE INDEX IF NOT EXISTS idx_personal_categoria ON public.personal_tripulantes(categoria);
CREATE INDEX IF NOT EXISTS idx_personal_cargo     ON public.personal_tripulantes(cargo);

-- 3) Visibilidad de secciones (Desarrollador) ------------------------------
CREATE TABLE IF NOT EXISTS public.configuracion_secciones (
  clave           TEXT        PRIMARY KEY,
  visible         BOOLEAN     NOT NULL DEFAULT true,
  actualizado_por UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actualizado_en  TIMESTAMPTZ NULL
);
ALTER TABLE public.configuracion_secciones DISABLE ROW LEVEL SECURITY;

-- Deja sembradas todas las secciones controlables como visibles por
-- defecto (si ya existiera alguna fila, no se toca).
INSERT INTO public.configuracion_secciones (clave, visible) VALUES
  ('boletaje', true), ('consulta-documentos', true), ('servicios', true),
  ('buses', true), ('ciudades', true), ('destinos', true),
  ('comprobantes', true), ('codigos', true), ('programacion', true),
  ('usuarios', true), ('empresas', true), ('mapa-asientos', true),
  ('planilla', true)
ON CONFLICT (clave) DO NOTHING;

-- 4) Planilla: movimientos pendientes (bonos/descuentos) -------------------
CREATE TABLE IF NOT EXISTS public.planilla_movimientos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  tipo        TEXT        NOT NULL CHECK (tipo IN ('bono', 'descuento')),
  concepto    TEXT        NOT NULL,                 -- etiqueta ya armada para mostrar (ej. "Préstamo — cuota 2")
  monto       NUMERIC     NOT NULL CHECK (monto >= 0),
  origen      TEXT        NOT NULL DEFAULT 'manual', -- manual | uniforme | (otros orígenes automáticos futuros)
  cobrado     BOOLEAN     NOT NULL DEFAULT false,
  cobrado_en  TIMESTAMPTZ NULL,
  creado_por  UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_planilla_mov_personal ON public.planilla_movimientos(personal_id);
CREATE INDEX IF NOT EXISTS idx_planilla_mov_cobrado  ON public.planilla_movimientos(cobrado);
CREATE INDEX IF NOT EXISTS idx_planilla_mov_origen   ON public.planilla_movimientos(origen);
ALTER TABLE public.planilla_movimientos DISABLE ROW LEVEL SECURITY;

-- 5) Inventario de Uniformes ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventario_uniformes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT        NOT NULL,                 -- ej. "Camisa manga larga - Talla M"
  descripcion TEXT        NULL,
  precio      NUMERIC     NOT NULL DEFAULT 0,
  stock       INTEGER     NOT NULL DEFAULT 0,
  activo      BOOLEAN     NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_uniformes_activo ON public.inventario_uniformes(activo);
ALTER TABLE public.inventario_uniformes DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inventario_uniformes_movimientos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uniforme_id UUID        NOT NULL REFERENCES public.inventario_uniformes(id) ON DELETE CASCADE,
  tipo        TEXT        NOT NULL CHECK (tipo IN ('ingreso', 'entrega')),
  cantidad    INTEGER     NOT NULL CHECK (cantidad > 0),
  personal_id UUID        NULL REFERENCES public.personal_tripulantes(id) ON DELETE SET NULL, -- solo en 'entrega'
  usuario_id  UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_unif_mov_uniforme ON public.inventario_uniformes_movimientos(uniforme_id);
CREATE INDEX IF NOT EXISTS idx_inv_unif_mov_personal ON public.inventario_uniformes_movimientos(personal_id);
ALTER TABLE public.inventario_uniformes_movimientos DISABLE ROW LEVEL SECURITY;

-- Entrega un uniforme a un trabajador de forma atómica:
--   1. Bloquea y valida stock suficiente.
--   2. Descuenta el stock.
--   3. Registra el movimiento de salida/entrega (con a quién y quién la hizo).
--   4. Genera automáticamente el descuento correspondiente en Planilla
--      (queda PENDIENTE — se cobra luego marcándolo en la pantalla de
--      Planilla, igual que cualquier otro descuento).
CREATE OR REPLACE FUNCTION public.entregar_uniforme(
  p_uniforme_id UUID,
  p_personal_id UUID,
  p_cantidad    INTEGER,
  p_usuario_id  UUID
) RETURNS UUID AS $$
DECLARE
  v_uniforme  public.inventario_uniformes%ROWTYPE;
  v_monto     NUMERIC;
  v_mov_id    UUID;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_uniforme FROM public.inventario_uniformes WHERE id = p_uniforme_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNIFORME_NO_ENCONTRADO';
  END IF;
  IF v_uniforme.stock < p_cantidad THEN
    RAISE EXCEPTION 'STOCK_INSUFICIENTE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.personal_tripulantes WHERE id = p_personal_id) THEN
    RAISE EXCEPTION 'PERSONAL_NO_ENCONTRADO';
  END IF;

  UPDATE public.inventario_uniformes
    SET stock = stock - p_cantidad
    WHERE id = p_uniforme_id;

  INSERT INTO public.inventario_uniformes_movimientos (uniforme_id, tipo, cantidad, personal_id, usuario_id)
  VALUES (p_uniforme_id, 'entrega', p_cantidad, p_personal_id, p_usuario_id)
  RETURNING id INTO v_mov_id;

  v_monto := v_uniforme.precio * p_cantidad;

  INSERT INTO public.planilla_movimientos (personal_id, tipo, concepto, monto, origen, creado_por)
  VALUES (
    p_personal_id, 'descuento',
    'Uniforme — ' || v_uniforme.nombre || ' (x' || p_cantidad || ')',
    v_monto, 'uniforme', p_usuario_id
  );

  RETURN v_mov_id;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='usuarios' AND column_name IN ('puede_gestionar_inventario','puede_ver_planilla')) AS permisos_usuarios_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='planilla_movimientos')            AS planilla_movimientos_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='inventario_uniformes')             AS inventario_uniformes_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='inventario_uniformes_movimientos') AS inventario_uniformes_mov_ok,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='configuracion_secciones')          AS configuracion_secciones_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entregar_uniforme')                                     AS funcion_entregar_uniforme_ok;
