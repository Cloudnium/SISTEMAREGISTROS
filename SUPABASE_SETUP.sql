-- ══════════════════════════════════════════════════════════════
-- SUPABASE_SETUP.sql
-- Script completo para crear la base de datos de Cloudnium
--
-- INSTRUCCIONES:
-- 1. Ve a tu proyecto en https://app.supabase.com
-- 2. Abre el SQL Editor (ícono de terminal en el sidebar)
-- 3. Pega TODO este archivo y ejecuta con "Run"
-- ══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- EXTENSIONES necesarias
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- Para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- Para búsquedas de texto


-- ══════════════════════════════════════════════════════════════
-- TABLA: usuarios
-- Almacena los usuarios del sistema (login, roles, accesos)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.usuarios (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT         NOT NULL,                        -- Nombre completo del usuario
  username       TEXT         NOT NULL UNIQUE,                 -- Nombre de usuario para login
  email          TEXT         NOT NULL UNIQUE,                 -- Correo para login alternativo
  password_hash  TEXT         NOT NULL,                        -- Contraseña hasheada con bcrypt
  rol            TEXT         NOT NULL DEFAULT 'operador'      -- Rol: admin | operador | visualizador
                              CHECK (rol IN ('admin', 'operador', 'visualizador')),
  activo         BOOLEAN      NOT NULL DEFAULT true,           -- false = usuario deshabilitado
  avatar         TEXT         NULL,                            -- Ruta a imagen de avatar (opcional)
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),          -- Fecha de creación del usuario
  ultimo_acceso  TIMESTAMPTZ  NULL                             -- Última vez que inició sesión
);

-- Índices para búsquedas rápidas de login
CREATE INDEX IF NOT EXISTS idx_usuarios_username ON public.usuarios(username);
CREATE INDEX IF NOT EXISTS idx_usuarios_email    ON public.usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo   ON public.usuarios(activo);

-- Comentarios de la tabla
COMMENT ON TABLE  public.usuarios                IS 'Usuarios del sistema Cloudnium';
COMMENT ON COLUMN public.usuarios.password_hash  IS 'Hash bcrypt generado en el servidor Node.js';
COMMENT ON COLUMN public.usuarios.rol            IS 'admin=acceso total, operador=módulos, visualizador=solo lectura';


