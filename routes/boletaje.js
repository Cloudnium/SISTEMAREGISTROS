// =============================================
// routes/boletaje.js — Boletaje e Itinerarios
// Muestra programaciones filtradas por fecha y destino
// con sus escalas, tarifas, bus y servicio
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

router.get('/', requireAuth, async (req, res) => {
  const { fecha, destino_id } = req.query;

  // Siempre carga la lista de destinos para el filtro
  const { data: destinos } = await db.select('destinos',
    'select=id,ciudad_origen,ciudad_destino,' +
    'ciudades_origen:ciudades!ciudad_origen(nombre),' +
    'ciudades_destino:ciudades!ciudad_destino(nombre)' +
    '&order=creado_en.asc');

  let salidas = [];

  // Solo busca si se proporcionó al menos la fecha
  if (fecha) {
    let query =
      'select=id,fecha_salida,precio_piso1,precio_piso2,' +
      'servicios(nombre,icono,categoria),' +
      'buses(placa,total_asientos),' +
      'destinos(id,' +
        'ciudades_origen:ciudades!ciudad_origen(nombre),' +
        'ciudades_destino:ciudades!ciudad_destino(nombre))' +
      `&fecha_salida=eq.${fecha}` +
      '&estado=eq.publicado' +
      '&order=creado_en.asc';

    if (destino_id && destino_id !== '') {
      query += `&destino_id=eq.${destino_id}`;
    }

    const { data: programaciones, error } = await db.select('programaciones', query);
    if (error) console.error('Error boletaje:', error.message);

    // Para cada programación, carga sus escalas
    const lista = programaciones || [];
    for (const prog of lista) {
      const { data: escalas } = await db.select('programacion_escalas',
        `select=orden,hora,agencias(nombre)&programacion_id=eq.${prog.id}&order=orden.asc`);
      prog.escalas = escalas || [];
    }
    salidas = lista;
  }

  const u = await usuarioActualFresco(req.session.user);

  res.render('boletaje/index', {
    layout: 'main',
    title: 'Boletaje e Itinerarios',
    pageTitle: 'Boletaje e Itinerarios',
    pageSubtitle: 'Vista general de salidas, rutas y control de ventas en tiempo real',
    destinos:   destinos  || [],
    salidas:    salidas,
    // Valores actuales de los filtros para repoblar el form
    filtroFecha:    fecha      || '',
    filtroDestino:  destino_id || '',
    buscado: !!fecha,
    puedeEditarPrecios: u.rol === 'admin' || u.puede_editar_precios === true
  });
});

