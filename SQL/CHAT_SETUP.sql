-- ══════════════════════════════════════════════════════════════
-- CHAT_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Agrega el sistema de chat al proyecto existente
-- ══════════════════════════════════════════════════════════════

-- PASO 1: Agrega columna de "ultima actividad" a usuarios
-- Se usa para saber quien esta en linea (punto verde)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS ultima_actividad TIMESTAMPTZ NULL;

-- PASO 2: Tabla de mensajes de chat (conversaciones 1 a 1)
CREATE TABLE IF NOT EXISTS public.chat_mensajes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  remitente_id    UUID         NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  destinatario_id UUID         NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  contenido       TEXT         NOT NULL,
  leido           BOOLEAN      NOT NULL DEFAULT false,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indices para que las consultas de conversaciones sean rapidas
CREATE INDEX IF NOT EXISTS idx_chat_remitente    ON public.chat_mensajes(remitente_id);
CREATE INDEX IF NOT EXISTS idx_chat_destinatario ON public.chat_mensajes(destinatario_id);
CREATE INDEX IF NOT EXISTS idx_chat_creado       ON public.chat_mensajes(creado_en);
CREATE INDEX IF NOT EXISTS idx_chat_leido        ON public.chat_mensajes(leido);

-- Desactiva RLS (consistente con el resto del proyecto,
-- el control de acceso se hace en las rutas de Express)
ALTER TABLE public.chat_mensajes DISABLE ROW LEVEL SECURITY;

-- PASO 3: Verifica que todo quedo bien
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'chat_mensajes'
ORDER BY ordinal_position;
