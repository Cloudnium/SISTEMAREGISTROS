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
const XLSX   = require('xlsx');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// Foto fija del nombre de la estación/placa al momento de guardar el
// registro: así, si después la editas o la eliminas del catálogo, el
// historial de combustible ya registrado no cambia (ver
// SQL/COMBUSTIBLE_HISTORICO_ESTACION_PLACA_MIGRATION.sql).
async function nombresActuales(estacion_id, placa_id) {
  const [{ data: e }, { data: p }] = await Promise.all([
    db.select('estaciones', `select=nombre&id=eq.${estacion_id}&limit=1`),
    db.select('placas', `select=numero&id=eq.${placa_id}&limit=1`)
  ]);
  return {
    estacion_nombre: e && e[0] ? e[0].nombre : null,
    placa_numero: p && p[0] ? p[0].numero : null
  };
}

// ─── LIST ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data: registros } = await db.select('combustible_registros',
    'select=id,vale,fecha,estacion_id,placa_id,estacion_nombre,placa_numero,galones,precio,creado_en,estaciones(nombre),placas(numero)&order=creado_en.desc');
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

// ─── DESCARGAR EXCEL (antes de /:id) ──────────
router.get('/descargar', requireAuth, async (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    req.flash('error', 'Indica fecha de inicio y fin.');
    return res.redirect('/combustible');
  }
  const { data: registros, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,galones,precio,creado_en,estacion_nombre,placa_numero,estaciones(nombre),placas(numero)` +
    `&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc`);
  if (error) { req.flash('error', 'Error al generar el reporte.'); return res.redirect('/combustible'); }

  const headers = ['ID', 'Vale', 'Estacion', 'Placa', 'Galones', 'Precio (S/)', 'Fecha', 'Registrado'];
  const filas = (registros || []).map(r => [
    r.id, r.vale || '',
    r.estacion_nombre || (r.estaciones ? r.estaciones.nombre : ''),
    r.placa_numero    || (r.placas     ? r.placas.numero     : ''),
    r.galones != null ? Number(r.galones) : 0,
    r.precio  != null ? Number(r.precio)  : '',
    r.fecha || '',
    r.creado_en ? new Date(r.creado_en).toLocaleString('es-PE') : ''
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...filas]);
  ws['!cols'] = [
    { wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 12 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Combustible');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="combustible_${desde}_al_${hasta}.xlsx"`);
  res.send(buffer);
});

// ─── JSON para edición AJAX ───────────────────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('combustible_registros',
    `select=id,vale,fecha,estacion_id,placa_id,galones,precio&id=eq.${req.params.id}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── CREATE — cualquier usuario autenticado ───
router.post('/', requireAuth, async (req, res) => {
  const { vale, fecha, estacion_id, placa_id, galones, precio } = req.body;
  if (!vale || !fecha || !estacion_id || !placa_id || !galones) {
    req.flash('error', 'Vale, Fecha, Estacion, Placa y Galones son obligatorios.');
    return res.redirect('/combustible');
  }
  const { estacion_nombre, placa_numero } = await nombresActuales(estacion_id, placa_id);
  const { error } = await db.insert('combustible_registros', {
    vale: vale.trim().toUpperCase(), fecha, estacion_id, placa_id, estacion_nombre, placa_numero,
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
  // Se vuelve a tomar la foto del nombre actual: si el admin dejó la
  // misma estación/placa, queda igual; si la cambió a propósito, la
  // foto se actualiza a la nueva (es una edición explícita, no un
  // cambio "invisible" del catálogo).
  const { estacion_nombre, placa_numero } = await nombresActuales(estacion_id, placa_id);
  const { error } = await db.update('combustible_registros', `id=eq.${req.params.id}`, {
    vale: vale.trim().toUpperCase(), fecha, estacion_id, placa_id, estacion_nombre, placa_numero,
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
