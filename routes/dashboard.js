// =============================================
// routes/dashboard.js
// Ruta principal del dashboard — vista general
// =============================================

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// ─────────────────────────────────────────────
// GET /dashboard — Página principal del sistema
// Por ahora vacía, se irán agregando widgets
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  res.render('dashboard/index', {
    layout: 'main',
    title: 'Dashboard',
    pageTitle: 'Panel Principal',
    pageSubtitle: 'Vista general de tu negocio en tiempo real'
  });
});

module.exports = router;
