-- ══════════════════════════════════════════════════════════════
-- CHAT_GRUPOS_SETUP.sql
-- Ejecuta en Supabase → SQL Editor → Run
-- Agrega soporte de grupos al chat existente
-- NO modifica nada de lo que ya existe
-- ══════════════════════════════════════════════════════════════

-- TABLA: grupos de chat
CREATE TABLE IF NOT EXISTS public.chat_grupos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT        NOT NULL,
  creado_por  UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLA: miembros de cada grupo
CREATE TABLE IF NOT EXISTS public.chat_grupo_miembros (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id   UUID        NOT NULL REFERENCES public.chat_grupos(id) ON DELETE CASCADE,
  usuario_id UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  unido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(grupo_id, usuario_id)  -- un usuario no puede estar dos veces en el mismo grupo
);

-- TABLA: mensajes de grupo (separada de mensajes 1 a 1)
CREATE TABLE IF NOT EXISTS public.chat_grupo_mensajes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id     UUID        NOT NULL REFERENCES public.chat_grupos(id) ON DELETE CASCADE,
  remitente_id UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  contenido    TEXT        NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLA: control de mensajes leidos por usuario en grupo
-- (cada usuario tiene su propio "ultimo mensaje leido")
CREATE TABLE IF NOT EXISTS public.chat_grupo_lecturas (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id            UUID        NOT NULL REFERENCES public.chat_grupos(id) ON DELETE CASCADE,
  usuario_id          UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  ultimo_leido_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(grupo_id, usuario_id)
);

-- Indices para rendimiento
CREATE INDEX IF NOT EXISTS idx_grupo_miembros_grupo   ON public.chat_grupo_miembros(grupo_id);
CREATE INDEX IF NOT EXISTS idx_grupo_miembros_usuario ON public.chat_grupo_miembros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_grupo_msgs_grupo       ON public.chat_grupo_mensajes(grupo_id);
CREATE INDEX IF NOT EXISTS idx_grupo_msgs_fecha       ON public.chat_grupo_mensajes(creado_en);
CREATE INDEX IF NOT EXISTS idx_grupo_lecturas         ON public.chat_grupo_lecturas(grupo_id, usuario_id);

-- Desactiva RLS (consistente con el resto del proyecto)
ALTER TABLE public.chat_grupos          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_grupo_miembros  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_grupo_mensajes  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_grupo_lecturas  DISABLE ROW LEVEL SECURITY;

-- Verifica
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'chat_%'
ORDER BY table_name;
