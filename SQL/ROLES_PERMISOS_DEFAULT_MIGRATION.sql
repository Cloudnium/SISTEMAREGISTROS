-- =============================================
-- ROLES_PERMISOS_DEFAULT_MIGRATION.sql
--
-- Tabla que guarda los permisos POR DEFECTO de cada rol (operador,
-- visualizador). Se usa SOLO como plantilla al asignar un rol a un
-- usuario en el formulario de Usuarios — cambiar estos valores por
-- defecto NO modifica a los usuarios que ya existen; cada usuario
-- guarda sus propios permisos en su fila de "usuarios".
--
-- admin y desarrollador no están sujetos a esto: siempre tienen
-- acceso completo, sin importar estos valores.
--
-- Seguro de ejecutar varias veces (IF NOT EXISTS / ON CONFLICT).
-- =============================================

CREATE TABLE IF NOT EXISTS public.configuracion_roles_permisos (
  rol                                 TEXT        PRIMARY KEY,
  puede_anular                        BOOLEAN     NOT NULL DEFAULT false,
  puede_postergar                     BOOLEAN     NOT NULL DEFAULT false,
  puede_reservar                      BOOLEAN     NOT NULL DEFAULT false,
  puede_habilitar                     BOOLEAN     NOT NULL DEFAULT false,
  puede_reintegro                     BOOLEAN     NOT NULL DEFAULT false,
  puede_crear_codigos                 BOOLEAN     NOT NULL DEFAULT false,
  puede_editar_precios                BOOLEAN     NOT NULL DEFAULT false,
  puede_programar                     BOOLEAN     NOT NULL DEFAULT false,
  puede_ver_inventario                BOOLEAN     NOT NULL DEFAULT false,
  puede_gestionar_inventario          BOOLEAN     NOT NULL DEFAULT false,
  puede_restar_stock                  BOOLEAN     NOT NULL DEFAULT false,
  puede_ver_planilla                  BOOLEAN     NOT NULL DEFAULT false,
  puede_editar_planilla               BOOLEAN     NOT NULL DEFAULT false,
  puede_ver_combustible               BOOLEAN     NOT NULL DEFAULT false,
  puede_ver_personal                  BOOLEAN     NOT NULL DEFAULT false,
  puede_gestionar_estaciones_placas   BOOLEAN     NOT NULL DEFAULT false,
  actualizado_por UUID        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actualizado_en  TIMESTAMPTZ NULL
);
ALTER TABLE public.configuracion_roles_permisos DISABLE ROW LEVEL SECURITY;

-- Semilla: replica el comportamiento que tenía el formulario antes
-- (operador venía con los 5 permisos básicos de Boletaje activados;
-- visualizador venía sin ninguno, por ser de solo lectura).
INSERT INTO public.configuracion_roles_permisos
  (rol, puede_anular, puede_postergar, puede_reservar, puede_habilitar, puede_reintegro)
VALUES
  ('operador', true, true, true, true, true),
  ('visualizador', false, false, false, false, false)
ON CONFLICT (rol) DO NOTHING;

-- Verificación rápida
SELECT * FROM public.configuracion_roles_permisos;
