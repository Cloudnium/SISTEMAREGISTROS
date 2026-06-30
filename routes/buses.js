// =============================================
// routes/buses.js — Módulo de Buses
// Gestión de flota, seguros y documentación
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// ─── Helper: calcula estado del bus según vigencias ───
// "Operativo"    → SOAT y TUC vigentes (más de 0 días)
// "Por vencer"   → algún documento vence en menos de 30 días
// "Vencido"      → algún documento ya venció
function calcularEstado(soat_vigencia, tuc_vigencia) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fechas = [soat_vigencia, tuc_vigencia].filter(Boolean).map(f => new Date(f));
  if (fechas.length === 0) return 'sin-datos';
  const diasMin = Math.min(...fechas.map(f => Math.floor((f - hoy) / 86400000)));
  if (diasMin < 0)  return 'vencido';
  if (diasMin < 30) return 'por-vencer';
  return 'operativo';
}

// ─── Helper: días hasta una fecha ───
function diasHasta(fecha) {
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return Math.floor((new Date(fecha) - hoy) / 86400000);
}

// ─── GET / — Lista buses ──────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data: buses } = await db.select('buses',
    'select=id,placa,marca,modelo,soat_vigencia,tuc_vigencia,activo,servicios(id,nombre,categoria,icono)&order=creado_en.desc');

  const { data: servicios } = await db.select('servicios',
    'select=id,nombre,icono,categoria&activo=eq.true&order=nombre.asc');

  const lista = (buses || []).map(b => ({
    ...b,
    estado: calcularEstado(b.soat_vigencia, b.tuc_vigencia),
    diasSoat: diasHasta(b.soat_vigencia),
    diasTuc:  diasHasta(b.tuc_vigencia)
  }));

  res.render('buses/index', {
    layout: 'main', title: 'Buses',
    pageTitle: 'Módulo de Buses',
    pageSubtitle: 'Gestión de flota, seguros y documentación técnica',
    buses: lista,
    servicios: servicios || []
  });
});

// ─── GET /:id/json — Para edición AJAX ───────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('buses',
    `select=*&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0)
    return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── POST / — Crear bus ───────────────────────
router.post('/', requireAuth, async (req, res) => {
  const {
    placa, marca, modelo, anio_fabricacion,
    nro_ejes, nro_ruedas, nro_motor, chasis,
    soat_poliza, soat_asientos, soat_vigencia,
    soat_poliza_dano, soat_vigencia_dano, soat_monto_asegurado,
    tuc_numero, tuc_vigencia, extintor_vigencia, total_asientos,
    servicio_id
  } = req.body;

  if (!placa || !placa.trim()) {
    req.flash('error', 'La placa es obligatoria.');
    return res.redirect('/buses');
  }

  const toInt  = v => v && v !== '' ? parseInt(v)   : null;
  const toNum  = v => v && v !== '' ? parseFloat(v) : null;
  const toDate = v => v && v !== '' ? v              : null;
  const toTxt  = v => v && v.trim() !== '' ? v.trim() : null;

  const { error } = await db.insert('buses', {
    placa:                toTxt(placa)?.toUpperCase(),
    marca:                toTxt(marca), modelo: toTxt(modelo),
    anio_fabricacion:     toInt(anio_fabricacion),
    nro_ejes:             toInt(nro_ejes), nro_ruedas: toInt(nro_ruedas),
    nro_motor:            toTxt(nro_motor), chasis: toTxt(chasis),
    soat_poliza:          toTxt(soat_poliza),
    soat_asientos:        toInt(soat_asientos),
    soat_vigencia:        toDate(soat_vigencia),
    soat_poliza_dano:     toTxt(soat_poliza_dano),
    soat_vigencia_dano:   toDate(soat_vigencia_dano),
    soat_monto_asegurado: toNum(soat_monto_asegurado),
    tuc_numero:           toTxt(tuc_numero),
    tuc_vigencia:         toDate(tuc_vigencia),
    extintor_vigencia:    toDate(extintor_vigencia),
    total_asientos:       toInt(total_asientos),
    servicio_id:          servicio_id && servicio_id !== '' ? servicio_id : null,
    activo: true, creado_en: new Date().toISOString()
  });

  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Bus registrado correctamente.');
  res.redirect('/buses');
});

// ─── POST /:id/editar — Actualizar — SOLO admin
router.post('/:id/editar', requireAuth, requireAdminToEdit, async (req, res) => {
  const {
    placa, marca, modelo, anio_fabricacion,
    nro_ejes, nro_ruedas, nro_motor, chasis,
    soat_poliza, soat_asientos, soat_vigencia,
    soat_poliza_dano, soat_vigencia_dano, soat_monto_asegurado,
    tuc_numero, tuc_vigencia, extintor_vigencia, total_asientos,
    servicio_id, activo
  } = req.body;

  if (!placa || !placa.trim()) {
    req.flash('error', 'La placa es obligatoria.');
    return res.redirect('/buses');
  }

  const toInt  = v => v && v !== '' ? parseInt(v)   : null;
  const toNum  = v => v && v !== '' ? parseFloat(v) : null;
  const toDate = v => v && v !== '' ? v              : null;
  const toTxt  = v => v && v.trim() !== '' ? v.trim() : null;

  const { error } = await db.update('buses', `id=eq.${req.params.id}`, {
    placa:                toTxt(placa)?.toUpperCase(),
    marca:                toTxt(marca), modelo: toTxt(modelo),
    anio_fabricacion:     toInt(anio_fabricacion),
    nro_ejes:             toInt(nro_ejes), nro_ruedas: toInt(nro_ruedas),
    nro_motor:            toTxt(nro_motor), chasis: toTxt(chasis),
    soat_poliza:          toTxt(soat_poliza),
    soat_asientos:        toInt(soat_asientos),
    soat_vigencia:        toDate(soat_vigencia),
    soat_poliza_dano:     toTxt(soat_poliza_dano),
    soat_vigencia_dano:   toDate(soat_vigencia_dano),
    soat_monto_asegurado: toNum(soat_monto_asegurado),
    tuc_numero:           toTxt(tuc_numero),
    tuc_vigencia:         toDate(tuc_vigencia),
    extintor_vigencia:    toDate(extintor_vigencia),
    total_asientos:       toInt(total_asientos),
    servicio_id:          servicio_id && servicio_id !== '' ? servicio_id : null,
    activo: activo === 'on' || activo === true
  });

  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Bus actualizado correctamente.');
  res.redirect('/buses');
});

// ─── POST /:id/eliminar — SOLO admin ─────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('buses', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Bus eliminado.');
  res.redirect('/buses');
});

module.exports = router;
