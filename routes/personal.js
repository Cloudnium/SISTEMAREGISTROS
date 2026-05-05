// =============================================
// routes/personal.js
// Módulo de Personal — pendiente de implementar
// =============================================
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.render('personal/index', {
    layout: 'main',
    title: 'Personal',
    pageTitle: 'Personal',
    pageSubtitle: 'Gestión del personal de la empresa'
  });
});

module.exports = router;
