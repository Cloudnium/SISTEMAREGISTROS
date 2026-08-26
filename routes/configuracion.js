// =============================================
// routes/configuracion.js — Visibilidad de secciones (Desarrollador)
// GET  /              → pantalla de checklist (SOLO desarrollador/admin)
// POST /:clave/toggle → prende/apaga una sección (SOLO desarrollador/admin)
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireDesarrollador } = require('../middleware/auth');

// Etiquetas legibles para cada sección (deben existir también como
// filas en configuracion_secciones — ver PLANILLA_INVENTARIO_DESARROLLADOR_MIGRATION.sql)
const SECCIONES = [
  { clave: 'boletaje', nombre: 'Boletaje', icono: 'ticket' },
  { clave: 'consulta-documentos', nombre: 'Consulta de Documentos', icono: 'file-search' },
  { clave: 'servicios', nombre: 'Servicios', icono: 'layout-grid' },
  { clave: 'buses', nombre: 'Buses', icono: 'bus' },
  { clave: 'ciudades', nombre: 'Ciudades / Agencias', icono: 'map-pin' },
  { clave: 'destinos', nombre: 'Destinos', icono: 'route' },
  { clave: 'comprobantes', nombre: 'Comprobantes', icono: 'receipt' },
  { clave: 'codigos', nombre: 'Códigos de Autorización', icono: 'key-round' },
  { clave: 'programacion', nombre: 'Programación', icono: 'calendar-clock' },
  { clave: 'usuarios', nombre: 'Usuarios', icono: 'shield-check' },
  { clave: 'empresas', nombre: 'Empresas', icono: 'building-2' },
  { clave: 'mapa-asientos', nombre: 'Mapa de Asientos', icono: 'layout-dashboard' },
  { clave: 'planilla', nombre: 'Planilla', icono: 'wallet' }
];

router.get('/', requireAuth, requireDesarrollador, async (req, res) => {
  const { data: filas } = await db.select('configuracion_secciones', 'select=clave,visible');
  const estado = {};
  (filas || []).forEach(f => { estado[f.clave] = f.visible; });
  const secciones = SECCIONES.map(s => ({ ...s, visible: estado[s.clave] !== false }));
  res.render('configuracion/index', {
    layout: 'main', title: 'Configuración',
    pageTitle: 'Configuración del Sistema',
    pageSubtitle: 'Oculta secciones temporalmente mientras trabajas en ellas — Combustible, Personal e Inventario siempre quedan visibles',
    secciones
  });
});

router.post('/:clave/toggle', requireAuth, requireDesarrollador, async (req, res) => {
  const clave = req.params.clave;
  if (!SECCIONES.some(s => s.clave === clave)) {
    return res.status(400).json({ error: 'Sección desconocida.' });
  }
  const { data: existente } = await db.select('configuracion_secciones', `select=visible&clave=eq.${clave}&limit=1`);
  const actual = existente && existente[0] ? existente[0].visible : true;
  const { error } = await db.update('configuracion_secciones', `clave=eq.${clave}`, {
    visible: !actual, actualizado_por: req.session.user.id, actualizado_en: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, visible: !actual });
});

module.exports = router;
