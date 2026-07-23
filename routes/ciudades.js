// =============================================
// routes/ciudades.js — Infraestructura Geográfica
// Ciudades y Agencias/Terminales de embarque
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdmin, requireAdminToDelete } = require('../middleware/auth');

// ─── GET / — Carga ciudades y agencias ───────
router.get('/', requireAuth, async (req, res) => {
  const { data: ciudades } = await db.select('ciudades',
    'select=id,nombre&order=id.asc');
  const { data: agencias } = await db.select('agencias',
    'select=id,nombre,direccion,ciudad_id,serie_boleto,correlativo_actual,serie_factura,correlativo_factura,color,ciudades(nombre)&activo=eq.true&order=creado_en.desc');

  res.render('ciudades/index', {
    layout: 'main', title: 'Ciudades / Agencias',
    pageTitle: 'Infraestructura Geográfica',
    pageSubtitle: 'Definición de terminales de embarque',
    ciudades:  ciudades  || [],
    agencias:  agencias  || []
  });
});

// ─── POST /ciudad — Crea una ciudad ──────────
router.post('/ciudad', requireAuth, async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'El nombre de la ciudad es obligatorio.');
    return res.redirect('/ciudades');
  }
  const { error } = await db.insert('ciudades', {
    nombre: nombre.trim().toUpperCase(),
    creado_en: new Date().toISOString()
  });
  if (error) {
    if (error.message && error.message.includes('unique'))
      req.flash('error', 'Esa ciudad ya existe.');
    else
      req.flash('error', 'Error al guardar: ' + error.message);
  } else {
    req.flash('success', 'Ciudad agregada correctamente.');
  }
  res.redirect('/ciudades');
});

// ─── POST /ciudad/:id/eliminar — Elimina ciudad (solo admin) ──
router.post('/ciudad/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('ciudades', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Ciudad eliminada.');
  res.redirect('/ciudades');
});

// ─── POST /agencia — Crea una agencia ─────────
router.post('/agencia', requireAuth, async (req, res) => {
  const { nombre, ciudad_id, direccion, serie_boleto, serie_factura, color } = req.body;
  if (!nombre || !nombre.trim() || !ciudad_id) {
    req.flash('error', 'Nombre y Ciudad son obligatorios.');
    return res.redirect('/ciudades');
  }
  const { error } = await db.insert('agencias', {
    nombre:    nombre.trim(),
    ciudad_id: parseInt(ciudad_id),
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    serie_boleto:  serie_boleto  && serie_boleto.trim()  !== '' ? serie_boleto.trim().toUpperCase()  : null,
    serie_factura: serie_factura && serie_factura.trim() !== '' ? serie_factura.trim().toUpperCase() : null,
    color:     color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1',
    activo:    true,
    creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Agencia guardada correctamente.');
  res.redirect('/ciudades');
});

// ─── POST /agencia/:id/eliminar — Elimina agencia (solo admin) ──
router.post('/agencia/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('agencias', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Agencia eliminada.');
  res.redirect('/ciudades');
});

// ─── POST /agencia/:id/editar — Actualiza una agencia (SOLO admin) ──
router.post('/agencia/:id/editar', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, ciudad_id, direccion, serie_boleto, serie_factura, color } = req.body;
  if (!nombre || !nombre.trim() || !ciudad_id) {
    req.flash('error', 'Nombre y Ciudad son obligatorios.');
    return res.redirect('/ciudades');
  }
  const { error } = await db.update('agencias', `id=eq.${req.params.id}`, {
    nombre:    nombre.trim(),
    ciudad_id: parseInt(ciudad_id),
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    serie_boleto:  serie_boleto  && serie_boleto.trim()  !== '' ? serie_boleto.trim().toUpperCase()  : null,
    serie_factura: serie_factura && serie_factura.trim() !== '' ? serie_factura.trim().toUpperCase() : null,
    color:     color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1'
  });
  if (error) req.flash('error', 'Error al actualizar la agencia: ' + error.message);
  else       req.flash('success', 'Agencia actualizada correctamente.');
  res.redirect('/ciudades');
});

module.exports = router;