// ─── GET /:id/croquis — Datos para la ventana de venta de asientos ──
router.get('/:id/croquis', requireAuth, async (req, res) => {
  const progId = req.params.id;

  const { data: progRows, error: progError } = await db.select('programaciones',
    'select=id,fecha_salida,precio_piso1,precio_piso2,destino_id,bus_id,' +
    'servicios(nombre),' +
    'buses(id,placa,total_asientos,soat_poliza),' +
    'destinos(id,ciudad_origen,ciudad_destino,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&id=eq.${progId}&limit=1`);
  if (progError) return res.status(500).json({ error: progError.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (!prog.buses) return res.status(400).json({ error: 'Esta salida no tiene un bus asignado.' });

  const busId = prog.buses.id;

  const [{ data: escalas }, { data: cfgRows }, { data: asientos }, { data: boletos }] = await Promise.all([
    db.select('programacion_escalas', `select=orden,hora,agencias(nombre)&programacion_id=eq.${progId}&order=orden.asc`),
    db.select('bus_config_asientos',  `select=*&bus_id=eq.${busId}&limit=1`),
    db.select('bus_asientos',         `select=piso,fila,columna,numero_asiento,tipo&bus_id=eq.${busId}&order=piso.asc,fila.asc,columna.asc`),
    db.select('boletos',
      'select=id,piso,numero_asiento,estado,precio,serie,correlativo,metodo_pago,codigo_usado,tipo_documento,numero_documento,nombre_completo,edad,' +
      'telefono,ruc,razon_social,agencia_embarque_id,agencia_llegada_id,vendido_por,' +
      'vendedor:usuarios!vendido_por(nombre,username,agencia:agencias(id,nombre,color))' +
      `&programacion_id=eq.${progId}&estado=neq.anulado`)
  ]);

  const ciudadOrigenId  = prog.destinos ? prog.destinos.ciudad_origen  : null;
  const ciudadDestinoId = prog.destinos ? prog.destinos.ciudad_destino : null;

  // Ciudades adicionales configuradas para esta ruta (ej: PIURA además
  // de SULLANA, por pertenecer al mismo departamento) — sus agencias
  // también se ofrecen como opción de llegada.
  const { data: ciudadesAdicionales } = prog.destinos
    ? await db.select('destino_ciudades_adicionales', `select=ciudad_id&destino_id=eq.${prog.destino_id}`)
    : { data: [] };
  const idsCiudadesDestino = [ciudadDestinoId, ...(ciudadesAdicionales || []).map(c => c.ciudad_id)]
    .filter(Boolean);

  const [{ data: agenciasOrigen }, { data: agenciasDestino }] = await Promise.all([
    ciudadOrigenId ? db.select('agencias', `select=id,nombre,direccion&ciudad_id=eq.${ciudadOrigenId}&activo=eq.true&order=nombre.asc`) : Promise.resolve({ data: [] }),
    idsCiudadesDestino.length > 0
      ? db.select('agencias', `select=id,nombre,direccion&ciudad_id=in.(${idsCiudadesDestino.join(',')})&activo=eq.true&order=nombre.asc`)
      : Promise.resolve({ data: [] })
  ]);

  const primerParadero = (escalas || []).find(e => e.orden === 1) || (escalas || [])[0] || null;
  const u = await usuarioActualFresco(req.session.user);
  const esAdmin = u.rol === 'admin';

  res.json({
    programacion: {
      id: prog.id,
      fecha_salida: prog.fecha_salida,
      precio_piso1: prog.precio_piso1,
      precio_piso2: prog.precio_piso2,
      servicio: prog.servicios ? prog.servicios.nombre : null,
      ciudad_origen:  prog.destinos ? prog.destinos.ciudades_origen.nombre  : null,
      ciudad_destino: prog.destinos ? prog.destinos.ciudades_destino.nombre : null,
      hora_primer_paradero: primerParadero ? primerParadero.hora : null
    },
    bus: { id: prog.buses.id, placa: prog.buses.placa, poliza: prog.buses.soat_poliza || null },
    config: cfgRows && cfgRows[0] ? cfgRows[0] : null,
    asientos: asientos || [],
    boletos: boletos || [],
    agenciasOrigen:  agenciasOrigen  || [],
    agenciasDestino: agenciasDestino || [],
    usuarioActual: { id: u.id, nombre: u.nombre, username: req.session.user.username || null, agencia_id: u.agencia_id || null },
    permisos: {
      puede_anular:    esAdmin || u.puede_anular    !== false,
      puede_postergar: esAdmin || u.puede_postergar !== false,
      puede_reservar:  esAdmin || u.puede_reservar  !== false,
      puede_habilitar: esAdmin || u.puede_habilitar !== false
    }
  });
});

// ─── POST /:id/asiento — Guarda/anula/reserva/etc. un asiento ──
router.post('/:id/asiento', requireAuth, async (req, res) => {
  const progId = req.params.id;
  const {
    piso, numero_asiento, accion,
    tipo_documento, numero_documento, nombre_completo, edad, telefono,
    ruc, razon_social, agencia_embarque_id, agencia_llegada_id, precio, metodo_pago,
    codigo_usado, serie_manual, correlativo_manual
  } = req.body;

  if (!piso || !numero_asiento || !accion) {
    return res.status(400).json({ error: 'Faltan datos del asiento.' });
  }

  const u = await usuarioActualFresco(req.session.user);
  const esAdmin = u.rol === 'admin';
  const permisoRequerido = { anular: 'puede_anular', postergar: 'puede_postergar', reservar: 'puede_reservar', habilitar: 'puede_habilitar' };
  if (permisoRequerido[accion] && !esAdmin && u[permisoRequerido[accion]] === false) {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }

  // ── VENDER (guardar): todo ocurre en UNA sola operación atómica en la
  // base de datos (ver función registrar_venta_asiento). Así se
  // garantiza que el boleto y su serie/correlativo se guarden juntos,
  // sin duplicados ni carreras aunque dos personas vendan a la vez. ──
  if (accion === 'guardar') {
    if (!u.agencia_id) {
      return res.status(400).json({ error: 'Tu usuario no tiene una agencia asignada. Pide a un administrador que te asigne una para poder emitir boletos.' });
    }
    const { data: resultado, error: ventaError } = await db.rpc('registrar_venta_asiento', {
      p_programacion_id:     progId,
      p_piso:                parseInt(piso),
      p_numero_asiento:      String(numero_asiento),
      p_agencia_id:          u.agencia_id,
      p_precio:              precio !== undefined && precio !== '' ? parseFloat(precio) : null,
      p_metodo_pago:         metodo_pago || 'efectivo',
      p_tipo_documento:      tipo_documento   || null,
      p_numero_documento:    numero_documento || null,
      p_nombre_completo:     nombre_completo  || null,
      p_edad:                edad ? parseInt(edad) : null,
      p_telefono:            telefono || null,
      p_ruc:                 ruc || null,
      p_razon_social:        razon_social || null,
      p_agencia_embarque_id: agencia_embarque_id || null,
      p_agencia_llegada_id:  agencia_llegada_id  || null,
      p_codigo_usado:        codigo_usado || null,
      p_vendido_por:         u.id
    });
    if (ventaError) {
      const errMsg = ventaError.message || '';
      const msg = errMsg.includes('AGENCIA_SIN_SERIE_FACTURA')
        ? 'La agencia asignada a tu usuario todavía no tiene una serie de FACTURAS configurada. Pide a un administrador que la registre en Ciudades/Agencias, o quita el RUC para emitir una boleta en su lugar.'
        : errMsg.includes('AGENCIA_SIN_SERIE')
        ? 'La agencia asignada a tu usuario todavía no tiene una serie de boletos configurada. Pide a un administrador que la registre en Ciudades/Agencias.'
        : errMsg.includes('AGENCIA_NO_ENCONTRADA')
        ? 'La agencia asignada a tu usuario ya no existe. Pide a un administrador que te asigne otra.'
        : (errMsg.includes('Could not find the function') || ventaError.code === 'PGRST202')
        ? 'Falta ejecutar (o recargar) la migración SQL "SERIES_BOLETA_FACTURA_MIGRATION.sql" en Supabase. Ejecútala en el SQL Editor; ya incluye el comando para refrescar el caché de la API.'
        : 'No se pudo registrar la venta: ' + errMsg;
      return res.status(500).json({ error: msg });
    }
    const fila = Array.isArray(resultado) ? resultado[0] : resultado;
    if (!fila || !fila.serie || !fila.correlativo) {
      // Salvaguarda: si por algún motivo la función no devolvió número,
      // avisamos claramente en vez de responder éxito sin serie.
      return res.status(500).json({ error: 'La venta no devolvió un número de boleto válido. Intenta nuevamente.' });
    }
    return res.json({ ok: true, serie: fila.serie, correlativo: fila.correlativo, tipo_comprobante: fila.tipo_comprobante });
  }

  // Habilitar = registra manualmente un boleto/factura con una serie y
  // correlativo que tú indiques (por ejemplo, uno emitido fuera del
  // sistema), y lo activa como vendido en el asiento elegido.
  if (accion === 'habilitar' && (!serie_manual || !correlativo_manual)) {
    return res.status(400).json({ error: 'Debes indicar la serie y el correlativo del boleto o factura.' });
  }

  const estadoMap = { reservar: 'reservado', postergar: 'postergado', anular: 'anulado', habilitar: 'vendido' };
  const estado = estadoMap[accion];
  if (!estado) return res.status(400).json({ error: 'Acción no reconocida.' });

  const { data: existe } = await db.select('boletos',
    `select=id,serie,correlativo&programacion_id=eq.${progId}&piso=eq.${piso}&numero_asiento=eq.${encodeURIComponent(numero_asiento)}&limit=1`);
  const boletoExistente = existe && existe[0];

  const payload = {
    programacion_id: progId,
    piso:             parseInt(piso),
    numero_asiento:   String(numero_asiento),
    estado:           estado,
    precio:           precio !== undefined && precio !== '' ? parseFloat(precio) : null,
    metodo_pago:      metodo_pago || 'efectivo',
    tipo_documento:   tipo_documento   || null,
    numero_documento: numero_documento || null,
    nombre_completo:  nombre_completo  || null,
    edad:             edad ? parseInt(edad) : null,
    telefono:         telefono || null,
    ruc:              ruc || null,
    razon_social:     razon_social || null,
    agencia_embarque_id: agencia_embarque_id || null,
    agencia_llegada_id:  agencia_llegada_id  || null,
    codigo_usado:     codigo_usado || null,
    vendido_por:      u.id,
    actualizado_en:   new Date().toISOString()
  };
  if (accion === 'anular') {
    payload.anulado_por = u.id;
    payload.anulado_en  = new Date().toISOString();
  }
  if (accion === 'habilitar') {
    // Serie manual indicada por el usuario — no pasa por el correlativo automático
    payload.serie       = String(serie_manual).toUpperCase();
    payload.correlativo = parseInt(correlativo_manual);
  }

  let error;
  if (boletoExistente) {
    const r = await db.update('boletos', `id=eq.${boletoExistente.id}`, payload);
    error = r.error;
  } else {
    const r = await db.insert('boletos', payload);
    error = r.error;
  }
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, serie: payload.serie, correlativo: payload.correlativo });
});

// ─── POST /:id/editar-precio — Cambia precio/horario de una salida (solo autorizados) ──
router.post('/:id/editar-precio', requireAuth, async (req, res) => {
  const u = await usuarioActualFresco(req.session.user);
  if (u.rol !== 'admin' && u.puede_editar_precios !== true) {
    return res.status(403).json({ error: 'No tienes permiso para editar precios u horarios.' });
  }
  const { precio_piso1, precio_piso2, hora } = req.body;
  const progId = req.params.id;

  if (precio_piso1 !== undefined || precio_piso2 !== undefined) {
    const updates = {};
    if (precio_piso1 !== undefined && precio_piso1 !== '') updates.precio_piso1 = parseFloat(precio_piso1);
    if (precio_piso2 !== undefined && precio_piso2 !== '') updates.precio_piso2 = parseFloat(precio_piso2);
    if (Object.keys(updates).length > 0) {
      const { error } = await db.update('programaciones', `id=eq.${progId}`, updates);
      if (error) return res.status(500).json({ error: error.message });
    }
  }

  if (hora) {
    const { data: primerEscala } = await db.select('programacion_escalas',
      `select=id&programacion_id=eq.${progId}&orden=eq.1&limit=1`);
    if (primerEscala && primerEscala[0]) {
      const { error } = await db.update('programacion_escalas', `id=eq.${primerEscala[0].id}`, { hora });
      if (error) return res.status(500).json({ error: error.message });
    }
  }

  res.json({ ok: true });
});

module.exports = router;