-- ══════════════════════════════════════════════════════════════
-- TABLA: combustible_registros
-- Registros de consumo y carga de combustible
-- (Estructura base — expandir según necesidad)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.combustible_registros (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          DATE         NOT NULL DEFAULT CURRENT_DATE,   -- Fecha del registro
  tipo           TEXT         NOT NULL                         -- Tipo: carga | consumo
                              CHECK (tipo IN ('carga', 'consumo')),
  cantidad_litros NUMERIC(10,2) NOT NULL,                      -- Litros cargados/consumidos
  costo_unitario  NUMERIC(10,4) NULL,                          -- Precio por litro
  costo_total     NUMERIC(10,2) GENERATED ALWAYS AS
                    (cantidad_litros * COALESCE(costo_unitario, 0)) STORED,  -- Costo calculado
  vehiculo       TEXT         NULL,                            -- Placa o nombre del vehículo
  proveedor      TEXT         NULL,                            -- Proveedor o estación de servicio
  observaciones  TEXT         NULL,                            -- Notas adicionales
  usuario_id     UUID         REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_combustible_fecha     ON public.combustible_registros(fecha);
CREATE INDEX IF NOT EXISTS idx_combustible_tipo      ON public.combustible_registros(tipo);
CREATE INDEX IF NOT EXISTS idx_combustible_vehiculo  ON public.combustible_registros(vehiculo);

COMMENT ON TABLE public.combustible_registros IS 'Registros de combustible: cargas y consumos';


-- ══════════════════════════════════════════════════════════════
-- TABLA: personal_empleados
-- Datos del personal de la empresa
-- (Estructura base — expandir según necesidad)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.personal_empleados (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT         NOT NULL,                        -- Nombre completo
  dni            TEXT         UNIQUE NULL,                     -- DNI del empleado
  cargo          TEXT         NOT NULL,                        -- Cargo o puesto
  area           TEXT         NULL,                            -- Área o departamento
  telefono       TEXT         NULL,                            -- Teléfono de contacto
  email          TEXT         UNIQUE NULL,                     -- Correo del empleado
  fecha_ingreso  DATE         NULL,                            -- Fecha de ingreso a la empresa
  salario        NUMERIC(10,2) NULL,                           -- Salario mensual
  activo         BOOLEAN      NOT NULL DEFAULT true,           -- false = ex-empleado
  observaciones  TEXT         NULL,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_activo ON public.personal_empleados(activo);
CREATE INDEX IF NOT EXISTS idx_personal_cargo  ON public.personal_empleados(cargo);

COMMENT ON TABLE public.personal_empleados IS 'Datos del personal de la empresa';


-- ══════════════════════════════════════════════════════════════
-- TABLA: inventario_productos
-- Catálogo de productos/materiales
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inventario_productos (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT         UNIQUE NULL,                     -- Código interno del producto
  nombre         TEXT         NOT NULL,                        -- Nombre del producto
  descripcion    TEXT         NULL,                            -- Descripción detallada
  categoria      TEXT         NULL,                            -- Categoría o tipo
  unidad         TEXT         NOT NULL DEFAULT 'unidad',       -- Unidad de medida
  stock_actual   NUMERIC(10,2) NOT NULL DEFAULT 0,             -- Cantidad actual en inventario
  stock_minimo   NUMERIC(10,2) NOT NULL DEFAULT 0,             -- Stock mínimo para alerta
  precio_compra  NUMERIC(10,4) NULL,                           -- Precio de compra/costo
  precio_venta   NUMERIC(10,4) NULL,                           -- Precio de venta
  activo         BOOLEAN      NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventario_nombre    ON public.inventario_productos(nombre);
CREATE INDEX IF NOT EXISTS idx_inventario_categoria ON public.inventario_productos(categoria);
CREATE INDEX IF NOT EXISTS idx_inventario_activo    ON public.inventario_productos(activo);

COMMENT ON TABLE public.inventario_productos IS 'Catálogo de productos del inventario';


-- ══════════════════════════════════════════════════════════════
-- TABLA: inventario_movimientos
-- Historial de entradas y salidas del inventario
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id    UUID         NOT NULL REFERENCES public.inventario_productos(id) ON DELETE CASCADE,
  tipo           TEXT         NOT NULL                         -- entrada | salida | ajuste
                              CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad       NUMERIC(10,2) NOT NULL,
  stock_anterior NUMERIC(10,2) NOT NULL,                       -- Stock antes del movimiento
  stock_nuevo    NUMERIC(10,2) NOT NULL,                       -- Stock después del movimiento
  motivo         TEXT         NULL,                            -- Razón del movimiento
  usuario_id     UUID         REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON public.inventario_movimientos(producto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo     ON public.inventario_movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha    ON public.inventario_movimientos(creado_en);

COMMENT ON TABLE public.inventario_movimientos IS 'Historial de entradas y salidas del inventario';


-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Desactiva RLS ya que la autenticación se maneja en el servidor Node.js
-- con express-session y bcrypt (no con Supabase Auth)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.usuarios                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.combustible_registros   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_empleados      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_productos    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_movimientos  DISABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════
-- DATO INICIAL: Usuario administrador por defecto
-- Contraseña: Admin123  (cámbiala inmediatamente después de entrar)
--
-- Hash generado con: bcrypt.hashSync('Admin123', 10)
-- Para cambiar la contraseña inicial, usa el panel de Usuarios del sistema
-- ══════════════════════════════════════════════════════════════
INSERT INTO public.usuarios (nombre, username, email, password_hash, rol, activo)
VALUES (
  'Administrador',
  'admin',
  'admin@maxxsystem.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- contraseña: password
  'admin',
  true
)
ON CONFLICT (username) DO NOTHING;

-- ⚠️  IMPORTANTE: La contraseña del admin inicial es "password"
--    Cámbiala inmediatamente desde Gestión > Usuarios después de ingresar.


-- ══════════════════════════════════════════════════════════════
-- VERIFICACIÓN — Confirma que las tablas se crearon correctamente
-- ══════════════════════════════════════════════════════════════
SELECT
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'usuarios',
    'combustible_registros',
    'personal_empleados',
    'inventario_productos',
    'inventario_movimientos'
  )
ORDER BY tablename;


-- ══════════════════════════════════════════════════════════════
-- ACTUALIZACIÓN — Tablas Estaciones y Placas
-- Ejecuta estas sentencias en el SQL Editor de Supabase
-- (pueden ir después del script inicial o en una nueva sesión)
-- ══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- TABLA: estaciones
-- Estaciones de servicio / grifos
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estaciones (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    TEXT     NOT NULL UNIQUE,   -- Nombre de la estación de servicio
  activo    BOOLEAN  NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.estaciones IS 'Estaciones de servicio/grifos registrados';

-- Datos de ejemplo — borra o edita según tus estaciones reales
INSERT INTO public.estaciones (nombre) VALUES
  ('Grifo Central'),
  ('Estación Norte'),
  ('Estación Sur')
ON CONFLICT (nombre) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- TABLA: placas
-- Placas de vehículos de la flota
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.placas (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  numero    TEXT     NOT NULL UNIQUE,   -- Número de placa (ej: ABC-123)
  activo    BOOLEAN  NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.placas IS 'Placas de vehículos de la flota';

-- Datos de ejemplo — borra o edita según tus placas reales
INSERT INTO public.placas (numero) VALUES
  ('ABC-123'),
  ('XYZ-456'),
  ('DEF-789')
ON CONFLICT (numero) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- ACTUALIZAR TABLA: combustible_registros
-- Reemplaza columnas antiguas por FKs a estaciones y placas
-- ──────────────────────────────────────────────────────────────

-- Agrega columnas estacion_id y placa_id si no existen
ALTER TABLE public.combustible_registros
  ADD COLUMN IF NOT EXISTS estacion_id UUID REFERENCES public.estaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placa_id    UUID REFERENCES public.placas(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vale        TEXT;

-- Índices para los JOINs
CREATE INDEX IF NOT EXISTS idx_combustible_estacion ON public.combustible_registros(estacion_id);
CREATE INDEX IF NOT EXISTS idx_combustible_placa    ON public.combustible_registros(placa_id);
CREATE INDEX IF NOT EXISTS idx_combustible_vale     ON public.combustible_registros(vale);

-- Desactiva RLS en las nuevas tablas
ALTER TABLE public.estaciones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.placas     DISABLE ROW LEVEL SECURITY;
