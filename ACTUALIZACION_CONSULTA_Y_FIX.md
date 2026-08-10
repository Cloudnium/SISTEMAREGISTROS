# Actualización: fix de Habilitar, Consulta de Documentos, Reintegro y doble serie

## Cómo aplicar en tu base de datos

Ejecuta en el SQL Editor de Supabase (en este orden, si te falta alguna):

1. `CODIGOS_USO_UNICO_MIGRATION.sql`
2. `MULTIEMPRESA_SERIES_MIGRATION.sql`
3. **`SERIES_DOBLE_HISTORIAL_MIGRATION.sql`** ⭐ nuevo

## 1. Fix: "column reference serie is ambiguous" al Habilitar

La función `activar_boleto_manual()` comparaba `serie = ...` y
`correlativo = ...` sin indicar de qué tabla, y esos mismos nombres
son también las columnas que la función devuelve (`RETURNS
TABLE(serie, correlativo, ...)`) — Postgres no podía saber si te
referías a la columna de la tabla `boletos` o a la de salida. Se
corrigió indicando siempre `public.boletos.serie` /
`public.boletos.correlativo`. Sigue funcionando igual que antes: se
puede habilitar con un boleto de la misma empresa o de otra (con la
transferencia automática ya explicada en la actualización anterior).

## 2. Nueva sección: Consulta de Documentos

Nuevo módulo en el sidebar (`/consulta-documentos`, sección Módulos):

- **Búsqueda por Empresa + Serie + Correlativo** ("Boletos de Viaje"):
  trae el boleto/factura y llena automáticamente todo el panel de
  abajo (pasajero, identidad, facturación, viaje, datos
  administrativos).
- **Búsqueda por D.N.I.** (botón de lupa): abre una ventana donde
  ingresas el D.N.I. (y opcionalmente rango de fechas de viaje) y
  te muestra **todos** los boletos/facturas de ese pasajero, sin
  importar en qué empresa compró. Al seleccionar una fila de la
  lista, se llena automáticamente todo el panel principal (empresa,
  serie, correlativo, movimientos y todos los datos del pasajero y
  su viaje) — igual que pediste.
- **Cuadro de Movimientos**: ya no es un texto fijo — muestra el
  **historial real y completo** de cada documento: venta, reserva,
  postergación, habilitación, anulación y, si corresponde,
  transferencia entre empresas (incluye también los movimientos del
  boleto "original" cuando el actual proviene de una transferencia).

Este historial se registra automáticamente en la base de datos con un
trigger (`registrar_movimiento_boleto`) sobre la tabla `boletos`, así
que funciona sin importar por qué pantalla se haya hecho el cambio
(Boletaje, RPC de venta, Habilitar, etc.) — no depende de que cada
ruta del backend recuerde llamarlo.

**Nota:** para que la búsqueda por serie/correlativo sea siempre
inequívoca, la migración agrega una restricción de unicidad global
(`serie + correlativo` no se puede repetir en todo el sistema). Si
tuvieras datos antiguos duplicados, la migración te lo va a señalar
al querer crear ese índice — avísame si pasa eso para ayudarte a
limpiarlos primero.

## 3. Botón "Reintegro" en Venta de Asientos

Se agregó el botón junto a "Habilitar", con su propio color para
diferenciarlo. Por ahora solo muestra un aviso de "función en
desarrollo" al presionarlo — está listo para que me indiques qué
debe hacer y lo conectamos.

## 4. Doble serie de boletos por Agencia + Empresa

En **Ciudades y Agencias → Series** ahora cada empresa tiene:

- **Serie Boleto 1** + su correlativo
- **Serie Boleto 2** + su correlativo
- **Serie Factura** + su correlativo (sin duplicar — las facturas
  siempre usan la misma serie configurada, como pediste)
- Un selector **"Activa"** (Boleto 1 / Boleto 2) — el que elijas es
  el que se usa automáticamente la próxima vez que se venda un
  boleto (no factura) para esa agencia y esa empresa. Puedes
  cambiarlo en cualquier momento (por ejemplo, cuando se termine el
  talonario físico de la Serie 1 y empiecen a usar la Serie 2).

---

## Archivos nuevos/modificados

- **Nuevo:** `SQL/SERIES_DOBLE_HISTORIAL_MIGRATION.sql`
- **Nuevo:** `routes/consulta-documentos.js`
- **Nuevo:** `views/consulta-documentos/index.hbs`
- `routes/ciudades.js` (series con Boleto 1/Boleto 2 y selector)
- `views/ciudades/index.hbs` (modal Series ampliado)
- `views/boletaje/index.hbs` (botón Reintegro)
- `public/css/pages.css` (estilo del botón Reintegro)
- `views/partials/sidebar.hbs` (enlace a Consulta de Documentos)
- `app.js` (registro de la nueva ruta)
