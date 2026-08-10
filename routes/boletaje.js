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
  // Por defecto: hoy. Así la pantalla nunca aparece en blanco al entrar.
  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = req.query.fecha || hoy;
  const { destino_id } = req.query;

  // Siempre carga la lista de destinos para el filtro
  const { data: destinos } = await db.select('destinos',
    'select=id,ciudad_origen,ciudad_destino,' +
    'ciudades_origen:ciudades!ciudad_origen(nombre),' +
    'ciudades_destino:ciudades!ciudad_destino(nombre)' +
    '&order=creado_en.asc');

  let query =
    'select=id,fecha_salida,precio_piso1,precio_piso2,destino_id,' +
    'servicios(nombre,icono,categoria),' +
    'buses(placa,total_asientos,empresas(razon_social,logo_data_url)),' +
    'destinos(id,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&fecha_salida=eq.${fecha}` +
    '&estado=eq.publicado' +
    '&order=destino_id.asc,creado_en.asc';

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

  // Agrupa las salidas por ruta, para mostrarlas separadas visualmente
  const gruposMap = {};
  const gruposOrden = [];
  lista.forEach(prog => {
    const key = prog.destino_id || 'sin-ruta';
    if (!gruposMap[key]) {
      gruposMap[key] = {
        rutaOrigen:  prog.destinos ? prog.destinos.ciudades_origen.nombre  : 'Sin ruta',
        rutaDestino: prog.destinos ? prog.destinos.ciudades_destino.nombre : '',
        salidas: []
      };
      gruposOrden.push(key);
    }
    gruposMap[key].salidas.push(prog);
  });
  const grupos = gruposOrden.map(k => gruposMap[k]);

  const u = await usuarioActualFresco(req.session.user);

  res.render('boletaje/index', {
    layout: 'main',
    title: 'Boletaje e Itinerarios',
    pageTitle: 'Boletaje e Itinerarios',
    pageSubtitle: 'Vista general de salidas, rutas y control de ventas en tiempo real',
    destinos:   destinos  || [],
    grupos:     grupos,
    // Valores actuales de los filtros para repoblar el form
    filtroFecha:    fecha      || '',
    filtroDestino:  destino_id || '',
    buscado: true,
    puedeEditarPrecios: u.rol === 'admin' || u.puede_editar_precios === true
  });
});

