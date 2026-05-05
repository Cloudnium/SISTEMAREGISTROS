// =============================================
// routes/combustible.js
// Estructura BD: id, vale, fecha, estacion_id,
//                placa_id, galones, precio,
//                usuario_id, creado_en
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// ─── GET / — Lista todos los registros ───────
router.get('/', requireAuth, async (req, res) => {
  const { data: registros } = await db.select('combustible_registros',
    'select=id,vale,fecha,estacion_id,placa_id,galones,precio,creado_en,estaciones(nombre),placas(numero)&order=fecha.desc,creado_en.desc');

  const { data: estaciones } = await db.select('estaciones',
    'select=id,nombre&activo=eq.true&order=nombre.asc');

  const { data: placas } = await db.select('placas',
    'select=id,numero&activo=eq.true&order=numero.asc');

  res.render('combustible/index', {
    layout: 'main',
    title: 'Combustible',
    pageTitle: 'Combustible',
    pageSubtitle: 'Control y registro de combustible',
    registros:  registros  || [],
    estaciones: estaciones || [],
    placas:     placas     || []
  });
});

// ─── GET /descargar — CSV por rango de fechas ─
// IMPORTANTE: antes de /:id para que Express no confunda
router.get('/descargar', requireAuth, async (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    req.flash('error', 'Indica fecha de inicio y fin.');
    return res.redirect('/combustible');
  }

  const { data: registros, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,galones,precio,creado_en,estaciones(nombre),placas(numero)` +
    `&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc`);

  if (error) {
    req.flash('error', 'Error al generar el reporte.');
    return res.redirect('/combustible');
  }

  // Genera CSV con BOM para compatibilidad con Excel
  const BOM = '\uFEFF';
  const headers = ['ID', 'Vale', 'Estacion', 'Placa', 'Galones', 'Precio (S/)', 'Fecha', 'Registrado'];
  const rows = (registros || []).map(r => [
    r.id,
    r.vale        || '',
    r.estaciones  ? r.estaciones.nombre : '',
    r.placas      ? r.placas.numero     : '',
    r.galones     || 0,
    r.precio      != null ? r.precio    : '',
    r.fecha       || '',
    r.creado_en   ? new Date(r.creado_en).toLocaleString('es-PE') : ''
  ]);

  const csv = BOM + [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="combustible_${desde}_al_${hasta}.csv"`);
  res.send(csv);
});

// ─── GET /:id/json — Dato individual para edición AJAX ───
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,estacion_id,placa_id,galones,precio&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0)
    return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── POST / — Crear nuevo registro ───────────
router.post('/', requireAuth, async (req, res) => {
  const { vale, fecha, estacion_id, placa_id, galones, precio } = req.body;

  // Valida campos obligatorios (Precio es opcional)
  if (!vale || !fecha || !estacion_id || !placa_id || !galones) {
    req.flash('error', 'Vale, Fecha, Estacion, Placa y Galones son obligatorios.');
    return res.redirect('/combustible');
  }

  const { error } = await db.insert('combustible_registros', {
    vale:        vale.trim().toUpperCase(),
    fecha:       fecha,
    estacion_id: estacion_id,
    placa_id:    placa_id,
    galones:     parseFloat(galones),
    precio:      precio && precio.trim() !== '' ? parseFloat(precio) : null,
    usuario_id:  req.session.user.id,
    creado_en:   new Date().toISOString()
  });

  if (error) { req.flash('error', 'Error al guardar: ' + error.message); }
  else       { req.flash('success', 'Registro guardado correctamente.'); }
  res.redirect('/combustible');
});

// ─── POST /:id/editar — Actualizar registro ───
router.post('/:id/editar', requireAuth, async (req, res) => {
  const { vale, fecha, estacion_id, placa_id, galones, precio } = req.body;

  if (!vale || !fecha || !estacion_id || !placa_id || !galones) {
    req.flash('error', 'Completa todos los campos obligatorios.');
    return res.redirect('/combustible');
  }

  const { error } = await db.update('combustible_registros',
    `id=eq.${req.params.id}`,
    {
      vale:        vale.trim().toUpperCase(),
      fecha:       fecha,
      estacion_id: estacion_id,
      placa_id:    placa_id,
      galones:     parseFloat(galones),
      precio:      precio && precio.trim() !== '' ? parseFloat(precio) : null
    }
  );

  if (error) { req.flash('error', 'Error al actualizar: ' + error.message); }
  else       { req.flash('success', 'Registro actualizado correctamente.'); }
  res.redirect('/combustible');
});

// ─── POST /:id/eliminar — Eliminar registro ───
router.post('/:id/eliminar', requireAuth, async (req, res) => {
  const { error } = await db.delete('combustible_registros', `id=eq.${req.params.id}`);
  if (error) { req.flash('error', 'Error al eliminar: ' + error.message); }
  else       { req.flash('success', 'Registro eliminado.'); }
  res.redirect('/combustible');
});

module.exports = router;
