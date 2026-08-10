// =============================================
// routes/destinos.js — Gestión de Destinos
// Vinculado a ciudades y agencias
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToCreate, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

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

  const { data: adicionales } = await db.select('destino_ciudades_adicionales',
    'select=id,destino_id,ciudad_id,ciudades(nombre)&order=creado_en.asc');

  // Agrupa las ciudades adicionales por destino, para pintarlas junto a cada ruta
  const adicionalesPorDestino = {};
  (adicionales || []).forEach(a => {
    if (!adicionalesPorDestino[a.destino_id]) adicionalesPorDestino[a.destino_id] = [];
    adicionalesPorDestino[a.destino_id].push(a);
  });
  (destinos || []).forEach(d => { d.ciudadesAdicionales = adicionalesPorDestino[d.id] || []; });

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

// ─── POST /:id/ciudad-adicional — Agrega una ciudad adicional de llegada ──
// (ej: además de SULLANA, ofrecer también agencias de PIURA en esa misma ruta)
router.post('/:id/ciudad-adicional', requireAuth, requireAdminToEdit, async (req, res) => {
  const { ciudad_id } = req.body;
  if (!ciudad_id) {
    req.flash('error', 'Selecciona una ciudad para agregar.');
    return res.redirect('/destinos');
  }
  const { error } = await db.insert('destino_ciudades_adicionales', {
    destino_id: req.params.id,
    ciudad_id: parseInt(ciudad_id),
    creado_en: new Date().toISOString()
  });
  if (error) {
    req.flash('error', error.message.includes('duplicate') ? 'Esa ciudad ya está agregada a esta ruta.' : ('Error: ' + error.message));
  } else {
    req.flash('success', 'Ciudad adicional agregada a la ruta.');
  }
  res.redirect('/destinos');
});

// ─── POST /:id/ciudad-adicional/:ciudadId/eliminar ──
router.post('/:id/ciudad-adicional/:ciudadId/eliminar', requireAuth, requireAdminToEdit, async (req, res) => {
  const { error } = await db.delete('destino_ciudades_adicionales',
    `destino_id=eq.${req.params.id}&ciudad_id=eq.${req.params.ciudadId}`);
  if (error) req.flash('error', 'Error al quitar: ' + error.message);
  else req.flash('success', 'Ciudad adicional removida de la ruta.');
  res.redirect('/destinos');
});

// ─── GET /agencias-por-ciudad/:ciudadId — AJAX ──
// Devuelve las agencias de una ciudad para el filtro dinámico
router.get('/agencias-por-ciudad/:ciudadId', requireAuth, async (req, res) => {
  const { data, error } = await db.select('agencias',
    `select=id,nombre&ciudad_id=eq.${req.params.ciudadId}&activo=eq.true&order=nombre.asc`);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── POST / — Crear destino — SOLO admin ─────
router.post('/', requireAuth, requireAdminToCreate, async (req, res) => {
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
