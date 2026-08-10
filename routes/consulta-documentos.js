// =============================================
// routes/consulta-documentos.js — Consulta de Documentos
// Permite ubicar un boleto/factura ya emitido, ver todos sus datos y
// su historial completo de movimientos (venta, reserva, postergación,
// habilitación, anulación, transferencia entre empresas), buscando
// por Empresa + Serie + Correlativo, o por D.N.I. del pasajero (sin
// importar en qué empresa compró).
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const SELECT_BOLETO =
  'select=id,piso,numero_asiento,estado,precio,serie,correlativo,metodo_pago,' +
  'tipo_documento,numero_documento,nombre_completo,edad,telefono,ruc,razon_social,' +
  'creado_en,activado_desde_boleto_id,transferido_otra_empresa,' +
  'empresa:empresas!empresa_id(id,ruc,razon_social),' +
  'programaciones(fecha_salida,' +
    'servicios(nombre),' +
    'buses(placa),' +
    'destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre))),' +
  'agencia_embarque:agencias!agencia_embarque_id(nombre),' +
  'vendedor:usuarios!vendido_por(nombre,username,agencia:agencias(nombre))';

const TIPO_LABEL = {
  venta: 'VENTA',
  reserva: 'RESERVADO',
  postergacion: 'POSTERGADO',
  anulacion: 'ANULADO',
  habilitacion: 'HABILITADO',
  activacion_transferida: 'ACTIVADO (otra empresa)',
  transferido_a_otro_boleto: 'TRANSFERIDO',
  reintegro: 'REINTEGRO'
};

function primerNombre(nombreCompleto) {
  if (!nombreCompleto) return 'SISTEMA';
  return nombreCompleto.trim().split(/\s+/)[0].toUpperCase();
}

function formatearFechaHoraMov(iso) {
  if (!iso) return '';
  const f = new Date(iso);
  const meses = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const dia = String(f.getDate()).padStart(2, '0');
  const hora = String(f.getHours()).padStart(2, '0');
  const min = String(f.getMinutes()).padStart(2, '0');
  return `${dia} ${meses[f.getMonth()]} ${f.getFullYear()} ${hora}:${min}`;
}

// Arma el objeto que consume la pantalla, a partir de una fila de boletos
async function armarDetalle(boleto) {
  const prog = boleto.programaciones || {};
  const destino = prog.destinos || {};
  const { data: movimientosRaw } = await db.rpc('obtener_movimientos_boleto', { p_boleto_id: boleto.id });
  const movimientos = movimientosRaw || [];

  // Trae los nombres de los usuarios que hicieron cada movimiento, en un solo viaje a la BD
  const idsUsuarios = [...new Set(movimientos.map(m => m.usuario_id).filter(Boolean))];
  let nombresPorId = {};
  if (idsUsuarios.length > 0) {
    const { data: usuariosRows } = await db.select('usuarios', `select=id,nombre&id=in.(${idsUsuarios.join(',')})`);
    (usuariosRows || []).forEach(u => { nombresPorId[u.id] = u.nombre; });
  }

  const movimientosTexto = movimientos.map(m => {
    const etiqueta = TIPO_LABEL[m.tipo] || m.tipo.toUpperCase();
    const usuario = primerNombre(m.usuario_id ? nombresPorId[m.usuario_id] : null);
    return `${etiqueta} ${usuario} ${formatearFechaHoraMov(m.creado_en)}`;
  }).join(' / ');

  return {
    id: boleto.id,
    empresaId:      boleto.empresa ? boleto.empresa.id : null,
    empresaRuc:     boleto.empresa ? boleto.empresa.ruc : null,
    empresaNombre:  boleto.empresa ? boleto.empresa.razon_social : null,
    esFactura:      !!(boleto.ruc && boleto.ruc.trim() !== ''),
    serie: boleto.serie, correlativo: boleto.correlativo, estado: boleto.estado,
    transferidoOtraEmpresa: !!boleto.transferido_otra_empresa,
    activadoDesdeBoletoId: boleto.activado_desde_boleto_id,
    destino: destino.ciudades_destino ? destino.ciudades_destino.nombre : null,
    origen:  destino.ciudades_origen  ? destino.ciudades_origen.nombre  : null,
    servicio: prog.servicios ? prog.servicios.nombre : null,
    placa: prog.buses ? prog.buses.placa : null,
    fechaSalida: prog.fecha_salida || null,
    piso: boleto.piso, numeroAsiento: boleto.numero_asiento,
    nombreCompleto: boleto.nombre_completo, edad: boleto.edad, telefono: boleto.telefono,
    tipoDocumento: boleto.tipo_documento, numeroDocumento: boleto.numero_documento,
    ruc: boleto.ruc, razonSocial: boleto.razon_social,
    precio: boleto.precio, metodoPago: boleto.metodo_pago,
    creadoEn: boleto.creado_en,
    agenciaEmbarque: boleto.agencia_embarque ? boleto.agencia_embarque.nombre : null,
    usuario: boleto.vendedor ? boleto.vendedor.username : null,
    agenciaVendedor: (boleto.vendedor && boleto.vendedor.agencia) ? boleto.vendedor.agencia.nombre : null,
    movimientosTexto: movimientosTexto || 'Sin movimientos registrados.'
  };
}

