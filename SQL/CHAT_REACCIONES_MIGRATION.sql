-- ══════════════════════════════════════════════════════════════
-- CHAT_REACCIONES_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Reacciones con emoji a mensajes de chat (individuales y de grupo),
-- estilo WhatsApp: un usuario tiene como máximo UNA reacción por
-- mensaje (si reacciona de nuevo con el mismo emoji se la quita; si
-- reacciona con uno distinto, se reemplaza).
--
-- "mensaje_tipo" distingue si mensaje_id apunta a chat_mensajes
-- (chat 1 a 1, tipo='individual') o a chat_grupo_mensajes
-- (tipo='grupo') — no lleva FK directa a esas tablas porque un mismo
-- id podría, en teoría, repetirse entre ambas.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.chat_reacciones (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mensaje_id   UUID        NOT NULL,
  mensaje_tipo TEXT        NOT NULL CHECK (mensaje_tipo IN ('individual', 'grupo')),
  usuario_id   UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  emoji        TEXT        NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mensaje_id, mensaje_tipo, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_reacciones_mensaje ON public.chat_reacciones(mensaje_id, mensaje_tipo);
ALTER TABLE public.chat_reacciones DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT COUNT(*) AS tabla_chat_reacciones_ok FROM information_schema.tables WHERE table_name = 'chat_reacciones';