// ─── GET /:id/origen-reintegro — Datos del boleto original a procesar ──
router.get('/:id/origen-reintegro', requireAuth, async (req, res) => {
  const { serie, correlativo } = req.query;
  if (!serie || !correlativo) return res.status(400).json({ error: 'Indica la serie y el correlativo.' });
  const { data: rows, error } = await db.select('boletos',
    'select=id,estado,nombre_completo,edad,telefono,tipo_documento,numero_documento,ruc,razon_social,agencia_embarque_id,agencia_llegada_id,empresa_id' +
    `&serie=eq.${encodeURIComponent(String(serie).toUpperCase())}&correlativo=eq.${parseInt(correlativo)}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const boleto = rows && rows[0];
  if (!boleto) return res.status(404).json({ error: 'No se encontró ningún boleto con esa serie y correlativo.' });
  if (!['postergado', 'reservado'].includes(boleto.estado)) {
    return res.status(400).json({ error: 'Ese boleto no está disponible para reintegro (debe estar postergado o reservado; su estado actual es "' + boleto.estado + '").' });
  }
  res.json(boleto);
});

// ─── GET /:id/croquis — Datos para la ventana de venta de asientos ──
router.get('/:id/croquis', requireAuth, async (req, res) => {
  const progId = req.params.id;

  const { data: progRows, error: progError } = await db.select('programaciones',
    'select=id,fecha_salida,precio_piso1,precio_piso2,destino_id,bus_id,' +
    'servicios(nombre),' +
    'buses(id,placa,total_asientos,soat_poliza,empresa_id,empresas(id,ruc,razon_social,domicilio_fiscal,logo_data_url)),' +
    'destinos(id,ciudad_origen,ciudad_destino,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&id=eq.${progId}&limit=1`);
  if (progError) return res.status(500).json({ error: progError.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });
  if (!prog.buses) return res.status(400).json({ error: 'Esta salida no tiene un bus asignado.' });
  if (!prog.buses.empresa_id) return res.status(400).json({ error: 'El bus de esta salida no tiene una empresa propietaria registrada. Configúrala en Buses.' });

  const busId = prog.buses.id;

  const [{ data: escalas }, { data: cfgRows }, { data: asientos }, { data: boletos }] = await Promise.all([
    db.select('programacion_escalas', `select=orden,hora,agencias(nombre)&programacion_id=eq.${progId}&order=orden.asc`),
    db.select('bus_config_asientos',  `select=*&bus_id=eq.${busId}&limit=1`),
    db.select('bus_asientos',         `select=piso,fila,columna,numero_asiento,tipo&bus_id=eq.${busId}&order=piso.asc,fila.asc,columna.asc`),
    db.select('boletos',
      'select=id,piso,numero_asiento,estado,precio,serie,correlativo,metodo_pago,codigo_usado,tipo_documento,numero_documento,nombre_completo,edad,' +
      'telefono,ruc,razon_social,agencia_embarque_id,agencia_llegada_id,vendido_por,empresa_id,transferido_otra_empresa,' +
      'vendedor:usuarios!vendido_por(nombre,username,agencia:agencias(id,nombre,color))' +
      // 'usado' y 'postergado' quedan totalmente desvinculados del
      // asiento: el boleto sigue existiendo (para poder habilitarlo o
      // reintegrarlo luego por su serie), pero el asiento se ve y se
      // comporta como libre para una venta nueva independiente.
      `&programacion_id=eq.${progId}&estado=not.in.(anulado,usado,postergado)`)
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
    bus: {
      id: prog.buses.id, placa: prog.buses.placa, poliza: prog.buses.soat_poliza || null,
      empresa: {
        id: prog.buses.empresa_id,
        ruc: prog.buses.empresas ? prog.buses.empresas.ruc : null,
        razon_social: prog.buses.empresas ? prog.buses.empresas.razon_social : null,
        domicilio_fiscal: prog.buses.empresas ? prog.buses.empresas.domicilio_fiscal : null,
        logo_data_url: prog.buses.empresas ? prog.buses.empresas.logo_data_url : null
      }
    },
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
      puede_habilitar: esAdmin || u.puede_habilitar !== false,
      puede_reintegro: esAdmin || u.puede_reintegro !== false
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
    codigo_usado, serie_manual, correlativo_manual,
    serie_original, correlativo_original, tipo_reintegro
  } = req.body;

  if (!piso || !numero_asiento || !accion) {
    return res.status(400).json({ error: 'Faltan datos del asiento.' });
  }

  const u = await usuarioActualFresco(req.session.user);
  const esAdmin = u.rol === 'admin';
  const permisoRequerido = { anular: 'puede_anular', postergar: 'puede_postergar', reservar: 'puede_reservar', habilitar: 'puede_habilitar', reintegro: 'puede_reintegro' };
  if (permisoRequerido[accion] && !esAdmin && u[permisoRequerido[accion]] === false) {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }

  // La empresa se obtiene siempre del bus asignado a ESTA programación
  // (no del usuario): cada empresa tiene su propia numeración de
  // boletos/facturas, y el bus determina bajo qué empresa se emite.
  async function obtenerEmpresaBus() {
    const { data: rows } = await db.select('programaciones',
      `select=bus_id,buses(empresa_id)&id=eq.${progId}&limit=1`);
    const p = rows && rows[0];
    return p && p.buses ? p.buses.empresa_id : null;
  }

  // ── VENDER (guardar): todo ocurre en UNA sola operación atómica en la
  // base de datos (ver función registrar_venta_asiento). Así se
  // garantiza que el boleto y su serie/correlativo se guarden juntos,
  // sin duplicados ni carreras aunque dos personas vendan a la vez. ──
  if (accion === 'guardar') {
    if (!u.agencia_id) {
      return res.status(400).json({ error: 'Tu usuario no tiene una agencia asignada. Pide a un administrador que te asigne una para poder emitir boletos.' });
    }
    const empresaId = await obtenerEmpresaBus();
    if (!empresaId) {
      return res.status(400).json({ error: 'El bus de esta salida no tiene una empresa propietaria registrada. Pide a un administrador que la configure en Buses.' });
    }

    // Si el asiento ya tiene un boleto activo, sus datos de identidad
    // (nombre/documento/edad/teléfono/RUC/razón social) ya no se
    // pueden editar desde aquí — solo Reintegro puede cambiarlos. Esto
    // protege el backend aunque alguien intente saltarse los campos
    // bloqueados en pantalla.
    let nombreFinal = nombre_completo, tipoDocFinal = tipo_documento, numDocFinal = numero_documento,
        edadFinal = edad, telefonoFinal = telefono, rucFinal = ruc, razonSocialFinal = razon_social;
    const { data: activoRows } = await db.select('boletos',
      `select=nombre_completo,tipo_documento,numero_documento,edad,telefono,ruc,razon_social&programacion_id=eq.${progId}&piso=eq.${piso}&numero_asiento=eq.${encodeURIComponent(numero_asiento)}&estado=in.(vendido,reservado,reintegro)&limit=1`);
    const activo = activoRows && activoRows[0];
    if (activo) {
      nombreFinal = activo.nombre_completo; tipoDocFinal = activo.tipo_documento; numDocFinal = activo.numero_documento;
      edadFinal = activo.edad; telefonoFinal = activo.telefono; rucFinal = activo.ruc; razonSocialFinal = activo.razon_social;
    }

    const { data: resultado, error: ventaError } = await db.rpc('registrar_venta_asiento', {
      p_programacion_id:     progId,
      p_piso:                parseInt(piso),
      p_numero_asiento:      String(numero_asiento),
      p_agencia_id:          u.agencia_id,
      p_empresa_id:          empresaId,
      p_precio:              precio !== undefined && precio !== '' ? parseFloat(precio) : null,
      p_metodo_pago:         metodo_pago || 'efectivo',
      p_tipo_documento:      tipoDocFinal   || null,
      p_numero_documento:    numDocFinal || null,
      p_nombre_completo:     nombreFinal  || null,
      p_edad:                edadFinal ? parseInt(edadFinal) : null,
      p_telefono:            telefonoFinal || null,
      p_ruc:                 rucFinal || null,
      p_razon_social:        razonSocialFinal || null,
      p_agencia_embarque_id: agencia_embarque_id || null,
      p_agencia_llegada_id:  agencia_llegada_id  || null,
      p_codigo_usado:        codigo_usado || null,
      p_vendido_por:         u.id
    });
    if (ventaError) {
      const errMsg = ventaError.message || '';
      const msg = errMsg.includes('AGENCIA_SIN_SERIE_FACTURA')
        ? 'La agencia asignada a tu usuario todavía no tiene una serie de FACTURAS configurada para la empresa de este bus. Pide a un administrador que la registre en Ciudades y Agencias → Series, o quita el RUC para emitir una boleta en su lugar.'
        : errMsg.includes('AGENCIA_SIN_SERIE')
        ? 'La agencia asignada a tu usuario todavía no tiene una serie de boletos configurada para la empresa de este bus. Pide a un administrador que la registre en Ciudades y Agencias → Series.'
        : errMsg.includes('AGENCIA_NO_ENCONTRADA')
        ? 'La agencia asignada a tu usuario ya no existe. Pide a un administrador que te asigne otra.'
        : errMsg.includes('BUS_SIN_EMPRESA')
        ? 'El bus de esta salida no tiene una empresa propietaria registrada. Pide a un administrador que la configure en Buses.'
        : errMsg.includes('CODIGO_INVALIDO')
        ? 'El código de autorización ingresado no existe.'
        : errMsg.includes('CODIGO_INACTIVO')
        ? 'El código de autorización ingresado está inactivo.'
        : errMsg.includes('CODIGO_YA_USADO')
        ? 'Ese código de autorización ya fue usado en otro boleto. Cada código solo puede usarse una vez.'
        : (errMsg.includes('Could not find the function') || ventaError.code === 'PGRST202')
        ? 'Falta ejecutar (o recargar) la migración SQL "MULTIEMPRESA_SERIES_MIGRATION.sql" en Supabase. Ejecútala en el SQL Editor; ya incluye el comando para refrescar el caché de la API.'
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

  const estadoMap = { reservar: 'reservado', postergar: 'postergado', anular: 'anulado', habilitar: 'vendido', reintegro: 'reintegro' };
  const estado = estadoMap[accion];
  if (!estado) return res.status(400).json({ error: 'Acción no reconocida.' });

  // Solo buscamos boletos "activos" (vendido/reservado/reintegro).
  // Uno postergado, anulado o usado NO cuenta como ocupante actual
  // del asiento — queda desvinculado por completo: el asiento vuelve
  // a estar libre para una venta nueva (con su propia serie/correlativo
  // nueva), mientras el boleto viejo sigue existiendo tal cual para
  // poder habilitarlo/reintegrarlo después por su serie.
  const { data: existe } = await db.select('boletos',
    `select=id,serie,correlativo,codigo_usado,estado&programacion_id=eq.${progId}&piso=eq.${piso}&numero_asiento=eq.${encodeURIComponent(numero_asiento)}` +
    `&estado=in.(vendido,reservado,reintegro)&limit=1`);
  const boletoExistente = existe && existe[0];

  // ── Reglas de estado válido por acción (un asiento libre no se
  // puede postergar ni anular; uno ya vendido no se puede reservar) ──
  if (accion === 'postergar' && (!boletoExistente || !['vendido', 'reintegro'].includes(boletoExistente.estado))) {
    return res.status(400).json({ error: 'Solo se puede postergar un asiento que ya está vendido.' });
  }
  if (accion === 'anular' && !boletoExistente) {
    return res.status(400).json({ error: 'No hay nada que anular: el asiento está libre.' });
  }
  if (accion === 'reservar' && boletoExistente) {
    return res.status(400).json({ error: 'Ese asiento ya está ocupado (vendido, reservado o en reintegro). Anúlalo primero si quieres liberarlo.' });
  }

  // ── Habilitar: usa la función atómica que sabe distinguir boletos
  // de otra empresa (ver activar_boleto_manual en MULTIEMPRESA_SERIES_MIGRATION.sql) ──
  if (accion === 'habilitar') {
    const { data: ocupadoRows } = await db.select('boletos',
      `select=id&programacion_id=eq.${progId}&piso=eq.${piso}&numero_asiento=eq.${encodeURIComponent(numero_asiento)}&estado=in.(vendido,reservado,reintegro)&limit=1`);
    if (ocupadoRows && ocupadoRows[0]) {
      return res.status(400).json({ error: 'Ese asiento ya está ocupado. Anúlalo primero si quieres activar otro boleto ahí.' });
    }
    const empresaId = await obtenerEmpresaBus();
    if (!empresaId) {
      return res.status(400).json({ error: 'El bus de esta salida no tiene una empresa propietaria registrada. Pide a un administrador que la configure en Buses.' });
    }
    if (!u.agencia_id) {
      return res.status(400).json({ error: 'Tu usuario no tiene una agencia asignada. Pide a un administrador que te asigne una.' });
    }
    const { data: resultado, error: actError } = await db.rpc('activar_boleto_manual', {
      p_programacion_id:     progId,
      p_piso:                parseInt(piso),
      p_numero_asiento:      String(numero_asiento),
      p_agencia_id:          u.agencia_id,
      p_empresa_id:          empresaId,
      p_serie_manual:        String(serie_manual).toUpperCase(),
      p_correlativo_manual:  parseInt(correlativo_manual),
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
      p_vendido_por:         u.id
    });
    if (actError) {
      const errMsg = actError.message || '';
      const msg = errMsg.includes('BOLETO_ORIGEN_NO_DISPONIBLE')
        ? 'Ese boleto original ya está vendido activamente o anulado — no se puede volver a activar. Solo se pueden activar boletos postergados o reservados.'
        : errMsg.includes('AGENCIA_SIN_SERIE_FACTURA')
        ? 'La agencia asignada a tu usuario no tiene serie de FACTURAS configurada para la empresa de este bus (necesaria porque el boleto original era factura). Configúrala en Ciudades y Agencias → Series.'
        : errMsg.includes('AGENCIA_SIN_SERIE')
        ? 'La agencia asignada a tu usuario no tiene serie de boletos configurada para la empresa de este bus. Configúrala en Ciudades y Agencias → Series.'
        : errMsg.includes('BUS_SIN_EMPRESA')
        ? 'El bus de esta salida no tiene una empresa propietaria registrada.'
        : (errMsg.includes('Could not find the function') || actError.code === 'PGRST202')
        ? 'Falta ejecutar (o recargar) la migración SQL "MULTIEMPRESA_SERIES_MIGRATION.sql" en Supabase.'
        : 'No se pudo activar el asiento: ' + errMsg;
      return res.status(500).json({ error: msg });
    }
    const fila = Array.isArray(resultado) ? resultado[0] : resultado;
    return res.json({
      ok: true, serie: fila.serie, correlativo: fila.correlativo,
      transferido: !!fila.transferido,
      mensaje: fila.transferido
        ? 'El boleto original pertenecía a otra empresa: se generó un boleto nuevo (' + fila.serie + '-' + fila.correlativo + ') y el original quedó marcado como usado.'
        : null
    });
  }

  // ── Reintegro: emite un boleto NUEVO a partir de uno original
  // (postergado/reservado), dejando el original como 'usado' — ver
  // procesar_reintegro en REINTEGRO_MIGRATION.sql ──
  if (accion === 'reintegro') {
    const { data: ocupadoRows2 } = await db.select('boletos',
      `select=id&programacion_id=eq.${progId}&piso=eq.${piso}&numero_asiento=eq.${encodeURIComponent(numero_asiento)}&estado=in.(vendido,reservado,reintegro)&limit=1`);
    if (ocupadoRows2 && ocupadoRows2[0]) {
      return res.status(400).json({ error: 'Ese asiento ya está ocupado. Anúlalo primero si quieres emitir un reintegro ahí.' });
    }
    if (!serie_original || !correlativo_original) {
      return res.status(400).json({ error: 'Debes indicar la serie y el correlativo del boleto original a procesar.' });
    }
    const tipoReintegro = parseInt(tipo_reintegro);
    if (tipoReintegro !== 1 && tipoReintegro !== 2) {
      return res.status(400).json({ error: 'Debes elegir un tipo de reintegro válido.' });
    }
    const empresaId = await obtenerEmpresaBus();
    if (!empresaId) {
      return res.status(400).json({ error: 'El bus de esta salida no tiene una empresa propietaria registrada. Pide a un administrador que la configure en Buses.' });
    }
    if (!u.agencia_id) {
      return res.status(400).json({ error: 'Tu usuario no tiene una agencia asignada. Pide a un administrador que te asigne una.' });
    }
    if (tipoReintegro === 2 && (!nombre_completo || !numero_documento)) {
      return res.status(400).json({ error: 'Para cambio de nombre, indica el nuevo nombre completo y número de documento.' });
    }
    const { data: resultado, error: reinError } = await db.rpc('procesar_reintegro', {
      p_programacion_id:     progId,
      p_piso:                parseInt(piso),
      p_numero_asiento:      String(numero_asiento),
      p_agencia_id:          u.agencia_id,
      p_empresa_id:          empresaId,
      p_serie_original:      String(serie_original).toUpperCase(),
      p_correlativo_original: parseInt(correlativo_original),
      p_tipo_reintegro:      tipoReintegro,
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
      p_vendido_por:         u.id
    });
    if (reinError) {
      const errMsg = reinError.message || '';
      const msg = errMsg.includes('BOLETO_ORIGEN_NO_ENCONTRADO')
        ? 'No se encontró ningún boleto con esa serie y correlativo.'
        : errMsg.includes('BOLETO_ORIGEN_IGUAL_AL_DESTINO')
        ? 'Ese es el mismo boleto que ya está en este asiento.'
        : errMsg.includes('BOLETO_ORIGEN_NO_DISPONIBLE')
        ? 'Ese boleto no está disponible para reintegro: solo se puede procesar un boleto postergado o reservado.'
        : errMsg.includes('AGENCIA_SIN_SERIE_FACTURA')
        ? 'La agencia asignada a tu usuario no tiene serie de FACTURAS configurada para la empresa de este bus. Configúrala en Ciudades y Agencias → Series.'
        : errMsg.includes('AGENCIA_SIN_SERIE')
        ? 'La agencia asignada a tu usuario no tiene serie de boletos configurada para la empresa de este bus. Configúrala en Ciudades y Agencias → Series.'
        : errMsg.includes('BUS_SIN_EMPRESA')
        ? 'El bus de esta salida no tiene una empresa propietaria registrada.'
        : (errMsg.includes('Could not find the function') || reinError.code === 'PGRST202')
        ? 'Falta ejecutar (o recargar) la migración SQL "REINTEGRO_MIGRATION.sql" en Supabase.'
        : 'No se pudo procesar el reintegro: ' + errMsg;
      return res.status(500).json({ error: msg });
    }
    const filaR = Array.isArray(resultado) ? resultado[0] : resultado;
    return res.json({ ok: true, serie: filaR.serie, correlativo: filaR.correlativo });
  }

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
    // El código de autorización SOLO se fija/consume a través de la
    // venta atómica (accion 'guardar' → registrar_venta_asiento), que
    // es la única que valida y bloquea su uso único. Estas otras
    // acciones (anular/reservar/postergar) simplemente conservan el
    // que ya tuviera el boleto, ignorando cualquier valor que venga
    // en la petición, para no dejar "colar" un código sin pasar por
    // esa validación.
    codigo_usado:     boletoExistente ? (boletoExistente.codigo_usado || null) : null,
    vendido_por:      u.id,
    actualizado_en:   new Date().toISOString()
  };
  if (accion === 'anular') {
    payload.anulado_por = u.id;
    payload.anulado_en  = new Date().toISOString();
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

// ═══════════════════════════════════════════════
// CROQUIS / MANIFIESTO — información de tripulación y bus
// Cualquier usuario autenticado puede ver y editar esto (no requiere
// el permiso puede_programar; es distinto de crear/editar la
// programación completa).
// ═══════════════════════════════════════════════

// ─── GET /:id/tripulacion — Datos actuales + combos para el modal ──
router.get('/:id/tripulacion', requireAuth, async (req, res) => {
  const progId = req.params.id;
  const { data: progRows, error } = await db.select('programaciones',
    `select=id,bus_id,servicio_id,piloto_id,copiloto1_id,copiloto2_id,terramoza_id,ayudante_id&id=eq.${progId}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });

  const [{ data: buses }, { data: servicios }, { data: choferes }, { data: terramozas }, { data: ayudantes }] = await Promise.all([
    db.select('buses', 'select=id,placa,marca,modelo,total_asientos,soat_poliza,empresa_id,empresas(razon_social)&activo=eq.true&order=placa.asc'),
    db.select('servicios', 'select=id,nombre&activo=eq.true&order=nombre.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,dni,licencia&tipo=eq.Chofer&activo=eq.true&order=nombres.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,dni&tipo=eq.Terramoza&activo=eq.true&order=nombres.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,dni&tipo=eq.Ayudante&activo=eq.true&order=nombres.asc')
  ]);

  res.json({
    prog, buses: buses || [], servicios: servicios || [],
    choferes: choferes || [], terramozas: terramozas || [], ayudantes: ayudantes || []
  });
});

// ─── POST /:id/tripulacion — Guarda bus/tripulación (cualquier usuario) ──
router.post('/:id/tripulacion', requireAuth, async (req, res) => {
  const { bus_id, servicio_id, piloto_id, copiloto1_id, copiloto2_id, terramoza_id, ayudante_id } = req.body;
  const toOpt = v => v && v !== '' ? v : null;
  const { error } = await db.update('programaciones', `id=eq.${req.params.id}`, {
    bus_id: toOpt(bus_id), servicio_id: toOpt(servicio_id),
    piloto_id: toOpt(piloto_id), copiloto1_id: toOpt(copiloto1_id), copiloto2_id: toOpt(copiloto2_id),
    terramoza_id: toOpt(terramoza_id), ayudante_id: toOpt(ayudante_id)
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── GET /:id/croquis-datos — Todo lo necesario para imprimir el Croquis ──
router.get('/:id/croquis-datos', requireAuth, async (req, res) => {
  const progId = req.params.id;
  const { data: progRows, error } = await db.select('programaciones',
    'select=id,fecha_salida,destino_id,bus_id,' +
    'servicios(nombre),' +
    'buses(placa,marca,total_asientos,empresa_id,empresas(razon_social)),' +
    'destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&id=eq.${progId}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });

  const { data: escalas } = await db.select('programacion_escalas',
    `select=orden,hora,agencias(nombre)&programacion_id=eq.${progId}&order=orden.asc`);
  const primerParadero = (escalas || [])[0];

  const { data: boletos } = await db.select('boletos',
    'select=piso,numero_asiento,serie,correlativo,nombre_completo,estado,' +
    'embarco_estado,' +
    'agencia_embarque:agencias!agencia_embarque_id(nombre),' +
    'agencia_llegada:agencias!agencia_llegada_id(nombre)' +
    `&programacion_id=eq.${progId}&estado=neq.anulado`);

  res.json({
    programacion: {
      id: prog.id, fecha_salida: prog.fecha_salida,
      hora: primerParadero ? primerParadero.hora : null,
      servicio: prog.servicios ? prog.servicios.nombre : null,
      ciudad_origen:  prog.destinos ? prog.destinos.ciudades_origen.nombre  : null,
      ciudad_destino: prog.destinos ? prog.destinos.ciudades_destino.nombre : null
    },
    bus: prog.buses ? {
      placa: prog.buses.placa, total_asientos: prog.buses.total_asientos,
      empresa: prog.buses.empresas ? prog.buses.empresas.razon_social : null
    } : null,
    boletos: boletos || []
  });
});

// ─── GET /:id/manifiesto-datos — Todo lo necesario para imprimir el Manifiesto ──
router.get('/:id/manifiesto-datos', requireAuth, async (req, res) => {
  const progId = req.params.id;
  const { data: progRows, error } = await db.select('programaciones',
    'select=id,fecha_salida,destino_id,bus_id,' +
    'buses(placa,marca,total_asientos,soat_poliza,empresa_id,empresas(ruc,razon_social)),' +
    'piloto:personal_tripulantes!piloto_id(nombres,apellidos,licencia),' +
    'copiloto1:personal_tripulantes!copiloto1_id(nombres,apellidos,licencia),' +
    'copiloto2:personal_tripulantes!copiloto2_id(nombres,apellidos,licencia),' +
    'terramoza:personal_tripulantes!terramoza_id(nombres,apellidos,dni),' +
    'ayudante:personal_tripulantes!ayudante_id(nombres,apellidos,dni),' +
    'destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&id=eq.${progId}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });

  const { data: manifiestoRows, error: manifiestoError } = await db.rpc('obtener_o_generar_manifiesto', { p_programacion_id: progId });
  if (manifiestoError) return res.status(500).json({ error: 'No se pudo generar el número de manifiesto: ' + manifiestoError.message });
  const manifiestoNum = Array.isArray(manifiestoRows) ? manifiestoRows[0] : manifiestoRows;

  const { data: boletos } = await db.select('boletos',
    'select=piso,numero_asiento,serie,correlativo,nombre_completo,tipo_documento,numero_documento,edad,precio,estado,' +
    'agencia_embarque:agencias!agencia_embarque_id(nombre),' +
    'agencia_llegada:agencias!agencia_llegada_id(nombre)' +
    `&programacion_id=eq.${progId}&estado=neq.anulado&order=piso.asc,numero_asiento.asc`);

  res.json({
    programacion: {
      id: prog.id, fecha_salida: prog.fecha_salida,
      ciudad_origen:  prog.destinos ? prog.destinos.ciudades_origen.nombre  : null,
      ciudad_destino: prog.destinos ? prog.destinos.ciudades_destino.nombre : null
    },
    bus: prog.buses ? {
      placa: prog.buses.placa, marca: prog.buses.marca, total_asientos: prog.buses.total_asientos,
      tarjeta_circulacion: prog.buses.soat_poliza,
      empresa_ruc: prog.buses.empresas ? prog.buses.empresas.ruc : null,
      empresa_razon_social: prog.buses.empresas ? prog.buses.empresas.razon_social : null
    } : null,
    piloto: prog.piloto || null,
    copiloto1: prog.copiloto1 || null,
    copiloto2: prog.copiloto2 || null,
    terramoza: prog.terramoza || null,
    ayudante: prog.ayudante || null,
    manifiesto: { serie: manifiestoNum.serie, correlativo: manifiestoNum.correlativo },
    boletos: boletos || []
  });
});

// ─── GET /:id/asistencia — Página de control de embarque ──
router.get('/:id/asistencia', requireAuth, async (req, res) => {
  res.render('boletaje/asistencia', {
    layout: 'main', title: 'Control de Embarque',
    pageTitle: 'Control de Embarque',
    pageSubtitle: 'Marca qué pasajeros embarcaron en esta salida',
    programacionId: req.params.id
  });
});

// ─── GET /:id/asistencia-datos — Lista de pasajeros para pasar asistencia ──
router.get('/:id/asistencia-datos', requireAuth, async (req, res) => {
  const progId = req.params.id;
  const { data: progRows, error } = await db.select('programaciones',
    'select=id,fecha_salida,' +
    'servicios(nombre),' +
    'buses(placa),' +
    'destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre))' +
    `&id=eq.${progId}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const prog = progRows && progRows[0];
  if (!prog) return res.status(404).json({ error: 'Programación no encontrada.' });

  const { data: boletos } = await db.select('boletos',
    'select=id,piso,numero_asiento,serie,correlativo,nombre_completo,tipo_documento,numero_documento,embarco_estado,' +
    'agencia_embarque:agencias!agencia_embarque_id(nombre),' +
    'agencia_llegada:agencias!agencia_llegada_id(nombre)' +
    `&programacion_id=eq.${progId}&estado=neq.anulado&order=piso.asc,numero_asiento.asc`);

  res.json({
    programacion: {
      fecha_salida: prog.fecha_salida,
      servicio: prog.servicios ? prog.servicios.nombre : null,
      placa: prog.buses ? prog.buses.placa : null,
      ciudad_origen:  prog.destinos ? prog.destinos.ciudades_origen.nombre  : null,
      ciudad_destino: prog.destinos ? prog.destinos.ciudades_destino.nombre : null
    },
    boletos: boletos || []
  });
});

// ─── POST /:id/asistencia — Marca EMBARCÓ / NO EMBARCÓ de un boleto ──
router.post('/:id/asistencia', requireAuth, async (req, res) => {
  const { boleto_id, embarco_estado } = req.body;
  if (!boleto_id || !['embarco', 'no_embarco', ''].includes(embarco_estado)) {
    return res.status(400).json({ error: 'Datos inválidos.' });
  }
  const u = await usuarioActualFresco(req.session.user);
  const { error } = await db.update('boletos', `id=eq.${boleto_id}`, {
    embarco_estado: embarco_estado || null,
    embarco_marcado_por: u.id,
    embarco_marcado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
