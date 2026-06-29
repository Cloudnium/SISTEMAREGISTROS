// =============================================
// routes/servicios.js — Tipos de Servicio
// GET /             → lista todos
// GET /:id/json     → datos para editar
// POST /            → crear (todos)
// POST /:id/editar  → SOLO admin
// POST /:id/eliminar → SOLO admin
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// ─── LIST ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data: servicios } = await db.select('servicios',
    'select=id,nombre,descripcion,icono,categoria,activo&order=creado_en.asc');
  res.render('servicios/index', {
    layout: 'main', title: 'Servicios',
    pageTitle: 'Tipos de Servicio',
    pageSubtitle: 'Gestión de tipos de servicio disponibles',
    servicios: servicios || []
  });
});

// ─── JSON para edición AJAX ───────────────────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('servicios',
    `select=*&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0)
    return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── CREATE ───────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { nombre, descripcion, icono, categoria } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'El nombre del servicio es obligatorio.');
    return res.redirect('/servicios');
  }
  const { error } = await db.insert('servicios', {
    nombre:      nombre.trim().toUpperCase(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    icono:       icono || 'star',
    categoria:   categoria && categoria.trim() !== '' ? categoria.trim().toUpperCase() : null,
    activo:      true,
    creado_en:   new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Servicio creado correctamente.');
  res.redirect('/servicios');
});

// ─── UPDATE — SOLO admin ──────────────────────
router.post('/:id/editar', requireAuth, requireAdminToEdit, async (req, res) => {
  const { nombre, descripcion, icono, categoria, activo } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'El nombre del servicio es obligatorio.');
    return res.redirect('/servicios');
  }
  const { error } = await db.update('servicios', `id=eq.${req.params.id}`, {
    nombre:      nombre.trim().toUpperCase(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    icono:       icono || 'star',
    categoria:   categoria && categoria.trim() !== '' ? categoria.trim().toUpperCase() : null,
    activo:      activo === 'on' || activo === true
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Servicio actualizado correctamente.');
  res.redirect('/servicios');
});

// ─── DELETE — SOLO admin ──────────────────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('servicios', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Servicio eliminado.');
  res.redirect('/servicios');
});

module.exports = router;
