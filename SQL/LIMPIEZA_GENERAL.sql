-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA_GENERAL.sql   (versión actualizada — reemplaza la anterior)
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Deja el sistema "en blanco" para empezar a operar de cero:
-- borra ventas, programaciones, códigos de autorización, historial
-- de movimientos y chat — y REINICIA A 0 todas las series/correlativos
-- (boleto 1, boleto 2, factura, y el correlativo de manifiestos).
--
-- ⚠️ LO QUE **NUNCA** SE TOCA (ni datos ni estructura), tal como
-- pediste:
--   • public.usuarios (ningún usuario se borra ni se modifica)
--   • Todo lo de combustible: public.combustible_registros,
--     public.estaciones, public.placas
--
-- ── Qué se LIMPIA (datos TRANSACCIONALES — se generan día a día) ──
--   boletos (incluye los de REINTEGRO, los que quedaron "usados", y
--   TODO el historial de postergaciones/anulaciones de un mismo
--   asiento — desde la corrección de "postergar desvincula" puede
--   haber varias filas históricas por asiento, pero un TRUNCATE las
--   borra todas igual, sin ningún caso especial), boletos_movimientos
--   (historial, incluye los movimientos de tipo "reintegro"),
--   programaciones, programacion_escalas, codigos_autorizacion, chat
--   (mensajes y grupos). También dos tablas de plantilla antigua que
--   ningún módulo usa hoy (personal_empleados, inventario_*).
--
-- ── Qué se CONSERVA (datos MAESTROS/CONFIGURACIÓN de tu negocio) ──
--   ciudades, agencias, empresas (con su logo), buses, mapas de
--   asientos, destinos, servicios, personal_tripulantes,
--   series_agencia_empresa (las filas y las SERIES/TEXTO se
--   conservan) — de esta última, y de "agencias" y del contador de
--   manifiestos, SÍ se reinician a 0 los CORRELATIVOS, tal como
--   pediste, sin borrar ninguna fila ni la serie configurada.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Datos transaccionales: ventas, programación, códigos e historial
-- (CASCADE también vacía boletos_movimientos y cualquier fila de
-- codigos_autorizacion que quedara enlazada a un boleto, aunque ya
-- están listadas explícitamente para que quede claro qué se afecta)
TRUNCATE TABLE
  public.boletos,
  public.boletos_movimientos,
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

-- 2) Reinicia a 0 TODAS las series/correlativos, sin tocar la serie
-- (el texto "B001", "F001", etc.) ni borrar ninguna fila:
--   - Boleto 1, Boleto 2 y Factura, por cada agencia + empresa
UPDATE public.series_agencia_empresa
SET correlativo_actual   = 0,
    correlativo_boleto_2 = 0,
    correlativo_factura  = 0;

--   - Columnas heredadas en "agencias" (ya no se usan para vender,
--     pero se reinician igual por prolijidad, sin tocar la fila)
UPDATE public.agencias
SET correlativo_actual  = 0,
    correlativo_factura = 0;

--   - Correlativo de manifiestos (contador global)
UPDATE public.contador_manifiestos
SET correlativo = 0;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN OPCIONAL — borra también los datos MAESTROS/CONFIGURACIÓN
-- (ciudades, agencias, empresas, buses, mapas de asientos, servicios,
-- personal, series). Descomenta y ejecuta SOLO si de verdad quieres
-- empezar 100% desde cero y estás dispuesto a volver a registrar todo
-- eso manualmente. Los usuarios y combustible NO están incluidos aquí
-- tampoco, a propósito.
-- ══════════════════════════════════════════════════════════════
-- BEGIN;
-- TRUNCATE TABLE
--   public.series_agencia_empresa,
--   public.bus_asientos,
--   public.bus_config_asientos,
--   public.destino_ciudades_adicionales,
--   public.destinos,
--   public.buses,
--   public.empresas,
--   public.agencias,
--   public.ciudades,
--   public.servicios,
--   public.personal_tripulantes
-- RESTART IDENTITY CASCADE;
-- COMMIT;

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM public.usuarios)               AS usuarios_intactos,
  (SELECT COUNT(*) FROM public.combustible_registros)  AS combustible_intacto,
  (SELECT COUNT(*) FROM public.estaciones)              AS estaciones_intactas,
  (SELECT COUNT(*) FROM public.placas)                  AS placas_intactas,
  (SELECT COUNT(*) FROM public.boletos)                 AS boletos_restantes,
  (SELECT COUNT(*) FROM public.programaciones)          AS programaciones_restantes,
  (SELECT COUNT(*) FROM public.codigos_autorizacion)    AS codigos_restantes,
  (SELECT COALESCE(SUM(correlativo_actual),0) + COALESCE(SUM(correlativo_boleto_2),0) + COALESCE(SUM(correlativo_factura),0)
     FROM public.series_agencia_empresa)                AS suma_correlativos_series;
