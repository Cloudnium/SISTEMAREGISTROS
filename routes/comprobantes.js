// =============================================
// routes/comprobantes.js — Gestión de comprobantes (boletos)
// Todos los usuarios pueden VER; solo quienes tengan el permiso
// puede_anular (o sean admin) pueden anular un comprobante.
// Anular NUNCA borra el registro: solo cambia su estado.
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

router.use(requireAuth);

// ─── GET / — Lista de comprobantes con filtros ──
router.get('/', async (req, res) => {
  const { fecha, destino_id, estado, q } = req.query;

  const { data: destinos } = await db.select('destinos',
    'select=id,ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre)&order=id.asc');

  const { data: boletosRaw, error } = await db.select('boletos',
    'select=id,piso,numero_asiento,estado,precio,serie,correlativo,metodo_pago,' +
    'tipo_documento,numero_documento,nombre_completo,edad,telefono,ruc,razon_social,' +
    'creado_en,anulado_en,transferido_otra_empresa,activado_desde_boleto_id,' +
    'empresa:empresas!empresa_id(ruc,razon_social,domicilio_fiscal,logo_data_url),' +
    'programacion_id,programaciones(fecha_salida,destino_id,' +
      'servicios(nombre),' +
      'buses(soat_poliza),' +
      'programacion_escalas(orden,hora),' +
      'destinos(ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre))),' +
    'agencia_embarque:agencias!agencia_embarque_id(nombre,direccion),' +
    'agencia_llegada:agencias!agencia_llegada_id(nombre),' +
    'vendedor:usuarios!vendido_por(nombre,username),' +
    'anulador:usuarios!anulado_por(nombre)' +
    // Solo boletos REALMENTE emitidos (tienen serie/correlativo). Una
    // reserva que nunca llegó a venderse (o se anuló siendo reserva)
    // nunca tuvo un comprobante real, así que no debe aparecer aquí.
    '&serie=not.is.null&correlativo=not.is.null' +
    '&order=creado_en.desc&limit=500');
  if (error) console.error('comprobantes list:', error);

  let comprobantes = boletosRaw || [];

  // Para los boletos "usados" (transferidos a otro boleto al
  // Habilitar), buscamos con qué comprobante nuevo quedaron
  // vinculados, para poder mostrarlo ("usado en B002-00000045").
  const idsUsados = comprobantes.filter(b => b.estado === 'usado').map(b => b.id);
  if (idsUsados.length > 0) {
    const { data: vinculados } = await db.select('boletos',
      `select=serie,correlativo,activado_desde_boleto_id&activado_desde_boleto_id=in.(${idsUsados.join(',')})`);
    const mapaVinculo = {};
    (vinculados || []).forEach(v => { mapaVinculo[v.activado_desde_boleto_id] = v; });
    comprobantes.forEach(b => {
      if (b.estado === 'usado' && mapaVinculo[b.id]) {
        b.usado_en = mapaVinculo[b.id];
      }
    });
  }

  // Filtros (se aplican en memoria: el volumen de comprobantes es manejable
  // y varios filtros recaen sobre datos de tablas anidadas)
  if (estado) {
    comprobantes = comprobantes.filter(b => b.estado === estado);
  }
  if (fecha) {
    comprobantes = comprobantes.filter(b => b.programaciones && b.programaciones.fecha_salida === fecha);
  }
  if (destino_id) {
    comprobantes = comprobantes.filter(b => b.programaciones && String(b.programaciones.destino_id) === String(destino_id));
  }
  if (q && q.trim() !== '') {
    const needle = q.trim().toLowerCase();
    comprobantes = comprobantes.filter(b => {
      const serieCompleta = (b.serie && b.correlativo) ? (b.serie + '-' + String(b.correlativo).padStart(8, '0')).toLowerCase() : '';
      return (b.nombre_completo   || '').toLowerCase().includes(needle) ||
             (b.numero_documento  || '').toLowerCase().includes(needle) ||
             (b.ruc               || '').toLowerCase().includes(needle) ||
             serieCompleta.includes(needle);
    });
  }

  res.render('comprobantes/index', {
    layout: 'main', title: 'Comprobantes',
    pageTitle: 'Comprobantes', pageSubtitle: 'Boletos y facturas emitidas — anulación, reimpresión y método de pago',
    comprobantes, destinos: destinos || [],
    filtros: { fecha: fecha || '', destino_id: destino_id || '', estado: estado || '', q: q || '' },
    puedeAnular: (await usuarioActualFresco(req.session.user)).puede_anular !== false || req.session.user.rol === 'admin'
  });
});

// ─── POST /:id/anular — Anula (NO borra) un comprobante ──
router.post('/:id/anular', async (req, res) => {
  const u = await usuarioActualFresco(req.session.user);
  const esAdmin = u.rol === 'admin';
  if (!esAdmin && u.puede_anular === false) {
    return res.status(403).json({ error: 'No tienes permiso para anular comprobantes.' });
  }
  const { data: rows } = await db.select('boletos', `select=id,estado&id=eq.${req.params.id}&limit=1`);
  const boleto = rows && rows[0];
  if (!boleto) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  if (!['vendido', 'reservado', 'postergado', 'reintegro'].includes(boleto.estado)) {
    return res.status(400).json({ error: 'Este comprobante ya está ' + boleto.estado + ' y no se puede anular.' });
  }
  const { error } = await db.update('boletos', `id=eq.${req.params.id}`, {
    estado: 'anulado',
    anulado_por: u.id,
    anulado_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── POST /:id/metodo-pago — Cambia el método de pago ──
router.post('/:id/metodo-pago', async (req, res) => {
  const { metodo_pago } = req.body;
  const permitidos = ['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'];
  if (!permitidos.includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago no válido.' });
  }
  const { error } = await db.update('boletos', `id=eq.${req.params.id}`, {
    metodo_pago, actualizado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
