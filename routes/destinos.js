// =============================================
// routes/destinos.js — Gestión de Destinos
// Vinculado a ciudades y agencias
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToDelete } = require('../middleware/auth');

// ─── GET / — Lista destinos + carga combos ────
router.get('/', requireAuth, async (req, res) => {
  const { data: destinos } = await db.select('destinos',
    'select=id,ciudad_origen,ciudad_destino,agencia_id,' +
    'ciudades_origen:ciudades!ciudad_origen(nombre),' +
    'ciudades_destino:ciudades!ciudad_destino(nombre),' +
    'agencias(nombre)' +
    '&order=creado_en.desc');

  const { data: ciudades } = await db.select('ciudades',
    'select=id,nombre&order=nombre.asc');

  const { data: agencias } = await db.select('agencias',
    'select=id,nombre,ciudad_id&activo=eq.true&order=nombre.asc');

  res.render('destinos/index', {
    layout: 'main', title: 'Destinos',
    pageTitle: 'Gestión de Destinos comerciales',
    pageSubtitle: 'Asociación de rutas de venta origen-destino',
    destinos:     destinos  || [],
    ciudades:     ciudades  || [],
    agencias:     agencias  || [],
    // JSON serializado para el filtro dinámico en el cliente
    agenciasJson: JSON.stringify(agencias || [])
  });
});

// ─── GET /agencias-por-ciudad/:ciudadId — AJAX ──
// Devuelve las agencias de una ciudad para el filtro dinámico
router.get('/agencias-por-ciudad/:ciudadId', requireAuth, async (req, res) => {
  const { data, error } = await db.select('agencias',
    `select=id,nombre&ciudad_id=eq.${req.params.ciudadId}&activo=eq.true&order=nombre.asc`);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── POST / — Crear destino ───────────────────
router.post('/', requireAuth, async (req, res) => {
  const { ciudad_origen, ciudad_destino, agencia_id } = req.body;
  if (!ciudad_origen || !ciudad_destino || !agencia_id) {
    req.flash('error', 'Ciudad Origen, Ciudad Destino y Agencia son obligatorios.');
    return res.redirect('/destinos');
  }
  if (ciudad_origen === ciudad_destino) {
    req.flash('error', 'La ciudad origen y destino no pueden ser la misma.');
    return res.redirect('/destinos');
  }
  const { error } = await db.insert('destinos', {
    ciudad_origen:  parseInt(ciudad_origen),
    ciudad_destino: parseInt(ciudad_destino),
    agencia_id:     agencia_id,
    creado_en:      new Date().toISOString()
  });
  if (error) {
    if (error.message && error.message.includes('unique'))
      req.flash('error', 'Ese destino ya existe con la misma agencia.');
    else
      req.flash('error', 'Error al guardar: ' + error.message);
  } else {
    req.flash('success', 'Destino registrado correctamente.');
  }
  res.redirect('/destinos');
});

// ─── POST /:id/eliminar — SOLO admin ─────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('destinos', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Destino eliminado.');
  res.redirect('/destinos');
});

module.exports = router;
