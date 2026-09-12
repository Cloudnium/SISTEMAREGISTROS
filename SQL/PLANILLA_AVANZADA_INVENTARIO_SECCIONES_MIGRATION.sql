-- ══════════════════════════════════════════════════════════════
-- PLANILLA_AVANZADA_INVENTARIO_SECCIONES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: PLANILLA_INVENTARIO_DESARROLLADOR_MIGRATION.sql ya ejecutado.
--
-- Agrega:
--   1. Más datos del trabajador (dirección, tipo de contrato, banco/
--      cuenta, AFP/ONP, días de vacaciones disponibles).
--   2. Conceptos de pago clasificados (sueldo básico, horas extra,
--      bonificaciones, comisiones, AFP, ONP, adelantos, préstamos,
--      faltas, etc.) sobre la base de planilla_movimientos que ya
--      existía.
--   3. Periodos de planilla (ej. "Planilla Agosto 2026") y el
--      snapshot de cada pago generado (boleta), independiente de lo
--      que pase después con los datos del trabajador.
--   4. Vacaciones y permisos.
--   5. Inventario por secciones (Uniformes sigue funcionando igual;
--      nuevas secciones como Repuestos se agregan dinámicamente,
--      cada una con su propio ícono).
-- ══════════════════════════════════════════════════════════════

-- 1) Más datos del trabajador -----------------------------------------
ALTER TABLE public.personal_tripulantes
  ADD COLUMN IF NOT EXISTS direccion               TEXT NULL,
  ADD COLUMN IF NOT EXISTS tipo_contrato            TEXT NULL,
  ADD COLUMN IF NOT EXISTS banco                    TEXT NULL,
  ADD COLUMN IF NOT EXISTS cuenta_bancaria          TEXT NULL,
  ADD COLUMN IF NOT EXISTS afp_onp                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS dias_vacaciones_disponibles NUMERIC NOT NULL DEFAULT 30;

-- 2) Conceptos de pago clasificados ------------------------------------
ALTER TABLE public.planilla_movimientos
  ADD COLUMN IF NOT EXISTS categoria_concepto TEXT NULL;
-- Valores esperados por la app (no es un CHECK estricto para no
-- romper nada si más adelante se necesita otro concepto):
--   Ingresos:   sueldo_basico, horas_extras, bonificacion, comision, asignacion, otro_ingreso
--   Descuentos: afp, onp, adelanto, prestamo, falta, otro_descuento, uniforme

-- 3) Periodos de planilla + boleta (snapshot de cada pago) ------------
CREATE TABLE IF NOT EXISTS public.planilla_periodos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mes         INTEGER     NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio        INTEGER     NOT NULL,
  etiqueta    TEXT        NOT NULL,               -- ej. "Planilla Agosto 2026"
  estado      TEXT        NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  creado_por  UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrado_en  TIMESTAMPTZ NULL,
  UNIQUE (mes, anio)
);
ALTER TABLE public.planilla_periodos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.planilla_pagos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id       UUID        NOT NULL REFERENCES public.planilla_periodos(id) ON DELETE CASCADE,
  personal_id      UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  sueldo_base      NUMERIC     NOT NULL DEFAULT 0,
  total_ingresos   NUMERIC     NOT NULL DEFAULT 0,
  total_descuentos NUMERIC     NOT NULL DEFAULT 0,
  neto_pagar       NUMERIC     NOT NULL DEFAULT 0,
  detalle          JSONB       NOT NULL DEFAULT '[]',
  generado_por     UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  generado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (periodo_id, personal_id)
);
CREATE INDEX IF NOT EXISTS idx_planilla_pagos_periodo ON public.planilla_pagos(periodo_id);
CREATE INDEX IF NOT EXISTS idx_planilla_pagos_personal ON public.planilla_pagos(personal_id);
ALTER TABLE public.planilla_pagos DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.planilla_movimientos
  ADD COLUMN IF NOT EXISTS pago_id UUID NULL REFERENCES public.planilla_pagos(id) ON DELETE SET NULL;

-- 4) Vacaciones y permisos ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_vacaciones (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id     UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  tipo            TEXT        NOT NULL DEFAULT 'vacaciones' CHECK (tipo IN ('vacaciones', 'permiso')),
  fecha_inicio    DATE        NOT NULL,
  fecha_fin       DATE        NOT NULL,
  dias_utilizados NUMERIC     NOT NULL,
  motivo          TEXT        NULL,
  creado_por      UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personal_vacaciones_personal ON public.personal_vacaciones(personal_id);
ALTER TABLE public.personal_vacaciones DISABLE ROW LEVEL SECURITY;

-- 5) Inventario por secciones -------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventario_categorias (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clave      TEXT        NOT NULL UNIQUE,
  nombre     TEXT        NOT NULL,
  icono      TEXT        NOT NULL DEFAULT 'package',
  orden      INTEGER     NOT NULL DEFAULT 0,
  es_sistema BOOLEAN     NOT NULL DEFAULT false,
  activo     BOOLEAN     NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.inventario_categorias DISABLE ROW LEVEL SECURITY;

INSERT INTO public.inventario_categorias (clave, nombre, icono, orden, es_sistema)
VALUES ('uniformes', 'Uniformes', 'shirt', 1, true)
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inventario_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID        NOT NULL REFERENCES public.inventario_categorias(id) ON DELETE CASCADE,
  nombre       TEXT        NOT NULL,
  descripcion  TEXT        NULL,
  precio       NUMERIC     NOT NULL DEFAULT 0,
  stock        INTEGER     NOT NULL DEFAULT 0,
  activo       BOOLEAN     NOT NULL DEFAULT true,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventario_items_categoria ON public.inventario_items(categoria_id);
ALTER TABLE public.inventario_items DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inventario_items_movimientos (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID        NOT NULL REFERENCES public.inventario_items(id) ON DELETE CASCADE,
  tipo       TEXT        NOT NULL CHECK (tipo IN ('ingreso', 'salida')),
  cantidad   INTEGER     NOT NULL CHECK (cantidad > 0),
  notas      TEXT        NULL,
  usuario_id UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_items_mov_item ON public.inventario_items_movimientos(item_id);
ALTER TABLE public.inventario_items_movimientos DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mover_stock_item(
  p_item_id    UUID,
  p_tipo       TEXT,
  p_cantidad   INTEGER,
  p_notas      TEXT,
  p_usuario_id UUID
) RETURNS UUID AS $$
DECLARE
  v_item   public.inventario_items%ROWTYPE;
  v_mov_id UUID;
BEGIN
  IF p_tipo NOT IN ('ingreso', 'salida') THEN
    RAISE EXCEPTION 'TIPO_INVALIDO';
  END IF;

  SELECT * INTO v_item FROM public.inventario_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NO_ENCONTRADO';
  END IF;
  IF p_tipo = 'salida' AND v_item.stock < p_cantidad THEN
    RAISE EXCEPTION 'STOCK_INSUFICIENTE';
  END IF;

  UPDATE public.inventario_items
    SET stock = stock + CASE WHEN p_tipo = 'ingreso' THEN p_cantidad ELSE -p_cantidad END
    WHERE id = p_item_id;

  INSERT INTO public.inventario_items_movimientos (item_id, tipo, cantidad, notas, usuario_id)
  VALUES (p_item_id, p_tipo, p_cantidad, p_notas, p_usuario_id)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
