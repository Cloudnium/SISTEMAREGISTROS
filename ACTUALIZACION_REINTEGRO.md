# Nueva funcionalidad: Reintegro

## Cómo aplicar en tu base de datos

Ejecuta en el SQL Editor de Supabase (es la **migración #30**, después de
`FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql`):

**`REINTEGRO_MIGRATION.sql`** ⭐ nuevo

## Qué hace

Al presionar **Reintegro** en Venta de Asientos, se abre una ventana
con el mismo diseño que me mostraste:

- **Boleto a procesar**: serie y correlativo del boleto **original**
  (debe estar `postergado` o `reservado` — no se puede procesar uno ya
  vendido, anulado o ya usado en otro reintegro/habilitación).
- **1.- Reintegro por Variación de Precio (Cambio de Servicio)**: el
  nuevo boleto se emite con **los mismos datos del pasajero** del
  original. El precio es editable.
- **2.- Cambio de Nombre o Pérdida de Boleto**: además del precio,
  puedes editar **nombre y documento** del nuevo pasajero.
- Antes de guardar, te pregunta **"¿Estás seguro de emitir este boleto
  de reintegro?"**.

En ambos casos:
- Se emite un **boleto/factura NUEVO**, con numeración propia de la
  empresa del bus **actual** (funciona igual si es la misma empresa
  del boleto original o una distinta — como con Habilitar).
- El boleto **original** queda con estado **`usado`**, enlazado al
  nuevo.
- El boleto **nuevo** queda con estado **`reintegro`** (no
  `vendido`), para diferenciarlo. El asiento se pinta de **morado**
  en el mapa de asientos, con su propia leyenda.
- Si el original tenía un código de autorización aplicado, se
  traslada al nuevo boleto.
- Postergar y Anular ya reconocen el estado `reintegro` como una
  venta activa (se pueden postergar/anular igual que un boleto
  normal).

## Comprobantes

- El filtro **Estado** ahora incluye **Reintegro**.
- El badge de estado "Reintegro" se ve en color morado; el boleto
  original queda como "Usado", con el enlace `→ SERIE-CORRELATIVO`
  hacia el nuevo (esto ya lo teníamos armado desde Habilitar, y
  funciona igual para Reintegro).

## Consulta de Documentos

El historial de movimientos ahora también reconoce **REINTEGRO** como
un tipo de movimiento más (aparece en el cuadro de movimientos con su
propio color), y el estado se muestra correctamente si consultas el
boleto nuevo o el original.

## Limpieza General

`LIMPIEZA_GENERAL.sql` **ya cubre** los datos de Reintegro sin
necesidad de cambios adicionales — el Reintegro no crea tablas
nuevas, reutiliza `boletos` (se limpia), `boletos_movimientos` (se
limpia) y los correlativos de `series_agencia_empresa` (se reinician
a 0), que ya estaban contemplados. Solo actualicé el comentario del
script para que quede explícito.

---

## Archivos nuevos/modificados

- **Nuevo:** `SQL/REINTEGRO_MIGRATION.sql`
- `routes/boletaje.js` (acción `reintegro`, reglas de postergar/anular)
- `views/boletaje/index.hbs` (modal de Reintegro, color morado, botones)
- `public/css/pages.css` (estilos del modal y del asiento morado)
- `routes/comprobantes.js` / `views/comprobantes/index.hbs` (filtro y badge)
- `routes/consulta-documentos.js` / `views/consulta-documentos/index.hbs` (historial)
- `SQL/LIMPIEZA_GENERAL.sql` (comentario actualizado)
