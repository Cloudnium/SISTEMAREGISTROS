# Orden de ejecución de los SQL — SISTEMAREGISTROS

Este documento se actualiza cada vez que agregamos una migración nueva.
Si vas a **replicar la base de datos desde cero**, corre los archivos
en este orden exacto (de arriba hacia abajo) en el SQL Editor de
Supabase. Si ya tienes la BD funcionando y solo quieres **ponerte al
día**, corre únicamente los que te falten (los últimos de la lista;
usa la fecha del archivo o pregúntame "qué me falta" y reviso contigo).

| # | Archivo | Qué hace / por qué va ahí |
|---|---------|----------------------------|
| 1 | `SUPABASE_SETUP.sql` | Base: `usuarios`, combustible, personal, inventario, estaciones, placas. No depende de nada. |
| 2 | `SERVICIOS_SETUP.sql` | Tabla `servicios` (Black, Ejecutivo, etc.). |
| 3 | `CIUDADES_AGENCIAS_SETUP.sql` | Tablas `ciudades` y `agencias`. |
| 4 | `AGENCIA_COLOR_MIGRATION.sql` | Agrega `agencias.color`. |
| 5 | `BUSES_SETUP.sql` | Tabla `buses` (requiere servicios, #2). |
| 6 | `BUSES_EMPRESA_MIGRATION.sql` | Agrega texto libre de empresa a `buses` (paso previo a #7). |
| 7 | `EMPRESAS_SETUP.sql` | Tabla `empresas` + `buses.empresa_id`. |
| 8 | `PERSONAL_SETUP.sql` | Tabla `personal_tripulantes`. |
| 9 | `DESTINOS_SETUP.sql` | Tabla `destinos` (requiere ciudades/agencias, #3). |
| 10 | `DESTINO_CIUDADES_ADICIONALES_MIGRATION.sql` | Ciudades adicionales de una ruta. |
| 11 | `MAPA_ASIENTOS_SETUP.sql` | `bus_config_asientos` / `bus_asientos` (requiere buses, #5). |
| 12 | `MAPA_ASIENTOS_PASILLO_MIGRATION.sql` | Configuración de pasillo. |
| 13 | `MAPA_ASIENTOS_ESCALERA_MIGRATION.sql` | Configuración de escalera (segundo piso). |
| 14 | `PROGRAMACION_SETUP.sql` | Tabla `programaciones` (requiere destinos, servicios, buses, personal, agencias). |
| 15 | `BOLETOS_SETUP.sql` | Tabla `boletos` (requiere programaciones, agencias, usuarios). |
| 16 | `SERIES_AGENCIA_PERMISOS_MIGRATION.sql` | Series/correlativos iniciales por agencia + permisos de usuario (anular/postergar/reservar/habilitar). |
| 17 | `CODIGOS_AUTORIZACION_SETUP.sql` | Tabla `codigos_autorizacion` + `boletos.codigo_usado`. |
| 18 | `VENTA_ATOMICA_MIGRATION.sql` | Función `registrar_venta_asiento` (versión inicial — queda sobrescrita más adelante, se corre por completitud histórica). |
| 19 | `COMPROBANTES_MIGRATION.sql` | `metodo_pago`, `anulado_por`, `anulado_en` en `boletos`. |
| 20 | `SERIES_BOLETA_FACTURA_MIGRATION.sql` | Boleta vs. Factura según RUC; reemplaza `registrar_venta_asiento`. |
| 21 | `CROQUIS_MANIFIESTO_MIGRATION.sql` | Manifiesto de viaje, ayudante, embarque marcado. |
| 22 | `FIX_MANIFIESTO_AMBIGUOUS_MIGRATION.sql` | Corrige un bug de la función del manifiesto. |
| 23 | `PERMISOS_PRECIOS_PROGRAMACION_MIGRATION.sql` | Permisos `puede_editar_precios` / `puede_programar`. |
| 24 | `CHAT_SETUP.sql` | Chat interno. |
| 25 | `CHAT_GRUPOS_SETUP.sql` | Grupos de chat. |
| 26 | `CODIGOS_USO_UNICO_MIGRATION.sql` | Un código de autorización solo se puede usar **una vez**; reemplaza `registrar_venta_asiento`. |
| 27 | `MULTIEMPRESA_SERIES_MIGRATION.sql` | Series de boletos/facturas **por agencia + empresa** (ya no solo por agencia); `boletos.empresa_id`; logo de empresa; transferencia de boletos entre empresas al Habilitar (estado `usado`). |
| 28 | `SERIES_DOBLE_HISTORIAL_MIGRATION.sql` | Corrige bug de columna ambigua en Habilitar; agrega **Serie Boleto 1 / Boleto 2** por empresa con selector de cuál está activa; historial de movimientos de cada boleto (`boletos_movimientos`); restricción de que serie+correlativo no se repita en todo el sistema. |
| 29 | `FIX_HABILITAR_DATOS_Y_PERMISOS_MIGRATION.sql` | Habilitar entre empresas copia todos los datos del pasajero original; permiso `puede_reintegro`. |
| 30 | `REINTEGRO_MIGRATION.sql` | Nuevo estado `reintegro` y función `procesar_reintegro`: emite un boleto nuevo a partir de uno postergado/reservado (por variación de precio o cambio de nombre), dejando el original como `usado`. |
| 31 | `FIX_POSTERGAR_DESVINCULADO_MIGRATION.sql` | Corrige el bug de "Acción no reconocida" en Reintegro; y corrige que al postergar/anular/usar un boleto, el asiento quedaba enlazado a esa fila para siempre (una venta nueva le "robaba" la serie al boleto postergado) — ahora solo puede haber un boleto ACTIVO (vendido/reservado/reintegro) por asiento, y postergado/anulado/usado quedan como historial totalmente desvinculado. |
| 32 | `FIX_NUMERO_LIBRE_MIGRATION.sql` | Corrige "duplicate key value violates unique constraint idx_boletos_serie_correlativo_unico" al hacer Reintegro (o Habilitar entre empresas): nueva función `siguiente_numero_boleto()` que siempre verifica que el número generado esté realmente libre antes de usarlo, evitando choques con boletos ingresados a mano por Habilitar. |

**No forma parte del setup:** `LIMPIEZA_GENERAL.sql` es un script
operativo que **borra** datos transaccionales (ventas, programación,
códigos, historial de movimientos, chat) y reinicia a 0 todas las
series/correlativos (Boleto 1, Boleto 2, Factura y manifiestos) — **sin
tocar usuarios ni nada de combustible**. Solo se corre manualmente
cuando se quiera dejar el sistema en blanco — nunca al
replicar/instalar la base de datos, y nunca junto con los demás.
*(Se reescribió el 1/ago para reflejar todas las tablas nuevas de esta
conversación; si ya tenías una copia vieja de este archivo,
reemplázala por la nueva.)*

---

## Recomendación para copias de seguridad

Antes de correr cualquier migración nueva en tu base de datos de
producción, lo más seguro es:

1. En Supabase → **Database → Backups**, genera un backup manual (o
   usa el más reciente automático) antes de aplicar la migración.
2. Corre la migración nueva en un proyecto de prueba primero si tienes
   uno, o al menos en horario de bajo tráfico.
3. Guarda cada archivo `.sql` que te vaya entregando en una carpeta
   ordenada (por ejemplo, tal cual los nombro yo) — así este mismo
   documento te sirve de checklist para saber cuáles ya corriste.

De aquí en adelante, cada vez que te entregue una migración SQL nueva,
te la voy a numerar como **continuación de esta lista** (la próxima
sería la #30), así siempre sabes el orden exacto sin tener que
adivinar por fecha de archivo.
