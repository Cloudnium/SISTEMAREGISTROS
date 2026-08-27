// =============================================
// routes/planilla.js — Sueldos, bonos y descuentos de personal
// Solo visible/usable para admin o usuarios con puede_ver_planilla.
//
// Un bono/descuento queda "pendiente" hasta que se marca como
// cobrado; si no se cobra, sigue apareciendo en el siguiente pago
// (no hay que hacer nada especial: simplemente sigue pendiente).
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

function requirePlanilla(req, res, next) {
  const u = req.session.user;
  if (u && ((u.rol === 'admin' || u.rol === 'desarrollador') || u.puede_ver_planilla === true)) return next();
  req.flash('error', 'No tienes permiso para ver la Planilla.');
  res.redirect('/dashboard');
}

router.use(requireAuth, requirePlanilla);

// ─── GET / — Lista de personal con su resumen de planilla ──
router.get('/', async (req, res) => {
  const { data: personal } = await db.select('personal_tripulantes',
    'select=id,nombres,apellidos,categoria,tipo,cargo,sueldo_base,activo&activo=eq.true&order=categoria.asc,apellidos.asc');

  const { data: movimientos } = await db.select('planilla_movimientos',
    'select=id,personal_id,tipo,concepto,monto,origen,cobrado,creado_en&cobrado=eq.false&order=creado_en.asc');

  const porPersona = {};
  (movimientos || []).forEach(m => {
    if (!porPersona[m.personal_id]) porPersona[m.personal_id] = { bonos: [], descuentos: [] };
    porPersona[m.personal_id][m.tipo === 'bono' ? 'bonos' : 'descuentos'].push(m);
  });

  const lista = (personal || []).map(p => {
    const mov = porPersona[p.id] || { bonos: [], descuentos: [] };
    const totalBonos = mov.bonos.reduce((s, m) => s + Number(m.monto), 0);
    const totalDescuentos = mov.descuentos.reduce((s, m) => s + Number(m.monto), 0);
    const sueldoBase = Number(p.sueldo_base || 0);
    return {
      ...p,
      cargoMostrar: p.categoria === 'tripulacion' ? p.tipo : (p.cargo || 'Sin cargo'),
      bonos: mov.bonos, descuentos: mov.descuentos,
      totalBonos, totalDescuentos,
      totalPagar: sueldoBase + totalBonos - totalDescuentos
    };
  });

  res.render('planilla/index', {
    layout: 'main', title: 'Planilla',
    pageTitle: 'Planilla', pageSubtitle: 'Sueldos, bonos y descuentos del personal',
    personal: lista
  });
});

// ─── GET /:personalId/movimientos — Movimientos pendientes de un trabajador ──
router.get('/:personalId/movimientos', async (req, res) => {
  const { data, error } = await db.select('planilla_movimientos',
    `select=id,tipo,concepto,monto,origen,creado_en&personal_id=eq.${req.params.personalId}&cobrado=eq.false&order=creado_en.desc`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ movimientos: data || [] });
});

// ─── POST /:personalId/movimiento — Agrega un bono o descuento manual ──
router.post('/:personalId/movimiento', async (req, res) => {
  const { tipo, concepto, monto } = req.body;
  if (!['bono', 'descuento'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  if (!concepto || !concepto.trim()) return res.status(400).json({ error: 'Indica el concepto.' });
  const montoNum = parseFloat(monto);
  if (!montoNum || montoNum <= 0) return res.status(400).json({ error: 'Ingresa un monto válido.' });

  const { error } = await db.insert('planilla_movimientos', {
    personal_id: req.params.personalId,
    tipo, concepto: concepto.trim(), monto: montoNum,
    origen: 'manual', creado_por: req.session.user.id,
    creado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── POST /movimiento/:id/cobrar — Marca cobrado / no cobrado ──
router.post('/movimiento/:id/cobrar', async (req, res) => {
  const { cobrado } = req.body;
  const { error } = await db.update('planilla_movimientos', `id=eq.${req.params.id}`, {
    cobrado: cobrado === true || cobrado === 'true',
    cobrado_en: (cobrado === true || cobrado === 'true') ? new Date().toISOString() : null
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── POST /movimiento/:id/eliminar — Quita un movimiento manual mal ingresado ──
router.post('/movimiento/:id/eliminar', async (req, res) => {
  const { error } = await db.delete('planilla_movimientos', `id=eq.${req.params.id}&origen=eq.manual`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── POST /:personalId/sueldo — Actualiza el sueldo base ──
router.post('/:personalId/sueldo', async (req, res) => {
  const sueldo = parseFloat(req.body.sueldo_base);
  if (isNaN(sueldo) || sueldo < 0) return res.status(400).json({ error: 'Ingresa un sueldo válido.' });
  const { error } = await db.update('personal_tripulantes', `id=eq.${req.params.personalId}`, { sueldo_base: sueldo });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
