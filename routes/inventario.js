// =============================================
// routes/inventario.js
// Módulo de Inventario — pendiente de implementar
// =============================================
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.render('inventario/index', {
    layout: 'main',
    title: 'Inventario',
    pageTitle: 'Inventario',
    pageSubtitle: 'Control de stock y productos'
  });
});

module.exports = router;