// ─── GET / — Pantalla de Consulta de Documentos ──
router.get('/', async (req, res) => {
  const { data: empresas } = await db.select('empresas', 'select=id,ruc,razon_social&activo=eq.true&order=razon_social.asc');
  res.render('consulta-documentos/index', {
    layout: 'main', title: 'Consulta de Documentos',
    pageTitle: 'Consulta de Documentos',
    pageSubtitle: 'Busca boletos y facturas ya emitidos, con todo su historial de movimientos',
    empresas: empresas || []
  });
});

// ─── GET /boleto — Busca por Empresa + Serie + Correlativo ──
router.get('/boleto', async (req, res) => {
  const { empresa_id, serie, correlativo } = req.query;
  if (!serie || !correlativo) return res.status(400).json({ error: 'Indica serie y correlativo.' });

  const { data: rows, error } = await db.select('boletos',
    `${SELECT_BOLETO}&serie=eq.${encodeURIComponent(String(serie).toUpperCase())}&correlativo=eq.${parseInt(correlativo)}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const boleto = rows && rows[0];
  if (!boleto) return res.status(404).json({ error: 'No se encontró ningún boleto o factura con esa serie y correlativo.' });
  if (empresa_id && boleto.empresa && boleto.empresa.id !== empresa_id) {
    return res.status(404).json({ error: 'Ese documento no pertenece a la empresa seleccionada.' });
  }
  res.json(await armarDetalle(boleto));
});

// ─── GET /boleto/:id — Detalle directo por id (usado al elegir de la lista por D.N.I.) ──
router.get('/boleto/:id', async (req, res) => {
  const { data: rows, error } = await db.select('boletos', `${SELECT_BOLETO}&id=eq.${req.params.id}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  const boleto = rows && rows[0];
  if (!boleto) return res.status(404).json({ error: 'Documento no encontrado.' });
  res.json(await armarDetalle(boleto));
});

// ─── GET /buscar-dni — Busca TODOS los boletos/facturas de un pasajero
//      por D.N.I. y/o nombre, en cualquier empresa, dentro de un rango
//      de fechas de viaje ──
router.get('/buscar-dni', async (req, res) => {
  const { dni, nombre, desde, hasta } = req.query;
  if ((!dni || !dni.trim()) && (!nombre || !nombre.trim())) {
    return res.status(400).json({ error: 'Indica al menos el D.N.I. o el nombre del pasajero.' });
  }

  let query = 'select=id,serie,correlativo,estado,nombre_completo,numero_documento,piso,numero_asiento,' +
    'programaciones(fecha_salida,destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre)))' +
    '&serie=not.is.null&order=creado_en.desc&limit=200';

  if (dni && dni.trim() !== '') query += `&numero_documento=eq.${encodeURIComponent(dni.trim())}`;
  if (nombre && nombre.trim() !== '') query += `&nombre_completo=ilike.*${encodeURIComponent(nombre.trim())}*`;

  const { data: rows, error } = await db.select('boletos', query);
  if (error) return res.status(500).json({ error: error.message });

  let resultados = (rows || []).map(b => {
    const prog = b.programaciones || {};
    const destino = prog.destinos || {};
    return {
      id: b.id,
      nombrePasajero: b.nombre_completo,
      dni: b.numero_documento,
      fechaViaje: prog.fecha_salida || null,
      asiento: (b.piso === 2 ? '2-' : '') + b.numero_asiento,
      numeroBoleto: b.serie + '-' + b.correlativo,
      ruta: (destino.ciudades_origen ? destino.ciudades_origen.nombre : '?') + ' - ' + (destino.ciudades_destino ? destino.ciudades_destino.nombre : '?'),
      estado: b.estado
    };
  });

  // El filtro de fechas se aplica en memoria porque compara contra
  // programaciones.fecha_salida (columna de una tabla relacionada,
  // que PostgREST no permite filtrar directamente vía el join anidado).
  if (desde) resultados = resultados.filter(r => r.fechaViaje && r.fechaViaje.slice(0, 10) >= desde);
  if (hasta) resultados = resultados.filter(r => r.fechaViaje && r.fechaViaje.slice(0, 10) <= hasta);

  res.json({ resultados });
});

module.exports = router;
