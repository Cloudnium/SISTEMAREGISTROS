// =============================================
// routes/personal.js — Gestión de Personal/Tripulantes
// GET /          → todos los roles autenticados
// POST /         → registrar (todos)
// GET  /:id/json → datos para editar
// POST /:id/editar   → SOLO admin
// POST /:id/eliminar → SOLO admin
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// ─── LIST ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data: tripulantes } = await db.select('personal_tripulantes',
    'select=id,nombres,apellidos,tipo,dni,telefono,licencia,activo&order=creado_en.desc');

  const lista = tripulantes || [];

  // Contadores por tipo — siempre se calculan aunque no haya registros
  const resumen = {
    choferes:   lista.filter(t => t.tipo === 'Chofer'    && t.activo).length,
    terramozas: lista.filter(t => t.tipo === 'Terramoza' && t.activo).length,
    ayudantes:  lista.filter(t => t.tipo === 'Ayudante'  && t.activo).length
  };

  res.render('personal/index', {
    layout: 'main', title: 'Personal',
    pageTitle: 'Gestión de Personal',
    pageSubtitle: 'Tripulación activa para rutas e itinerarios',
    tripulantes: lista,
    resumen
  });
});

// ─── JSON para edición AJAX ───────────────────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('personal_tripulantes',
    `select=id,nombres,apellidos,tipo,dni,telefono,licencia,activo&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0)
    return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── CREATE — cualquier usuario autenticado ───
router.post('/', requireAuth, async (req, res) => {
  const { nombres, apellidos, tipo, dni, telefono, licencia } = req.body;
  if (!nombres || !apellidos || !tipo || !dni) {
    req.flash('error', 'Nombres, Apellidos, Tipo de Personal y DNI son obligatorios.');
    return res.redirect('/personal');
  }
  const { error } = await db.insert('personal_tripulantes', {
    nombres: nombres.trim(),
    apellidos: apellidos.trim(),
    tipo,
    dni: dni.trim(),
    telefono: telefono && telefono.trim() !== '' ? telefono.trim() : null,
    // La licencia solo se guarda si el tipo es Chofer
    licencia: (tipo === 'Chofer' && licencia && licencia.trim() !== '') ? licencia.trim().toUpperCase() : null,
    activo: true,
    creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Tripulante registrado correctamente.');
  res.redirect('/personal');
});

// ─── UPDATE — SOLO admin ──────────────────────
router.post('/:id/editar', requireAuth, requireAdminToEdit, async (req, res) => {
  const { nombres, apellidos, tipo, dni, telefono, licencia, activo } = req.body;
  if (!nombres || !apellidos || !tipo || !dni) {
    req.flash('error', 'Completa todos los campos obligatorios.');
    return res.redirect('/personal');
  }
  const { error } = await db.update('personal_tripulantes', `id=eq.${req.params.id}`, {
    nombres: nombres.trim(),
    apellidos: apellidos.trim(),
    tipo,
    dni: dni.trim(),
    telefono: telefono && telefono.trim() !== '' ? telefono.trim() : null,
    licencia: (tipo === 'Chofer' && licencia && licencia.trim() !== '') ? licencia.trim().toUpperCase() : null,
    activo: activo === 'on' || activo === true
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Tripulante actualizado correctamente.');
  res.redirect('/personal');
});

// ─── DELETE — SOLO admin ──────────────────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('personal_tripulantes', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Tripulante eliminado.');
  res.redirect('/personal');
});

module.exports = router;
