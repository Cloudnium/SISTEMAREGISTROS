// =============================================
// routes/empresas.js — Empresas propietarias de buses
// RUC, Razón Social, Domicilio Fiscal
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdmin, requireAdminToDelete } = require('../middleware/auth');

// Tamaño máximo del logo en base64 (~500 KB) — evita que alguien
// suba una imagen enorme y sature la columna de la base de datos.
const LOGO_MAX_CHARS = 700000;
function logoValido(v) {
  if (!v || v.trim() === '') return { ok: true, valor: null };
  if (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(v)) {
    return { ok: false, error: 'El logo debe ser una imagen (PNG, JPG, WEBP o SVG).' };
  }
  if (v.length > LOGO_MAX_CHARS) {
    return { ok: false, error: 'El logo es demasiado pesado. Usa una imagen más liviana (menos de ~500 KB).' };
  }
  return { ok: true, valor: v };
}

// ─── GET / — Lista de empresas ────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { data: empresas, error } = await db.select('empresas',
    'select=id,ruc,razon_social,domicilio_fiscal,logo_data_url,activo,creado_en&order=creado_en.desc');
  if (error) console.error('empresas list:', error);
  res.render('empresas/index', {
    layout: 'main', title: 'Empresas',
    pageTitle: 'Empresas', pageSubtitle: 'Empresas propietarias registradas en el sistema',
    empresas: empresas || []
  });
});

// ─── POST / — Crea una empresa ────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { ruc, razon_social, domicilio_fiscal, logo_data_url } = req.body;
  if (!ruc || !ruc.trim() || !razon_social || !razon_social.trim()) {
    req.flash('error', 'RUC y Razón Social son obligatorios.');
    return res.redirect('/empresas');
  }
  const logo = logoValido(logo_data_url);
  if (!logo.ok) { req.flash('error', logo.error); return res.redirect('/empresas'); }
  const { error } = await db.insert('empresas', {
    ruc: ruc.trim(),
    razon_social: razon_social.trim(),
    domicilio_fiscal: domicilio_fiscal && domicilio_fiscal.trim() !== '' ? domicilio_fiscal.trim() : null,
    logo_data_url: logo.valor,
    activo: true,
    creado_en: new Date().toISOString()
  });
  if (error) {
    req.flash('error', error.message.includes('duplicate') ? 'Ese RUC ya está registrado.' : ('Error al guardar: ' + error.message));
  } else {
    req.flash('success', 'Empresa registrada correctamente.');
  }
  res.redirect('/empresas');
});

// ─── POST /:id/editar — Actualiza una empresa ──
router.post('/:id/editar', requireAuth, requireAdmin, async (req, res) => {
  const { ruc, razon_social, domicilio_fiscal, logo_data_url, quitar_logo } = req.body;
  if (!ruc || !ruc.trim() || !razon_social || !razon_social.trim()) {
    req.flash('error', 'RUC y Razón Social son obligatorios.');
    return res.redirect('/empresas');
  }
  const updates = {
    ruc: ruc.trim(),
    razon_social: razon_social.trim(),
    domicilio_fiscal: domicilio_fiscal && domicilio_fiscal.trim() !== '' ? domicilio_fiscal.trim() : null
  };
  if (quitar_logo === '1') {
    updates.logo_data_url = null;
  } else if (logo_data_url && logo_data_url.trim() !== '') {
    const logo = logoValido(logo_data_url);
    if (!logo.ok) { req.flash('error', logo.error); return res.redirect('/empresas'); }
    updates.logo_data_url = logo.valor;
  }
  const { error } = await db.update('empresas', `id=eq.${req.params.id}`, updates);
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Empresa actualizada correctamente.');
  res.redirect('/empresas');
});

// ─── POST /:id/eliminar — SOLO admin ──────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.update('empresas', `id=eq.${req.params.id}`, { activo: false });
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Empresa eliminada.');
  res.redirect('/empresas');
});

module.exports = router;
