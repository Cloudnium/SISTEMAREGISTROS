# Correcciones y mejoras: Habilitar, asiento negro/gris, Consulta de Documentos, permisos

## Cómo aplicar en tu base de datos

Ejecuta en el SQL Editor de Supabase (después de las anteriores):

**`FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql`** ⭐ nuevo

## 1. Habilitar entre empresas ahora SÍ copia los datos del pasajero

`activar_boleto_manual()` ahora copia del boleto original — cuando lo
encuentra, sea de la misma empresa o de otra — **todos** sus datos:
nombre, documento, edad, teléfono, RUC/razón social, **agencia de
embarque** y **agencia de llegada**. Antes solo se guardaba lo que
hubiera en el formulario (normalmente vacío), por eso no aparecían.
El precio y método de pago se siguen tomando del formulario (pueden
cambiar según el asiento/bus nuevo).

## 2. Fix: asiento se veía "libre pero gris" al postergar un boleto transferido

El marcador negro de "boleto transferido de otra empresa" se quedaba
pegado al asiento aunque después lo postergaras o anularas — y
combinado con la transparencia del estado "postergado", se veía como
un gris confuso (parecía libre, pero con datos raros). Ahora el color
negro solo se muestra mientras el boleto esté **vendido activamente**;
si se postergó, anuló, etc., se ve igual que cualquier otro boleto en
ese estado (gris normal de postergado, rojo de vendido, etc.) — sin
mezclar los dos estilos.

## 3. Consulta de Documentos: rediseño visual

Se rediseñó toda la pantalla con tarjetas, iconos, mejor tipografía y
un layout más ordenado en vez del formulario plano anterior. También
se separó claramente la búsqueda (Empresa / Boleto de Viaje / D.N.I.)
del detalle del documento.

## 4. Movimientos del documento: ahora muestra usuario, fecha y hora, todo corrido

Antes: `VENTA-EFECTIVO Jul 31 2026 04:01AM/` (sin usuario).

Ahora, exactamente como pediste:

```
VENTA ANDREE 20 JUL 2026 20:00 / POSTERGADO BRYAN 21 JUL 2026 03:00 / HABILITADO ARENAS 25 JUL 2026 15:15 / ANULADO ROCIO 30 JUL 2026 16:40
```

Cada movimiento muestra el tipo, el primer nombre del usuario que lo
hizo, y fecha/hora — todo en una sola línea corrida, con separadores
"/", y con color según el tipo de movimiento para que se lea de un
vistazo.

## 5. Comprobantes: se ve a qué boleto quedó vinculado un "Usado"

Cuando un comprobante quedó en estado **Usado** (porque su serie se
activó/transfirió hacia otro boleto), ahora se muestra debajo del
badge del estado a qué comprobante nuevo quedó vinculado (ej. `→
B002-00000045`), para poder rastrearlo.

## 6. Filtro de Comprobantes: se agregó el estado "Usado"

El desplegable "Estado" en Comprobantes ahora incluye la opción
**Usado (transferido)** para poder buscar específicamente esos
registros.

## 7. Nuevo permiso: "Puede usar Reintegro"

Se agregó al formulario de usuarios (Permisos sobre boletos vendidos),
igual que los demás permisos (anular, postergar, reservar, habilitar).
El botón "Reintegro" en Venta de Asientos ahora respeta este permiso
(se deshabilita si el usuario no lo tiene, igual que los otros
botones) — sigue siendo un botón "en desarrollo" hasta que definas su
funcionalidad.

---

## Archivos modificados

- `SQL/FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql` (nuevo)
- `routes/usuarios.js`, `routes/auth.js`, `utils/permisos.js`, `routes/boletaje.js` (permiso puede_reintegro)
- `views/usuarios/form.hbs` (checkbox del nuevo permiso)
- `views/boletaje/index.hbs` (fix del asiento negro/gris + permiso Reintegro)
- `routes/comprobantes.js`, `views/comprobantes/index.hbs` (vínculo "usado en", filtro Usado)
- `routes/consulta-documentos.js`, `views/consulta-documentos/index.hbs` (rediseño + movimientos con usuario)
- `public/css/pages.css` (badge de estado "usado")
