-- ══════════════════════════════════════════════════════════════
-- FIX_CODIGO_FK_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Requiere: FIX_NUMERO_LIBRE_MIGRATION.sql ya ejecutado.
--
-- Corrige: "insert or update on table codigos_autorizacion violates
-- foreign key constraint codigos_autorizacion_usado_en_boleto_id_fkey"
-- al usar un código de autorización en una venta NUEVA.
--
-- Causa: dentro de registrar_venta_asiento, el código se marca como
-- "usado" (enlazándolo al boleto) ANTES de insertar el boleto nuevo
-- en la tabla — para un asiento que todavía no tenía ningún boleto,
-- ese id todavía no existe en "boletos" en ese instante, así que la
-- llave foránea lo rechazaba de inmediato.
--
-- Solución: se posterga la verificación de esa llave foránea hasta el
-- FINAL de la transacción (cuando el boleto ya fue insertado), en vez
-- de validarla al instante. No cambia ningún dato ni ninguna función
-- — es un solo ajuste a la restricción, de bajo riesgo.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.codigos_autorizacion
  ALTER CONSTRAINT codigos_autorizacion_usado_en_boleto_id_fkey
  DEFERRABLE INITIALLY DEFERRED;

NOTIFY pgrst, 'reload schema';
