// =============================================
// routes/combustible.js
// GET /           → todos los roles autenticados
// POST /          → todos (registrar)
// GET  /descargar → todos
// GET  /:id/json  → todos
// POST /:id/editar   → SOLO admin
// POST /:id/eliminar → SOLO admin
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// ─── LIST ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data: registros } = await db.select('combustible_registros',
    'select=id,vale,fecha,estacion_id,placa_id,galones,precio,creado_en,estaciones(nombre),placas(numero)&order=fecha.desc,creado_en.desc');
  const { data: estaciones } = await db.select('estaciones',
    'select=id,nombre&activo=eq.true&order=nombre.asc');
  const { data: placas } = await db.select('placas',
    'select=id,numero&activo=eq.true&order=numero.asc');

  res.render('combustible/index', {
    layout: 'main', title: 'Combustible',
    pageTitle: 'Combustible', pageSubtitle: 'Control y registro de combustible',
    registros: registros || [], estaciones: estaciones || [], placas: placas || []
  });
});

// ─── DESCARGAR CSV (antes de /:id) ────────────
router.get('/descargar', requireAuth, async (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    req.flash('error', 'Indica fecha de inicio y fin.');
    return res.redirect('/combustible');
  }
  const { data: registros, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,galones,precio,creado_en,estaciones(nombre),placas(numero)` +
    `&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc`);
  if (error) { req.flash('error', 'Error al generar el reporte.'); return res.redirect('/combustible'); }

  const BOM = '\uFEFF';
  const headers = ['ID','Vale','Estacion','Placa','Galones','Precio (S/)','Fecha','Registrado'];
  const rows = (registros || []).map(r => [
    r.id, r.vale || '',
    r.estaciones ? r.estaciones.nombre : '',
    r.placas     ? r.placas.numero     : '',
    r.galones || 0, r.precio != null ? r.precio : '',
    r.fecha || '',
    r.creado_en ? new Date(r.creado_en).toLocaleString('es-PE') : ''
  ]);
  const csv = BOM + [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="combustible_${desde}_al_${hasta}.csv"`);
  res.send(csv);
});

// ─── JSON para edición AJAX ───────────────────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,estacion_id,placa_id,galones,precio&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0)
    return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── CREATE — cualquier usuario autenticado ───
router.post('/', requireAuth, async (req, res) => {
  const { vale, fecha, estacion_id, placa_id, galones, precio } = req.body;
  if (!vale || !fecha || !estacion_id || !placa_id || !galones) {
    req.flash('error', 'Vale, Fecha, Estacion, Placa y Galones son obligatorios.');
    return res.redirect('/combustible');
  }
  const { error } = await db.insert('combustible_registros', {
    vale: vale.trim().toUpperCase(), fecha, estacion_id, placa_id,
    galones: parseFloat(galones),
    precio: precio && precio.trim() !== '' ? parseFloat(precio) : null,
    usuario_id: req.session.user.id, creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Registro guardado correctamente.');
  res.redirect('/combustible');
});

// ─── UPDATE — SOLO admin ──────────────────────
router.post('/:id/editar', requireAuth, requireAdminToEdit, async (req, res) => {
  const { vale, fecha, estacion_id, placa_id, galones, precio } = req.body;
  if (!vale || !fecha || !estacion_id || !placa_id || !galones) {
    req.flash('error', 'Completa todos los campos obligatorios.');
    return res.redirect('/combustible');
  }
  const { error } = await db.update('combustible_registros', `id=eq.${req.params.id}`, {
    vale: vale.trim().toUpperCase(), fecha, estacion_id, placa_id,
    galones: parseFloat(galones),
    precio: precio && precio.trim() !== '' ? parseFloat(precio) : null
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Registro actualizado correctamente.');
  res.redirect('/combustible');
});

// ─── DELETE — SOLO admin ──────────────────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('combustible_registros', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Registro eliminado.');
  res.redirect('/combustible');
});

module.exports = router;
