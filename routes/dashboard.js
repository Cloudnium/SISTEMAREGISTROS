// =============================================
// routes/dashboard.js
// Ruta principal del dashboard — vista general en tiempo real
// =============================================

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { db } = require('../config/supabase');

// Umbral fijo para considerar un ítem de inventario "stock crítico".
// (Si más adelante se quiere un mínimo configurable por ítem, se puede
// agregar una columna "stock_minimo" a inventario_items / inventario_uniformes
// y reemplazar este número por ese valor.)
const UMBRAL_STOCK_CRITICO = 5;

router.get('/', requireAuth, async (req, res) => {
  const [{ data: personalActivo }, { data: itemsBajoStock }, { data: uniformesBajoStock }] = await Promise.all([
    db.select('personal_tripulantes', 'select=id&activo=eq.true'),
    db.select('inventario_items', `select=id&activo=eq.true&stock=lte.${UMBRAL_STOCK_CRITICO}`),
    db.select('inventario_uniformes', `select=id&activo=eq.true&stock=lte.${UMBRAL_STOCK_CRITICO}`)
  ]);

  res.render('dashboard/index', {
    layout: 'main',
    title: 'Dashboard',
    pageTitle: 'Panel Principal',
    pageSubtitle: 'Vista general de tu negocio en tiempo real',
    totalPersonal: (personalActivo || []).length,
    alertasInventario: (itemsBajoStock || []).length + (uniformesBajoStock || []).length
  });
});

module.exports = router;
