-- ══════════════════════════════════════════════════════════════
-- PLANILLA_VACACIONES_MODULO_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere ya ejecutado: PLANILLA_DESCUENTOS_SALDO_AUDITORIA_MIGRATION.sql
--
-- Todo es ADITIVO y re-ejecutable (IF NOT EXISTS / DROP IF EXISTS).
-- No borra datos. Reutiliza las tablas que ya existen:
--
--   planilla_empresa_datos  (empresa)  → + dias_vacaciones_anuales
--   planilla_vacaciones     (vacación) → + periodo, remuneración, estado de pago
--                                        y nuevos estados de vacaciones
--   NUEVA planilla_vacaciones_periodos (periodo vacacional de cada trabajador)
--   NUEVA planilla_vacaciones_pagos    (historial de pago; 1 por vacación)
--
-- Relación:  empresa (días por defecto) → periodo vacacional (guarda
-- SUS PROPIOS días otorgados) → vacaciones → pago.
--
-- Los días UTILIZADOS y RESTANTES NO se guardan: se calculan siempre
-- sumando las vacaciones no canceladas del periodo. Así cancelar una
-- vacación devuelve los días solo y es imposible descontar dos veces.
-- ══════════════════════════════════════════════════════════════

-- 1) Empresa: días de vacaciones anuales por defecto ------------------
ALTER TABLE public.planilla_empresa_datos
  ADD COLUMN IF NOT EXISTS dias_vacaciones_anuales INTEGER NOT NULL DEFAULT 15;
ALTER TABLE public.planilla_empresa_datos
  DROP CONSTRAINT IF EXISTS planilla_empresa_dias_vac_check;
ALTER TABLE public.planilla_empresa_datos
  ADD CONSTRAINT planilla_empresa_dias_vac_check CHECK (dias_vacaciones_anuales > 0);

-- 2) Periodos vacacionales --------------------------------------------
-- dias_otorgados se copia de la configuración al crear el periodo y ya
-- no cambia si después se modifica la configuración de la empresa.
CREATE TABLE IF NOT EXISTS public.planilla_vacaciones_periodos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id    UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  anio           INTEGER     NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  dias_otorgados NUMERIC     NOT NULL CHECK (dias_otorgados > 0),
  creado_por     UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (personal_id, anio)
);
CREATE INDEX IF NOT EXISTS idx_pln_vac_periodos_personal ON public.planilla_vacaciones_periodos(personal_id);
ALTER TABLE public.planilla_vacaciones_periodos DISABLE ROW LEVEL SECURITY;

-- 3) Vacaciones: periodo, remuneración (manual) y estado de pago ------
ALTER TABLE public.planilla_vacaciones
  ADD COLUMN IF NOT EXISTS periodo_vacacional_id UUID NULL REFERENCES public.planilla_vacaciones_periodos(id),
  ADD COLUMN IF NOT EXISTS remuneracion NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado_pago  TEXT    NOT NULL DEFAULT 'Pendiente de pago',
  ADD COLUMN IF NOT EXISTS fecha_pago   DATE    NULL;
CREATE INDEX IF NOT EXISTS idx_pln_vacaciones_periodo ON public.planilla_vacaciones(periodo_vacacional_id);

ALTER TABLE public.planilla_vacaciones DROP CONSTRAINT IF EXISTS planilla_vacaciones_remuneracion_check;
ALTER TABLE public.planilla_vacaciones ADD  CONSTRAINT planilla_vacaciones_remuneracion_check CHECK (remuneracion >= 0);

ALTER TABLE public.planilla_vacaciones DROP CONSTRAINT IF EXISTS planilla_vacaciones_estado_pago_check;
ALTER TABLE public.planilla_vacaciones ADD  CONSTRAINT planilla_vacaciones_estado_pago_check
  CHECK (estado_pago IN ('Pendiente de pago', 'Pagado'));

-- Nuevos estados de vacaciones (antes: Programada/Aprobada/Tomada/Cancelada).
-- Se convierten los registros existentes:
ALTER TABLE public.planilla_vacaciones DROP CONSTRAINT IF EXISTS planilla_vacaciones_estado_check;
ALTER TABLE public.planilla_vacaciones DROP CONSTRAINT IF EXISTS planilla_vacaciones_estado_v2_check;
UPDATE public.planilla_vacaciones SET estado = 'Pendiente'  WHERE estado = 'Programada';
UPDATE public.planilla_vacaciones SET estado = 'Aprobado'   WHERE estado = 'Aprobada';
UPDATE public.planilla_vacaciones SET estado = 'Finalizado' WHERE estado = 'Tomada';
UPDATE public.planilla_vacaciones SET estado = 'Cancelado'  WHERE estado = 'Cancelada';
ALTER TABLE public.planilla_vacaciones ALTER COLUMN estado SET DEFAULT 'Pendiente';
ALTER TABLE public.planilla_vacaciones ADD CONSTRAINT planilla_vacaciones_estado_v2_check
  CHECK (estado IN ('Pendiente', 'Aprobado', 'En curso', 'Finalizado', 'Cancelado'));

-- 4) Pagos (historial + protección contra pagos duplicados) -----------
-- UNIQUE(vacacion_id): una vacación solo puede tener UN pago. Incluso
-- si dos personas hacen clic a la vez, la base rechaza el segundo.
CREATE TABLE IF NOT EXISTS public.planilla_vacaciones_pagos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vacacion_id    UUID        NOT NULL UNIQUE REFERENCES public.planilla_vacaciones(id),
  personal_id    UUID        NOT NULL REFERENCES public.personal_tripulantes(id) ON DELETE CASCADE,
  monto          NUMERIC     NOT NULL CHECK (monto > 0),
  fecha_pago     DATE        NOT NULL,
  registrado_por UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pln_vac_pagos_fecha    ON public.planilla_vacaciones_pagos(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pln_vac_pagos_personal ON public.planilla_vacaciones_pagos(personal_id);
ALTER TABLE public.planilla_vacaciones_pagos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación rápida
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='planilla_empresa_datos' AND column_name='dias_vacaciones_anuales') AS config_ok,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name='planilla_vacaciones_periodos') AS periodos_ok,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name='planilla_vacaciones_pagos')    AS pagos_ok,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='planilla_vacaciones' AND column_name IN ('periodo_vacacional_id','remuneracion','estado_pago','fecha_pago')) AS columnas_vacaciones_ok;
