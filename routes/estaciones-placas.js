// =============================================
// routes/estaciones-placas.js
// API JSON (AJAX) para el panel "Estaciones / Placas"
// del Dashboard — permite registrar, editar y eliminar.
//
// Visibilidad/permiso: admin y desarrollador siempre pueden;
// el resto de roles solo si usuarios.puede_gestionar_estaciones_placas
// = true (ver middleware/auth.js → requireEstacionesPlacas).
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireEstacionesPlacas } = require('../middleware/auth');

router.use(requireAuth, requireEstacionesPlacas);

// ─── LIST — Estaciones ─────────────────────────
router.get('/estaciones', async (req, res) => {
  const { data, error } = await db.select('estaciones',
    'select=id,nombre,activo&order=nombre.asc');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── CREATE — Estación ─────────────────────────
router.post('/estaciones', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre de la estación es obligatorio.' });
  const { data, error } = await db.insert('estaciones', {
    nombre, activo: true, creado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, item: (data && data[0]) || null });
});

// ─── UPDATE — Estación ─────────────────────────
router.post('/estaciones/:id/editar', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre de la estación es obligatorio.' });
  const { error } = await db.update('estaciones', `id=eq.${req.params.id}`, { nombre });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── DELETE — Estación ─────────────────────────
router.post('/estaciones/:id/eliminar', async (req, res) => {
  const { error } = await db.delete('estaciones', `id=eq.${req.params.id}`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── LIST — Placas ──────────────────────────────
router.get('/placas', async (req, res) => {
  const { data, error } = await db.select('placas',
    'select=id,numero,activo&order=numero.asc');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── CREATE — Placa ─────────────────────────────
router.post('/placas', async (req, res) => {
  const numero = (req.body.numero || '').trim().toUpperCase();
  if (!numero) return res.status(400).json({ error: 'El número de placa es obligatorio.' });
  const { data, error } = await db.insert('placas', {
    numero, activo: true, creado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, item: (data && data[0]) || null });
});

// ─── UPDATE — Placa ─────────────────────────────
router.post('/placas/:id/editar', async (req, res) => {
  const numero = (req.body.numero || '').trim().toUpperCase();
  if (!numero) return res.status(400).json({ error: 'El número de placa es obligatorio.' });
  const { error } = await db.update('placas', `id=eq.${req.params.id}`, { numero });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── DELETE — Placa ─────────────────────────────
router.post('/placas/:id/eliminar', async (req, res) => {
  const { error } = await db.delete('placas', `id=eq.${req.params.id}`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
