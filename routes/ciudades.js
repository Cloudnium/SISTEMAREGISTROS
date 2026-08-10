// =============================================
// routes/ciudades.js — Infraestructura Geográfica
// Ciudades y Agencias/Terminales de embarque
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdmin, requireAdminToCreate, requireAdminToDelete } = require('../middleware/auth');

// ─── GET / — Carga ciudades y agencias ───────
router.get('/', requireAuth, async (req, res) => {
  const { data: ciudades } = await db.select('ciudades',
    'select=id,nombre&order=id.asc');
  const { data: agencias } = await db.select('agencias',
    'select=id,nombre,direccion,ciudad_id,color,ciudades(nombre)&activo=eq.true&order=creado_en.desc');

  res.render('ciudades/index', {
    layout: 'main', title: 'Ciudades / Agencias',
    pageTitle: 'Infraestructura Geográfica',
    pageSubtitle: 'Definición de terminales de embarque',
    ciudades:  ciudades  || [],
    agencias:  agencias  || []
  });
});

// ─── POST /ciudad — Crea una ciudad — SOLO admin ──
router.post('/ciudad', requireAuth, requireAdminToCreate, async (req, res) => {
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

// ─── POST /agencia — Crea una agencia — SOLO admin ──
router.post('/agencia', requireAuth, requireAdminToCreate, async (req, res) => {
  const { nombre, ciudad_id, direccion, color } = req.body;
  if (!nombre || !nombre.trim() || !ciudad_id) {
    req.flash('error', 'Nombre y Ciudad son obligatorios.');
    return res.redirect('/ciudades');
  }
  const { error } = await db.insert('agencias', {
    nombre:    nombre.trim(),
    ciudad_id: parseInt(ciudad_id),
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    color:     color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1',
    activo:    true,
    creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Agencia guardada correctamente. Ahora configura sus series con el botón "Series".');
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
  const { nombre, ciudad_id, direccion, color } = req.body;
  if (!nombre || !nombre.trim() || !ciudad_id) {
    req.flash('error', 'Nombre y Ciudad son obligatorios.');
    return res.redirect('/ciudades');
  }
  const { error } = await db.update('agencias', `id=eq.${req.params.id}`, {
    nombre:    nombre.trim(),
    ciudad_id: parseInt(ciudad_id),
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    color:     color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1'
  });
  if (error) req.flash('error', 'Error al actualizar la agencia: ' + error.message);
  else       req.flash('success', 'Agencia actualizada correctamente.');
  res.redirect('/ciudades');
});

// ═══════════════════════════════════════════════
// Series de boletos/facturas POR AGENCIA + EMPRESA
// (cada empresa dueña de buses tiene su propia numeración legal)
// SOLO admin puede verlas y editarlas.
// ═══════════════════════════════════════════════

// ─── GET /agencia/:id/series — Serie actual por cada empresa activa ──
router.get('/agencia/:id/series', requireAuth, requireAdmin, async (req, res) => {
  const agenciaId = req.params.id;
  const [{ data: empresas }, { data: series }] = await Promise.all([
    db.select('empresas', 'select=id,razon_social,ruc&activo=eq.true&order=razon_social.asc'),
    db.select('series_agencia_empresa',
      `select=empresa_id,serie_boleto,correlativo_actual,serie_boleto_2,correlativo_boleto_2,serie_boleto_activa,serie_factura,correlativo_factura&agencia_id=eq.${agenciaId}`)
  ]);
  const porEmpresa = {};
  (series || []).forEach(s => { porEmpresa[s.empresa_id] = s; });
  const filas = (empresas || []).map(e => ({
    empresa_id: e.id,
    razon_social: e.razon_social,
    ruc: e.ruc,
    serie_boleto:         porEmpresa[e.id] ? porEmpresa[e.id].serie_boleto         : null,
    correlativo_actual:   porEmpresa[e.id] ? porEmpresa[e.id].correlativo_actual   : 0,
    serie_boleto_2:        porEmpresa[e.id] ? porEmpresa[e.id].serie_boleto_2        : null,
    correlativo_boleto_2:  porEmpresa[e.id] ? porEmpresa[e.id].correlativo_boleto_2  : 0,
    serie_boleto_activa:   porEmpresa[e.id] ? (porEmpresa[e.id].serie_boleto_activa || 1) : 1,
    serie_factura:        porEmpresa[e.id] ? porEmpresa[e.id].serie_factura        : null,
    correlativo_factura:  porEmpresa[e.id] ? porEmpresa[e.id].correlativo_factura  : 0
  }));
  res.json({ filas });
});

// ─── POST /agencia/:id/series — Guarda la serie de UNA empresa para esta agencia ──
router.post('/agencia/:id/series', requireAuth, requireAdmin, async (req, res) => {
  const agenciaId = req.params.id;
  const {
    empresa_id, serie_boleto, correlativo_actual,
    serie_boleto_2, correlativo_boleto_2, serie_boleto_activa,
    serie_factura, correlativo_factura
  } = req.body;
  if (!empresa_id) return res.status(400).json({ error: 'Falta la empresa.' });

  const activa = parseInt(serie_boleto_activa);
  const payload = {
    agencia_id: agenciaId,
    empresa_id: empresa_id,
    serie_boleto:  serie_boleto  && String(serie_boleto).trim()  !== '' ? String(serie_boleto).trim().toUpperCase()  : null,
    serie_boleto_2: serie_boleto_2 && String(serie_boleto_2).trim() !== '' ? String(serie_boleto_2).trim().toUpperCase() : null,
    serie_factura: serie_factura && String(serie_factura).trim() !== '' ? String(serie_factura).trim().toUpperCase() : null,
    correlativo_actual:   correlativo_actual   !== undefined && correlativo_actual   !== '' ? parseInt(correlativo_actual)   : 0,
    correlativo_boleto_2: correlativo_boleto_2 !== undefined && correlativo_boleto_2 !== '' ? parseInt(correlativo_boleto_2) : 0,
    correlativo_factura:  correlativo_factura  !== undefined && correlativo_factura  !== '' ? parseInt(correlativo_factura)  : 0,
    serie_boleto_activa: (activa === 1 || activa === 2) ? activa : 1,
    actualizado_en: new Date().toISOString()
  };

  // Upsert manual: intenta actualizar la fila (agencia_id, empresa_id); si no existe, la crea.
  const { data: existente } = await db.select('series_agencia_empresa',
    `select=id&agencia_id=eq.${agenciaId}&empresa_id=eq.${empresa_id}&limit=1`);
  let error;
  if (existente && existente[0]) {
    const r = await db.update('series_agencia_empresa', `id=eq.${existente[0].id}`, payload);
    error = r.error;
  } else {
    const r = await db.insert('series_agencia_empresa', payload);
    error = r.error;
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
