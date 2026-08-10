# Orden de ejecución de los SQL (para replicar la BD desde cero)

El orden se determinó revisando cada `REFERENCES` (llave foránea) y cada
`ALTER TABLE ... ADD COLUMN` que depende de columnas creadas en otro
archivo. Ejecuta cada uno en el SQL Editor de Supabase, en este orden:

| # | Archivo | Por qué va ahí |
|---|---------|----------------|
| 1 | `SUPABASE_SETUP.sql` | Base: `usuarios`, `combustible_registros`, `personal_empleados`, `inventario_productos/movimientos`, `estaciones`, `placas`. No depende de nada. |
| 2 | `SERVICIOS_SETUP.sql` | Tabla `servicios`, independiente. |
| 3 | `CIUDADES_AGENCIAS_SETUP.sql` | Tablas `ciudades` y `agencias`, independiente. |
| 4 | `AGENCIA_COLOR_MIGRATION.sql` | Agrega `agencias.color` → requiere `agencias` (#3). |
| 5 | `BUSES_SETUP.sql` | `buses.servicio_id` → requiere `servicios` (#2). |
| 6 | `BUSES_EMPRESA_MIGRATION.sql` | Agrega `buses.empresa_razon_social/empresa_ruc` → requiere `buses` (#5). |
| 7 | `EMPRESAS_SETUP.sql` | Crea `empresas` y `buses.empresa_id`; migra los datos de texto libre de #6 → requiere `buses` + columnas de #6. |
| 8 | `PERSONAL_SETUP.sql` | Tabla `personal_tripulantes`, independiente. |
| 9 | `DESTINOS_SETUP.sql` | `destinos` referencia `ciudades` y `agencias` → requiere #3. |
| 10 | `DESTINO_CIUDADES_ADICIONALES_MIGRATION.sql` | Requiere `destinos` (#9) y `ciudades` (#3). |
| 11 | `MAPA_ASIENTOS_SETUP.sql` | `bus_config_asientos`/`bus_asientos` referencian `buses` → requiere #5. |
| 12 | `MAPA_ASIENTOS_PASILLO_MIGRATION.sql` | Agrega columnas a `bus_config_asientos` → requiere #11. |
| 13 | `MAPA_ASIENTOS_ESCALERA_MIGRATION.sql` | Agrega columnas a `bus_asientos` → requiere #11. |
| 14 | `PROGRAMACION_SETUP.sql` | `programaciones` referencia `destinos`, `servicios`, `buses`, `personal_tripulantes`, `agencias` → requiere #2, #3, #5, #8, #9. |
| 15 | `BOLETOS_SETUP.sql` | `boletos` referencia `programaciones`, `agencias`, `usuarios` → requiere #1, #3, #14. |
| 16 | `SERIES_AGENCIA_PERMISOS_MIGRATION.sql` | Agrega series/correlativos a `agencias`, permisos y `agencia_id` a `usuarios`, columnas `serie`/`correlativo` a `boletos` → requiere #1, #3, #15. |
| 17 | `CODIGOS_AUTORIZACION_SETUP.sql` | Crea `codigos_autorizacion` y agrega `boletos.codigo_usado` → requiere #1 (usuarios) y #15 (boletos). |
| 18 | `VENTA_ATOMICA_MIGRATION.sql` | Función `registrar_venta_asiento` (versión inicial) → requiere #15, #16, #17. *(Queda sobrescrita por #20 y #26; se incluye por completitud histórica.)* |
| 19 | `COMPROBANTES_MIGRATION.sql` | Agrega `metodo_pago`, `anulado_por`, `anulado_en` a `boletos` → requiere #15, #1. |
| 20 | `SERIES_BOLETA_FACTURA_MIGRATION.sql` | Reemplaza `registrar_venta_asiento` (agrega boleta vs. factura) → requiere #16, #18. |
| 21 | `CROQUIS_MANIFIESTO_MIGRATION.sql` | Agrega `ayudante_id`/`manifiesto_*` a `programaciones`, `embarco_*` a `boletos`, tabla `contador_manifiestos` y función `obtener_o_generar_manifiesto` → requiere #14, #8, #1, #15. |
| 22 | `FIX_MANIFIESTO_AMBIGUOUS_MIGRATION.sql` | Corrige la función de #21 → requiere #21. |
| 23 | `PERMISOS_PRECIOS_PROGRAMACION_MIGRATION.sql` | Agrega `puede_editar_precios`/`puede_programar` a `usuarios` → requiere #1. |
| 24 | `CHAT_SETUP.sql` | `chat_mensajes` + `usuarios.ultima_actividad` → requiere #1. |
| 25 | `CHAT_GRUPOS_SETUP.sql` | `chat_grupos` y relacionadas → requiere #1. |
| 26 | **`CODIGOS_USO_UNICO_MIGRATION.sql`** ⭐ *(nuevo, agregado en esta revisión)* | Agrega uso único a los códigos de autorización y vuelve a reemplazar `registrar_venta_asiento` → requiere #17 y #20. **Debe ir al final de todo lo anterior.** |

**No forma parte del setup:** `LIMPIEZA_GENERAL.sql` es un script
operativo que **borra** datos transaccionales (ventas, programación,
chat) y reinicia correlativos a 0. Solo se corre manualmente cuando se
quiera dejar el sistema en blanco para empezar a operar — nunca al
replicar/instalar la base de datos.

---

# Cambios de seguridad implementados

## 1. Servicios, Buses, Ciudades/Agencias y Destinos → crear/editar SOLO admin

Antes, `editar` y `eliminar` ya estaban restringidos a admin, pero
**crear** estaba abierto a cualquier usuario autenticado. Se corrigió:

- `middleware/auth.js`: nuevo middleware `requireAdminToCreate`.
- `routes/servicios.js`: `POST /` ahora requiere admin.
- `routes/buses.js`: `POST /` ahora requiere admin.
- `routes/ciudades.js`: `POST /ciudad` y `POST /agencia` ahora requieren admin.
- `routes/destinos.js`: `POST /` (crear destino), `POST /:id/ciudad-adicional`
  y `POST /:id/ciudad-adicional/:ciudadId/eliminar` (agregar/quitar
  ciudades adicionales de una ruta, que es edición de un destino
  existente) ahora requieren admin.
- Vistas (`servicios`, `buses`, `ciudades`, `destinos`): los botones y
  formularios de "crear" ahora están envueltos en `{{#if isAdmin}}`,
  para que un usuario sin permiso ni siquiera los vea (la protección
  real sigue estando en el backend).

## 2. Códigos de autorización → ventana solo para admin / autorizados, uso abierto a todos

- La ventana completa `GET /codigos` (verla, crear, activar/desactivar)
  ahora exige `admin` o el permiso `puede_crear_codigos` (ya existía
  ese permiso por usuario; solo faltaba aplicarlo también al `GET`, no
  solo al `POST`).
- El sidebar (`views/partials/sidebar.hbs`) oculta el enlace
  "Códigos de Autorización" a quien no tenga acceso, usando la nueva
  variable global `res.locals.puedeCrearCodigos` (agregada en `app.js`).
- `GET /codigos/validar/:codigo` sigue abierto a **cualquier usuario
  autenticado**, porque es el endpoint que usa la pantalla de venta de
  boletos (Boletaje) para aplicar el código al vender — no pasa por la
  ventana administrativa.

## 3. Códigos de autorización → uso único por boleto emitido

Antes, un código podía reutilizarse en cualquier cantidad de boletos: la
columna `boletos.codigo_usado` solo era un texto de referencia, sin
ninguna validación real. Se corrigió de raíz, a nivel de base de datos
(no solo en el backend, para blindarlo contra condiciones de carrera):

- Nueva migración `SQL/CODIGOS_USO_UNICO_MIGRATION.sql`:
  - Agrega a `codigos_autorizacion`: `usado`, `usado_en`, `usado_en_boleto_id`.
  - Reescribe `registrar_venta_asiento` (la función que hace la venta
    atómica) para que, dentro de la misma transacción: bloquee
    (`FOR UPDATE`) la fila del código, y si no existe, está inactivo o
    ya fue usado, **rechace la venta completa** (`RAISE EXCEPTION`);
    si es válido, lo marca como usado por ese boleto específico.
  - Agrega un trigger (`trg_liberar_codigo_si_boleto_anulado`) que
    libera automáticamente el código cuando el boleto que lo usó se
    **anula** — un boleto anulado no debe dejar "quemado" un código
    que nunca se llegó a emitir de verdad.
- `routes/codigos.js`: `GET /codigos/validar/:codigo` ahora también
  rechaza códigos ya usados (antes solo miraba `activo`), para dar
  el aviso inmediato al vendedor antes de intentar guardar.
- `routes/boletaje.js`:
  - Traduce los nuevos errores de la función SQL
    (`CODIGO_INVALIDO`, `CODIGO_INACTIVO`, `CODIGO_YA_USADO`) a
    mensajes claros para el usuario.
  - **Cierre de un caso borde:** las acciones que no pasan por la venta
    atómica (anular / reservar / postergar / **habilitar**) ya no
    aceptan un `codigo_usado` enviado por el cliente — conservan el
    que ya tuviera el boleto. Esto evita que "Habilitar" (registro
    manual de serie/correlativo) pudiera colarse con un código sin
    pasar por la validación de uso único.

### Cómo aplicar estos cambios en tu base de datos existente

Si ya tienes la BD corriendo, **solo necesitas ejecutar el archivo
nuevo** `SQL/CODIGOS_USO_UNICO_MIGRATION.sql` en el SQL Editor de
Supabase (ya incluye el `NOTIFY pgrst, 'reload schema'` y es seguro
ejecutarlo aunque ya existan las tablas/columnas). No hace falta volver
a correr los demás.
