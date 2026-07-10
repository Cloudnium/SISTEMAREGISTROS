// =============================================
// routes/mapa-asientos.js — Mapa de Asientos
// Editor interactivo de distribución de bus
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ─── GET / — Vista principal ──────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { data: buses } = await db.select('buses',
    'select=id,placa,marca,modelo&activo=eq.true&order=placa.asc');
  res.render('mapa-asientos/index', {
    layout: 'main', title: 'Mapa de Asientos',
    pageTitle: 'Mapa de Asientos',
    pageSubtitle: 'Selección y guardado de distribución',
    buses: buses || [],
    busesJson: JSON.stringify(buses || [])
  });
});

// ─── GET /:busId/datos — Carga config + asientos (AJAX) ──
router.get('/:busId/datos', requireAuth, requireAdmin, async (req, res) => {
  const busId = req.params.busId;
  const { data: cfg } = await db.select('bus_config_asientos',
    `select=*&bus_id=eq.${busId}&limit=1`);
  const { data: asientos } = await db.select('bus_asientos',
    `select=piso,fila,columna,numero_asiento&bus_id=eq.${busId}&order=piso.asc,fila.asc,columna.asc`);
  res.json({ config: cfg && cfg[0] ? cfg[0] : null, asientos: asientos || [] });
});

// ─── POST /:busId/guardar — Guarda config + asientos (AJAX) ──
router.post('/:busId/guardar', requireAuth, requireAdmin, async (req, res) => {
  const busId = req.params.busId;
  const { num_pisos, filas_p1, columnas_p1, filas_p2, columnas_p2, asientos } = req.body;

  // 1. Upsert configuración
  const { data: cfgExiste } = await db.select('bus_config_asientos',
    `select=id&bus_id=eq.${busId}&limit=1`);

  const cfgData = {
    bus_id: busId,
    num_pisos:   parseInt(num_pisos)   || 1,
    filas_p1:    parseInt(filas_p1)    || 4,
    columnas_p1: parseInt(columnas_p1) || 4,
    filas_p2:    parseInt(filas_p2)    || 0,
    columnas_p2: parseInt(columnas_p2) || 0,
    actualizado_en: new Date().toISOString()
  };

  let cfgError;
  if (cfgExiste && cfgExiste.length > 0) {
    const r = await db.update('bus_config_asientos', `bus_id=eq.${busId}`, cfgData);
    cfgError = r.error;
  } else {
    const r = await db.insert('bus_config_asientos', cfgData);
    cfgError = r.error;
  }
  if (cfgError) return res.status(500).json({ error: cfgError.message });

  // 2. Borra asientos anteriores y reinserta los nuevos
  await db.delete('bus_asientos', `bus_id=eq.${busId}`);

  const lista = Array.isArray(asientos) ? asientos : JSON.parse(asientos || '[]');
  for (const a of lista) {
    if (!a.numero_asiento || a.numero_asiento.trim() === '') continue;
    await db.insert('bus_asientos', {
      bus_id:         busId,
      piso:           parseInt(a.piso)    || 1,
      fila:           parseInt(a.fila)    || 1,
      columna:        parseInt(a.columna) || 1,
      numero_asiento: a.numero_asiento.trim()
    });
  }

  res.json({ ok: true });
});

module.exports = router;
