# Correcciones: Reintegro (visual, agencias, factura) y bloqueo de edición

**No requiere ninguna migración SQL** — todos estos cambios son de
backend (Node) y de la pantalla de Boletaje.

## 1. El asiento no se veía "ocupado" tras un Reintegro

Eran dos mapas de estado→color/ícono en el JS que nunca se
actualizaron para el estado `reintegro` (se agregó cuando implementamos
la función, pero se me pasó actualizar estos dos puntos puntuales):
- El color de fondo del asiento caía a "libre" por defecto.
- El ícono de "persona sentada" (ocupado) solo se mostraba para
  `vendido`.

Ya corregido — el asiento de un reintegro se pinta morado con su
ícono de ocupado, igual que uno vendido.

## 2. Impresión automática al generar el Reintegro

Ahora, igual que en una venta normal, al aceptar el reintegro se abre
la ventana de impresión automáticamente (ya no hace falta darle clic
a "Imprimir" aparte).

## 3. Edad, Teléfono, Agencias y Factura en el modal de Reintegro

Rediseñé el modal:

- Nuevo botón **"Buscar"** junto a Serie/Correlativo: trae los datos
  del boleto original (nombre, documento, edad, teléfono, agencias,
  RUC/razón social si tenía) y muestra una vista previa de
  confirmación.
- **Agencia de Embarque / Agencia de Destino**: ahora son
  desplegables con las agencias de la salida que elegiste. Si el
  boleto original tenía una agencia que también existe en esta
  salida, se preselecciona sola — pero la puedes cambiar libremente.
- **Cambio de Nombre**: ahora sí incluye **Edad** y **Teléfono**
  (antes no existían esos campos en el formulario). Al buscar el
  boleto original, se precargan con sus datos como punto de partida,
  pero quedan editables.
- **Factura (opcional)**: agregué RUC y Razón Social — si llenas el
  RUC, el nuevo comprobante sale como factura; si lo dejas vacío,
  sale como boleta. (La búsqueda automática de razón social por RUC
  no existe todavía en ningún otro punto del sistema — los botones
  "Buscar" de RUC/DNI del formulario principal son un placeholder sin
  conectar —, así que por ahora se completa a mano, igual que ahí.)

## 4. Habilitar y Reintegro ya no se pueden usar sobre un asiento ocupado

Si el asiento ya tiene un boleto activo (vendido, reservado o
reintegro), los botones **Habilitar** y **Reintegro** quedan
deshabilitados — solo quedan disponibles Imprimir, Anular, Postergar
y Guardar. Esto se valida tanto en pantalla como en el servidor (por
si alguien intenta forzarlo).

## 5. Ya no se puede editar el pasajero de un boleto ya emitido

Una vez que un asiento tiene un boleto activo, los campos de Nombre,
Tipo/Número de Documento, Edad, Teléfono, RUC y Razón Social quedan
bloqueados (solo lectura) en el formulario principal — para corregir
esos datos ahora existe **Reintegro** (opción 2, Cambio de Nombre),
que además deja un rastro trazable del cambio. Esto también se
refuerza en el servidor: aunque alguien fuerce el campo desde el
navegador, el backend ignora esos valores y conserva los que ya
tenía el boleto.

## 6. Leyenda de colores simplificada

Ahora solo muestra: **Libre, Reservado, Transferido de otra empresa,
Reintegro** (se quitaron "Vendido" y "Postergado" de la leyenda, tal
como pediste).

---

## Archivos modificados

- `routes/boletaje.js` (nuevo endpoint `/origen-reintegro`, validaciones de asiento ocupado, protección de identidad del pasajero)
- `views/boletaje/index.hbs` (modal de Reintegro rediseñado, fix de color/ícono, impresión automática, bloqueo de campos, leyenda)
- `public/css/pages.css` (estilos de la vista previa y de los campos bloqueados)
