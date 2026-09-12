// =============================================
// routes/personal.js — Gestión de Personal
// Dos categorías:
//   - tripulacion: Chofer/Terramoza/Ayudante (se siguen usando para
//     asignar a los buses en Programación, igual que antes)
//   - administrativo: cargo libre (Administrativo, Contabilidad,
//     Mecánico, Eléctrico, Limpieza, Lavandería, etc.), filtrable
//     escribiendo el nombre del cargo.
// GET /          → todos los roles autenticados
// POST /         → registrar (todos)
// GET  /:id/json → datos para editar
// POST /:id/editar   → SOLO admin
// POST /:id/eliminar → SOLO admin
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

// ─── LIST ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { cargo, categoria } = req.query;
  let query = 'select=id,nombres,apellidos,categoria,tipo,cargo,area,dni,telefono,licencia,sueldo_base,fecha_ingreso,activo,direccion,tipo_contrato,banco,cuenta_bancaria,afp_onp,dias_vacaciones_disponibles&order=creado_en.desc';
  if (categoria) query += `&categoria=eq.${encodeURIComponent(categoria)}`;
  if (cargo && cargo.trim() !== '') query += `&cargo=ilike.*${encodeURIComponent(cargo.trim())}*`;

  const { data: personalRaw } = await db.select('personal_tripulantes', query);
  const lista = personalRaw || [];

  // Contadores — siempre se calculan aunque no haya registros
  const resumen = {
    choferes:   lista.filter(t => t.tipo === 'Chofer'    && t.activo).length,
    terramozas: lista.filter(t => t.tipo === 'Terramoza' && t.activo).length,
    ayudantes:  lista.filter(t => t.tipo === 'Ayudante'  && t.activo).length,
    administrativos: lista.filter(t => t.categoria === 'administrativo' && t.activo).length
  };

  res.render('personal/index', {
    layout: 'main', title: 'Personal',
    pageTitle: 'Gestión de Personal',
    pageSubtitle: 'Tripulación y personal administrativo',
    tripulantes: lista.filter(t => t.categoria === 'tripulacion'),
    administrativos: lista.filter(t => t.categoria === 'administrativo'),
    resumen,
    filtroCargo: cargo || ''
  });
});

