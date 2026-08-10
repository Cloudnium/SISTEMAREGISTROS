# Actualización: Multiempresa (series, comprobantes, logo, transferencias)

## Cómo aplicar en tu base de datos

Ejecuta en el SQL Editor de Supabase, en este orden (si ya tenías todo
lo anterior corriendo, solo te falta el último):

1. `CODIGOS_USO_UNICO_MIGRATION.sql` (si no lo habías corrido ya)
2. **`MULTIEMPRESA_SERIES_MIGRATION.sql`** ⭐ nuevo

Después de correrlo, entra a **Ciudades y Agencias** y revisa, para
cada agencia, el botón **"Series"**: la migración adivina a qué
empresa pertenecía la numeración que ya tenías (la que tiene más
buses activos) y le asigna tu serie/correlativo actual — confírmalo o
corrígelo, y configura la serie de las demás empresas que vendan
desde esa agencia.

También entra a **Empresas** y sube el **logo** y confirma
**Domicilio Fiscal** de cada una (antes no existían estos campos).

---

## 1. Series de boletos/facturas — ahora por Agencia **+** Empresa

- Nueva tabla `series_agencia_empresa`: cada combinación
  agencia↔empresa tiene su propia serie y correlativo de boletos, y
  su propia serie y correlativo de facturas.
- La venta (`registrar_venta_asiento`) ya no incrementa el correlativo
  de la agencia a secas — identifica la empresa dueña del **bus** de
  esa salida y usa/incrementa la serie de esa combinación específica.
- Nueva pantalla: en **Ciudades y Agencias**, cada fila de agencia
  tiene un botón **"Series"** que abre una tabla editable con todas
  las empresas activas, para configurar/corregir serie y correlativo
  de boletos y facturas de cada una.
- Se quitaron los campos de serie del alta/edición de agencia (ya no
  tiene sentido una sola serie por agencia).

## 2. Boletos y facturas con los datos reales de la empresa del bus

- `boletos.empresa_id` guarda con qué empresa se emitió cada boleto
  (tomada del bus de la programación al momento de la venta).
- El croquis de asientos (Boletaje) y el listado de Comprobantes ahora
  incluyen los datos de esa empresa (RUC, Razón Social, Domicilio
  Fiscal) y se los pasan al momento de imprimir.
- `public/js/comprobante-print.js` ya no tiene una empresa fija
  ("LINEA PERUANA COMPANY S.A.C." hardcodeada) — imprime la empresa
  real del bus de cada boleto.

## 3. Logo por empresa

- `empresas.logo_data_url` (imagen en base64, máx. ~500 KB, PNG/JPG/WEBP/SVG).
- En **Empresas** puedes subir/quitar el logo (con vista previa) al
  crear o editar una empresa.
- El comprobante impreso muestra el logo arriba de la Razón Social,
  si la empresa tiene uno cargado.
- Se subió el límite del body del servidor a 2 MB (`app.js`) para que
  la imagen quepa en el formulario.

## 4. Postergar / Anular ya no aplican a cualquier estado

- **Postergar**: solo si el asiento está `vendido`.
- **Anular**: solo si el asiento tiene algo que anular (`vendido`,
  `reservado` o `postergado`) — un asiento libre, ya anulado, o ya
  "usado" (ver punto 5) no se puede volver a anular.
- **Reservar**: solo si el asiento está libre (o previamente anulado)
  — no se puede reservar encima de uno ya ocupado.
- Esto se valida tanto en el backend (`routes/boletaje.js`) como en la
  pantalla (los botones se deshabilitan automáticamente según el
  estado del asiento seleccionado, además de por permisos).
- **Comprobantes** ya no muestra reservas que nunca se llegaron a
  vender (se filtran los boletos sin serie/correlativo, que son
  justamente los que nunca tuvieron un comprobante real). El botón
  "Anular" de Comprobantes también exige que el registro esté
  `vendido`.

## 5. Activar (Habilitar) un boleto de otra empresa

Nueva función `activar_boleto_manual()` que reemplaza el
INSERT/UPDATE manual que hacía "Habilitar":

- Si la serie/correlativo que ingresas **no existe** en el sistema →
  se registra tal cual (boleto emitido fuera del sistema), como antes.
- Si existe y es de la **misma empresa** del bus actual → se reasigna
  tal cual al asiento elegido (igual que antes).
- Si existe pero es de **otra empresa** → **no** se reutiliza ese
  número: se genera un boleto **nuevo** con la numeración propia de la
  empresa del bus actual (copiando los datos del pasajero), y el
  boleto **original** queda con estado `usado`, enlazado
  (`activado_desde_boleto_id`) al nuevo. El código de autorización, si
  tenía uno, se traslada también al nuevo boleto.
- El boleto original solo se puede activar así si está `postergado` o
  `reservado` (no se puede "reactivar" uno ya vendido en otro lado, ni
  uno anulado, ni uno ya usado antes).
- El asiento que recibió la transferencia se pinta de **negro** en el
  mapa de asientos (con su propia leyenda: "Transferido de otra
  empresa"), y todo esto queda reflejado en Comprobantes (el original
  aparece como `usado`, el nuevo como el comprobante vigente).

---

## Archivos nuevos/modificados

- **Nuevo:** `SQL/MULTIEMPRESA_SERIES_MIGRATION.sql`
- `routes/boletaje.js`, `routes/comprobantes.js`, `routes/empresas.js`, `routes/ciudades.js`
- `public/js/comprobante-print.js`
- `views/boletaje/index.hbs`, `views/comprobantes/index.hbs`, `views/empresas/index.hbs`, `views/ciudades/index.hbs`
- `public/css/pages.css` (estilo del asiento "transferido")
- `app.js` (límite de body a 2 MB para el logo)

## Limitación conocida / a revisar

La migración **adivina automáticamente** a qué empresa pertenecía la
serie que ya tenías por agencia (usa la empresa con más buses activos
en ese momento). Si una agencia vendía para más de una empresa antes
de esta actualización, revisa manualmente en **Ciudades y Agencias →
Series** que el correlativo haya quedado en la empresa correcta, y
configura las series de las demás empresas para esa agencia.
