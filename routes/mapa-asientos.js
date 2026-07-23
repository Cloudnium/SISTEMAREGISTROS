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
  const { data: cfg, error: cfgError } = await db.select('bus_config_asientos',
    `select=*&bus_id=eq.${busId}&limit=1`);
  if (cfgError) return res.status(500).json({ error: cfgError.message });

  const { data: asientos, error: asientosError } = await db.select('bus_asientos',
    `select=piso,fila,columna,numero_asiento,tipo&bus_id=eq.${busId}&order=piso.asc,fila.asc,columna.asc`);
  if (asientosError) return res.status(500).json({ error: asientosError.message });

  res.json({ config: cfg && cfg[0] ? cfg[0] : null, asientos: asientos || [] });
});

// ─── POST /:busId/guardar — Guarda config + asientos (AJAX) ──
router.post('/:busId/guardar', requireAuth, requireAdmin, async (req, res) => {
  const busId = req.params.busId;
  const { num_pisos, filas_p1, columnas_p1, filas_p2, columnas_p2, pasillo_p1, pasillo_p2, asientos } = req.body;

  // 1. Upsert configuración
  const { data: cfgExiste } = await db.select('bus_config_asientos',
    `select=id&bus_id=eq.${busId}&limit=1`);

  // Filas limitadas a un máximo de 4 (filas horizontales del piso)
  const fp1 = Math.min(parseInt(filas_p1) || 4, 4);
  const fp2 = Math.min(parseInt(filas_p2) || 0, 4);

  const cfgData = {
    bus_id: busId,
    num_pisos:   parseInt(num_pisos)   || 1,
    filas_p1:    fp1 || 4,
    columnas_p1: parseInt(columnas_p1) || 4,
    filas_p2:    fp2,
    columnas_p2: parseInt(columnas_p2) || 0,
    pasillo_p1:  parseInt(pasillo_p1)  || 0,
    pasillo_p2:  parseInt(pasillo_p2)  || 0,
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
  const { error: delError } = await db.delete('bus_asientos', `bus_id=eq.${busId}`);
  if (delError) return res.status(500).json({ error: delError.message });

  const lista = Array.isArray(asientos) ? asientos : JSON.parse(asientos || '[]');
  const filasInsert = [];
  for (const a of lista) {
    const tipo = a.tipo === 'escalera' ? 'escalera' : 'asiento';
    const numero = (a.numero_asiento || '').trim();
    if (tipo === 'asiento' && numero === '') continue; // asiento vacío: no se guarda
    filasInsert.push({
      bus_id:         busId,
      piso:           parseInt(a.piso)    || 1,
      fila:           parseInt(a.fila)    || 1,
      columna:        parseInt(a.columna) || 1,
      numero_asiento: numero,
      tipo:           tipo
    });
  }

  if (filasInsert.length > 0) {
    const { error: insError } = await db.insert('bus_asientos', filasInsert);
    if (insError) return res.status(500).json({ error: insError.message });
  }

  res.json({ ok: true });
});

module.exports = router;
