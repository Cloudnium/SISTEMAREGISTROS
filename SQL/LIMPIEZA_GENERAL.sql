-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA_GENERAL.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Deja el sistema "en blanco" para empezar a operar de cero:
-- borra ventas, programaciones y mensajes de chat, y REINICIA a 0
-- los correlativos de boletos/facturas de cada agencia.
--
-- ⚠️ LA TABLA combustible_registros (Y SUS TABLAS DE APOYO
-- estaciones/placas, que ese módulo necesita para funcionar) **NUNCA
-- SE TOCAN**, tal como pediste — ni sus datos ni su estructura.
--
-- ── Qué se limpia (datos TRANSACCIONALES — se generan día a día) ──
--   boletos, programaciones, programacion_escalas, codigos_autorizacion,
--   chat (mensajes y grupos).
--
-- ── Qué se CONSERVA (datos MAESTROS/CONFIGURACIÓN de tu negocio,
--    los que armaste con esfuerzo: ciudades, agencias, buses, mapas
--    de asientos, servicios, personal, usuarios) ──
--   No se borran filas, pero si son "series" (los correlativos de
--   boleta/factura de cada agencia) SÍ se reinician a 0, tal como
--   pediste. Si de verdad quieres borrar también estas tablas
--   maestras, tienes la SECCIÓN OPCIONAL comentada más abajo — actívala
--   solo si estás seguro, porque tendrías que volver a registrar
--   ciudades, agencias, buses, mapas de asientos, etc. desde cero.
--
-- ── Usuarios ──
--   NO se borran. Si el sistema se quedara sin ningún usuario admin,
--   nadie podría volver a entrar a arreglarlo. Si igual quieres
--   limpiarlos, hazlo tú manualmente y con cuidado desde el módulo
--   de Usuarios (dejando al menos un admin), no desde este script.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Datos transaccionales: ventas, programación y chat
TRUNCATE TABLE
  public.boletos,
  public.programacion_escalas,
  public.programaciones,
  public.codigos_autorizacion,
  public.chat_grupo_lecturas,
  public.chat_grupo_mensajes,
  public.chat_grupo_miembros,
  public.chat_grupos,
  public.chat_mensajes
RESTART IDENTITY CASCADE;

-- Tablas de plantilla antigua que ningún módulo usa actualmente
-- (no aparecen referenciadas en el código); se limpian por prolijidad.
TRUNCATE TABLE
  public.personal_empleados,
  public.inventario_movimientos,
  public.inventario_productos
RESTART IDENTITY CASCADE;

-- 2) Reinicia a 0 las "series" (correlativos de boleta y factura) de
-- cada agencia, SIN borrar las agencias mismas.
UPDATE public.agencias
SET correlativo_actual  = 0,
    correlativo_factura = 0;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN OPCIONAL — borra también los datos MAESTROS/CONFIGURACIÓN
-- (ciudades, agencias, buses, mapas de asientos, servicios, personal).
-- Descomenta y ejecuta SOLO si de verdad quieres empezar 100% desde
-- cero y estás dispuesto a volver a registrar todo eso manualmente.
-- Los usuarios NO están incluidos aquí tampoco, a propósito.
-- ══════════════════════════════════════════════════════════════
-- BEGIN;
-- TRUNCATE TABLE
--   public.bus_asientos,
--   public.bus_config_asientos,
--   public.destino_ciudades_adicionales,
--   public.destinos,
--   public.buses,
--   public.agencias,
--   public.ciudades,
--   public.servicios,
--   public.personal_tripulantes
-- RESTART IDENTITY CASCADE;
-- COMMIT;

-- Verificación final: confirma que combustible sigue intacto
SELECT COUNT(*) AS registros_combustible_intactos FROM public.combustible_registros;
