-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA_TOTAL_MENOS_COMBUSTIBLE.sql
-- ⚠️ MUY DESTRUCTIVO — lee esto antes de correrlo ⚠️
--
-- Borra ABSOLUTAMENTE TODO el sistema (ventas, programación, buses,
-- ciudades, agencias, empresas, destinos, servicios, personal,
-- planilla, inventario de uniformes, chat, códigos de autorización,
-- historial) y reinicia todos los correlativos a 0.
--
-- Lo ÚNICO que se conserva intacto es:
--   • public.usuarios       (nadie se borra, ni sus contraseñas/roles)
--   • public.combustible_registros
--   • public.estaciones
--   • public.placas
--
-- Esto NO es lo mismo que LIMPIEZA_GENERAL.sql (que sí conservaba
-- ciudades, agencias, empresas, buses, servicios y personal). Usa
-- este script SOLO si de verdad quieres dejar el sistema en blanco
-- por completo y volver a registrar todos los datos maestros desde
-- cero — no hay forma de deshacer esto salvo restaurando un backup.
--
-- Ejecuta en Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Todo lo transaccional y de catálogo, en un solo TRUNCATE con
--    CASCADE (arrastra automáticamente cualquier tabla dependiente
--    que no esté listada, como boletos_movimientos o
--    codigos_autorizacion que dependen de boletos).
TRUNCATE TABLE
  public.boletos,
  public.boletos_movimientos,
  public.programacion_escalas,
  public.programaciones,
  public.codigos_autorizacion,
  public.series_agencia_empresa,
  public.bus_asientos,
  public.bus_config_asientos,
  public.buses,
  public.empresas,
  public.destino_ciudades_adicionales,
  public.destinos,
  public.agencias,
  public.ciudades,
  public.servicios,
  public.planilla_movimientos,
  public.inventario_uniformes_movimientos,
  public.inventario_uniformes,
  public.personal_tripulantes,
  public.personal_empleados,
  public.inventario_movimientos,
  public.inventario_productos,
  public.chat_grupo_lecturas,
  public.chat_grupo_mensajes,
  public.chat_grupo_miembros,
  public.chat_grupos,
  public.chat_mensajes
RESTART IDENTITY CASCADE;

-- 2) Reinicia el correlativo del manifiesto (fila única, no se borra)
UPDATE public.contador_manifiestos SET correlativo = 0;

COMMIT;

-- ── Verificación final ──
SELECT
  (SELECT COUNT(*) FROM public.usuarios)              AS usuarios_intactos,
  (SELECT COUNT(*) FROM public.combustible_registros) AS combustible_intacto,
  (SELECT COUNT(*) FROM public.estaciones)             AS estaciones_intactas,
  (SELECT COUNT(*) FROM public.placas)                 AS placas_intactas,
  (SELECT COUNT(*) FROM public.boletos)                AS boletos_restantes,
  (SELECT COUNT(*) FROM public.ciudades)               AS ciudades_restantes,
  (SELECT COUNT(*) FROM public.buses)                  AS buses_restantes;