// ─── JSON para edición AJAX ───────────────────
router.get('/:id/json', requireAuth, async (req, res) => {
  const { data, error } = await db.select('personal_tripulantes',
    `select=id,nombres,apellidos,categoria,tipo,cargo,area,dni,telefono,licencia,sueldo_base,fecha_ingreso,activo,direccion,tipo_contrato,banco,cuenta_bancaria,afp_onp,dias_vacaciones_disponibles&id=eq.${req.params.id}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json(data[0]);
});

// ─── Autocompletar cargos ya usados (para filtrar escribiendo) ──
// Cargos preestablecidos que siempre aparecen como sugerencia,
// aunque todavía no se haya registrado nadie con ese cargo. El
// campo sigue permitiendo escribir cualquier otro cargo libremente.
const CARGOS_PREESTABLECIDOS = [
  'ADMINISTRATIVO', 'CONTABILIDAD', 'MECÁNICO', 'ELÉCTRICO',
  'LIMPIEZA', 'LAVANDERÍA', 'SEGURIDAD', 'AYUDANTE DE PATIO',
  'RECEPCIÓN', 'ALMACÉN', 'SISTEMAS', 'RECURSOS HUMANOS'
];

router.get('/cargos/sugerencias', requireAuth, async (req, res) => {
  const { data } = await db.select('personal_tripulantes',
    'select=cargo&categoria=eq.administrativo&cargo=not.is.null');
  const usados = (data || []).map(d => d.cargo).filter(Boolean);
  const unicos = [...new Set([...CARGOS_PREESTABLECIDOS, ...usados])].sort();
  res.json({ cargos: unicos });
});

// ─── CREATE — cualquier usuario autenticado ───
router.post('/', requireAuth, async (req, res) => {
  const { nombres, apellidos, categoria, tipo, cargo, area, dni, telefono, licencia, sueldo_base, fecha_ingreso,
    direccion, tipo_contrato, banco, cuenta_bancaria, afp_onp } = req.body;
  const cat = categoria === 'administrativo' ? 'administrativo' : 'tripulacion';

  if (!nombres || !apellidos || !dni) {
    req.flash('error', 'Nombres, Apellidos y DNI son obligatorios.');
    return res.redirect('/personal');
  }
  if (cat === 'tripulacion' && !tipo) {
    req.flash('error', 'Selecciona el tipo de tripulante (Chofer, Terramoza o Ayudante).');
    return res.redirect('/personal');
  }
  if (cat === 'administrativo' && (!cargo || !cargo.trim())) {
    req.flash('error', 'Indica el cargo (Administrativo, Contabilidad, Mecánico, etc.).');
    return res.redirect('/personal');
  }

  const { error } = await db.insert('personal_tripulantes', {
    nombres: nombres.trim(),
    apellidos: apellidos.trim(),
    categoria: cat,
    tipo: cat === 'tripulacion' ? tipo : null,
    cargo: cat === 'administrativo' ? cargo.trim() : null,
    area: area && area.trim() !== '' ? area.trim() : null,
    dni: dni.trim(),
    telefono: telefono && telefono.trim() !== '' ? telefono.trim() : null,
    licencia: (cat === 'tripulacion' && tipo === 'Chofer' && licencia && licencia.trim() !== '') ? licencia.trim().toUpperCase() : null,
    sueldo_base: sueldo_base && sueldo_base !== '' ? parseFloat(sueldo_base) : null,
    fecha_ingreso: fecha_ingreso && fecha_ingreso !== '' ? fecha_ingreso : null,
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    tipo_contrato: tipo_contrato && tipo_contrato.trim() !== '' ? tipo_contrato.trim() : null,
    banco: banco && banco.trim() !== '' ? banco.trim() : null,
    cuenta_bancaria: cuenta_bancaria && cuenta_bancaria.trim() !== '' ? cuenta_bancaria.trim() : null,
    afp_onp: afp_onp && afp_onp.trim() !== '' ? afp_onp.trim() : null,
    activo: true,
    creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al guardar: ' + error.message);
  else       req.flash('success', 'Personal registrado correctamente.');
  res.redirect('/personal');
});

// ─── UPDATE — SOLO admin ──────────────────────
router.post('/:id/editar', requireAuth, requireAdminToEdit, async (req, res) => {
  const { nombres, apellidos, categoria, tipo, cargo, area, dni, telefono, licencia, sueldo_base, fecha_ingreso, activo,
    direccion, tipo_contrato, banco, cuenta_bancaria, afp_onp } = req.body;
  const cat = categoria === 'administrativo' ? 'administrativo' : 'tripulacion';

  if (!nombres || !apellidos || !dni) {
    req.flash('error', 'Completa todos los campos obligatorios.');
    return res.redirect('/personal');
  }
  if (cat === 'tripulacion' && !tipo) {
    req.flash('error', 'Selecciona el tipo de tripulante.');
    return res.redirect('/personal');
  }
  if (cat === 'administrativo' && (!cargo || !cargo.trim())) {
    req.flash('error', 'Indica el cargo.');
    return res.redirect('/personal');
  }

  const { error } = await db.update('personal_tripulantes', `id=eq.${req.params.id}`, {
    nombres: nombres.trim(),
    apellidos: apellidos.trim(),
    categoria: cat,
    tipo: cat === 'tripulacion' ? tipo : null,
    cargo: cat === 'administrativo' ? cargo.trim() : null,
    area: area && area.trim() !== '' ? area.trim() : null,
    dni: dni.trim(),
    telefono: telefono && telefono.trim() !== '' ? telefono.trim() : null,
    licencia: (cat === 'tripulacion' && tipo === 'Chofer' && licencia && licencia.trim() !== '') ? licencia.trim().toUpperCase() : null,
    sueldo_base: sueldo_base && sueldo_base !== '' ? parseFloat(sueldo_base) : null,
    fecha_ingreso: fecha_ingreso && fecha_ingreso !== '' ? fecha_ingreso : null,
    direccion: direccion && direccion.trim() !== '' ? direccion.trim() : null,
    tipo_contrato: tipo_contrato && tipo_contrato.trim() !== '' ? tipo_contrato.trim() : null,
    banco: banco && banco.trim() !== '' ? banco.trim() : null,
    cuenta_bancaria: cuenta_bancaria && cuenta_bancaria.trim() !== '' ? cuenta_bancaria.trim() : null,
    afp_onp: afp_onp && afp_onp.trim() !== '' ? afp_onp.trim() : null,
    activo: activo === 'on' || activo === true
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Registro actualizado correctamente.');
  res.redirect('/personal');
});

// ─── DELETE — SOLO admin ──────────────────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('personal_tripulantes', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Registro eliminado.');
  res.redirect('/personal');
});

module.exports = router;
