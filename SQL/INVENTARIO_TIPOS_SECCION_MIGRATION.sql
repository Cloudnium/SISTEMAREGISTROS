-- ══════════════════════════════════════════════════════════════
-- INVENTARIO_TIPOS_SECCION_MIGRATION.sql
-- Ejecuta en Supabase → SQL Editor → Run
--
-- Prepara el terreno para que cada "tipo" de sección de Inventario
-- (Uniformes, Repuestos, y lo que se vaya agregando) pueda tener su
-- propio formato preestablecido, sin romper nada de lo que ya existe:
--
--   • "Uniformes" sigue funcionando exactamente igual que ahora (su
--     propia tabla inventario_uniformes, su propia pantalla) — esto
--     NO se toca.
--   • Las secciones que se crean con "Nueva sección" hoy usan un
--     formato genérico (nombre, descripción, precio, stock) — eso
--     tampoco cambia todavía.
--   • Se agrega una columna "tipo" a inventario_categorias para que,
--     en el futuro, cada sección declare qué formato usa
--     ('uniformes', 'generico', y más adelante 'repuestos', etc.).
--   • Se agrega una columna "atributos" (JSONB, flexible) a
--     inventario_items para poder guardar los campos propios de un
--     tipo nuevo (por ejemplo, los que tenga Repuestos) sin tener que
--     crear una tabla ni una migración distinta cada vez.
--
-- Con esto, cuando llegue el formato de "Repuestos", solo hace falta
-- agregar su propio tipo + sus propios campos — no hay que tocar
-- Uniformes ni las secciones genéricas que ya existan.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.inventario_categorias
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'generico';

-- La sección "Uniformes" que ya existe queda marcada con su propio tipo
-- (informativo por ahora — su comportamiento sigue siendo el de siempre).
UPDATE public.inventario_categorias SET tipo = 'uniformes' WHERE clave = 'uniformes';

ALTER TABLE public.inventario_items
  ADD COLUMN IF NOT EXISTS atributos JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ── Verificación final ──
SELECT clave, nombre, tipo, es_sistema FROM public.inventario_categorias ORDER BY orden;
