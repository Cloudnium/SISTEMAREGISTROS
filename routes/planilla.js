// =============================================
// routes/planilla.js — Planilla completa
//
// TRABAJADORES sigue siendo personal_tripulantes (no se duplica).
// Planilla guarda solamente lo propio de cada periodo: roster
// (snapshot de sueldo/cargo/área), bonos, descuentos (con saldo) y
// sus cobros por periodo, vacaciones y permisos, y auditoría.
//
// Permisos:
//   - admin / desarrollador          → acceso total.
//   - puede_editar_planilla (RR.HH.) → crear periodos, bonos,
//     descuentos, cobros, vacaciones, permisos, cerrar. Reabrir
//     queda reservado a admin/desarrollador.
//   - puede_ver_planilla (Consulta)  → solo ver, buscar, imprimir,
//     reportes.
// Todos los permisos se validan siempre frescos contra la base de
// datos (usuarioActualFresco), nunca contra la sesión cacheada.
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');
const { registrarAuditoria } = require('../utils/auditoria');

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function esAdminOEditor(u) {
  return !!(u && ((u.rol === 'admin' || u.rol === 'desarrollador') || u.puede_editar_planilla === true));
}
function esAdminODesarrollador(u) {
  return !!(u && (u.rol === 'admin' || u.rol === 'desarrollador'));
}

async function requirePlanillaVer(req, res, next) {
  const u = await usuarioActualFresco(req.session.user);
  if (u && ((u.rol === 'admin' || u.rol === 'desarrollador') || u.puede_ver_planilla === true || u.puede_editar_planilla === true)) {
    req.usuarioFresco = u;
    return next();
  }
  req.flash('error', 'No tienes permiso para ver la Planilla.');
  res.redirect('/dashboard');
}
async function requirePlanillaEditar(req, res, next) {
  const u = req.usuarioFresco || await usuarioActualFresco(req.session.user);
  if (esAdminOEditor(u)) { req.usuarioFresco = u; return next(); }
  req.flash('error', 'No tienes permiso para modificar la Planilla (necesitas el permiso de Planillas/RR.HH.).');
  res.redirect('back');
}
async function requirePlanillaAdmin(req, res, next) {
  const u = req.usuarioFresco || await usuarioActualFresco(req.session.user);
  if (esAdminODesarrollador(u)) { req.usuarioFresco = u; return next(); }
  req.flash('error', 'Reabrir una planilla cerrada requiere permisos de administrador.');
  res.redirect('back');
}

router.use(requireAuth, requirePlanillaVer);

// ── Helper: construye el filtro PostgREST para el buscador inteligente
// (por nombre, apellido, DNI o nombre completo — palabra por palabra) ──
function filtroBusquedaTrabajador(q) {
  const palabras = (q || '').trim().split(/\s+/).filter(Boolean).slice(0, 4)
    .map(w => w.replace(/[(),]/g, ''));
  if (!palabras.length) return null;
  const grupos = palabras.map(w => `or(nombres.ilike.*${encodeURIComponent(w)}*,apellidos.ilike.*${encodeURIComponent(w)}*,dni.ilike.*${encodeURIComponent(w)}*)`);
  return grupos.length === 1 ? `or=(nombres.ilike.*${encodeURIComponent(palabras[0])}*,apellidos.ilike.*${encodeURIComponent(palabras[0])}*,dni.ilike.*${encodeURIComponent(palabras[0])}*)`
                              : `and=(${grupos.join(',')})`;
}

function cargoMostrarDe(p) {
  return p.categoria === 'tripulacion' ? (p.tipo || '—') : (p.cargo || 'Sin cargo');
}

// Días de vacaciones/permiso de un rango de fechas que caen DENTRO de un
// periodo (mes/año) — para no duplicar días entre dos periodos.
function diasEnPeriodo(fechaInicio, fechaFin, mes, anio) {
  const inicioPeriodo = new Date(anio, mes - 1, 1);
  const finPeriodo    = new Date(anio, mes, 0); // último día del mes
  const ini = new Date(fechaInicio), fin = new Date(fechaFin);
  const desde = ini > inicioPeriodo ? ini : inicioPeriodo;
  const hasta = fin < finPeriodo ? fin : finPeriodo;
  if (desde > hasta) return { dias: 0, desde: null, hasta: null };
  const dias = Math.round((hasta - desde) / 86400000) + 1;
  return { dias, desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) };
}

async function obtenerVacacionesPermisosDelPeriodo(personalId, mes, anio) {
  const inicioPeriodo = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const finPeriodo = new Date(anio, mes, 0).toISOString().slice(0, 10);
  const [{ data: vac }, { data: per }] = await Promise.all([
    db.select('planilla_vacaciones',
      `select=id,fecha_inicio,fecha_fin,dias,estado,observacion&personal_id=eq.${personalId}` +
      `&fecha_inicio=lte.${finPeriodo}&fecha_fin=gte.${inicioPeriodo}&order=fecha_inicio.asc`),
    db.select('planilla_permisos',
      `select=id,fecha,hora_inicio,hora_fin,dia_completo,con_goce,motivo,estado,tipo:planilla_tipos_permiso(nombre),descuento:planilla_descuentos(importe_original,saldo)&personal_id=eq.${personalId}` +
      `&fecha=gte.${inicioPeriodo}&fecha=lte.${finPeriodo}&order=fecha.asc`)
  ]);
  const vacaciones = (vac || []).map(v => ({ ...v, ...diasEnPeriodo(v.fecha_inicio, v.fecha_fin, mes, anio) }));
  return { vacaciones, permisos: per || [] };
}

// ═══════════════════════════════════════════════
// 3. RESUMEN — consulta rápida de cualquier trabajador
// ═══════════════════════════════════════════════

router.get('/', (req, res) => res.redirect('/planilla/resumen'));

router.get('/resumen', (req, res) => {
  res.render('planilla/resumen', {
    layout: 'main', title: 'Planilla — Resumen',
    pageTitle: 'Planilla', pageSubtitle: 'Consulta rápida de cualquier trabajador',
    seccionActiva: 'resumen'
  });
});

// Buscador inteligente (autocompletado, se filtra mientras se escribe)
router.get('/resumen/buscar', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ resultados: [] });
  const filtro = filtroBusquedaTrabajador(q);
  if (!filtro) return res.json({ resultados: [] });
  const { data, error } = await db.select('personal_tripulantes',
    `select=id,nombres,apellidos,dni,categoria,tipo,cargo,area,activo&${filtro}&order=apellidos.asc&limit=10`);
  if (error) return res.status(500).json({ error: error.message });
  const resultados = (data || []).map(p => ({
    id: p.id, nombreCompleto: `${p.nombres} ${p.apellidos}`, dni: p.dni,
    cargoMostrar: cargoMostrarDe(p), area: p.area || '', activo: p.activo
  }));
  res.json({ resultados });
});

// Ficha completa de un trabajador: datos actuales + histórico de planillas
router.get('/resumen/:personalId', async (req, res) => {
  const { data: rows } = await db.select('personal_tripulantes',
    `select=*&id=eq.${req.params.personalId}&limit=1`);
  const trabajador = rows && rows[0];
  if (!trabajador) { req.flash('error', 'Trabajador no encontrado.'); return res.redirect('/planilla/resumen'); }

  const [{ data: roster }, { data: descuentos }, { data: vacaciones }, { data: permisos }] = await Promise.all([
    db.select('planilla_periodo_trabajadores',
      `select=id,periodo_id,sueldo_base,periodo:planilla_periodos(id,etiqueta,mes,anio,estado)&personal_id=eq.${req.params.personalId}`),
    db.select('planilla_descuentos',
      `select=id,origen_codigo,importe_original,saldo,estado,fecha,concepto:planilla_conceptos_descuento(nombre)&personal_id=eq.${req.params.personalId}&order=fecha.desc`),
    db.select('planilla_vacaciones',
      `select=id,fecha_inicio,fecha_fin,dias,estado&personal_id=eq.${req.params.personalId}&order=fecha_inicio.desc&limit=10`),
    db.select('planilla_permisos',
      `select=id,fecha,dia_completo,con_goce,estado,motivo&personal_id=eq.${req.params.personalId}&order=fecha.desc&limit=10`)
  ]);

  const rosterIds = (roster || []).map(r => r.id);
  let bonosPorRoster = {}, cobrosPorRoster = {};
  if (rosterIds.length) {
    const [{ data: bonos }, { data: cobros }] = await Promise.all([
      db.select('planilla_bonos', `select=periodo_id,importe&personal_id=eq.${req.params.personalId}`),
      db.select('planilla_descuento_cobros', `select=periodo_id,importe,cobrado&personal_id=eq.${req.params.personalId}&cobrado=eq.true`)
    ]);
    (bonos || []).forEach(b => { bonosPorRoster[b.periodo_id] = (bonosPorRoster[b.periodo_id] || 0) + Number(b.importe); });
    (cobros || []).forEach(c => { cobrosPorRoster[c.periodo_id] = (cobrosPorRoster[c.periodo_id] || 0) + Number(c.importe); });
  }

  const historial = (roster || [])
    .filter(r => r.periodo)
    .map(r => {
      const bonos = bonosPorRoster[r.periodo_id] || 0;
      const descuentosCobrados = cobrosPorRoster[r.periodo_id] || 0;
      const sueldo = Number(r.sueldo_base || 0);
      return {
        periodoId: r.periodo_id, etiqueta: r.periodo.etiqueta, mes: r.periodo.mes, anio: r.periodo.anio,
        estado: r.periodo.estado, rosterId: r.id,
        sueldo, bonos, descuentos: descuentosCobrados, neto: sueldo + bonos - descuentosCobrados
      };
    })
    .sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));

  const ultimo = historial[0] || null;
  const descuentosPendientes = (descuentos || []).filter(d => d.estado === 'pendiente')
    .map(d => ({ ...d, cobrado: Number(d.importe_original) - Number(d.saldo) }));

  res.render('planilla/resumen-trabajador', {
    layout: 'main', title: `Planilla — ${trabajador.nombres} ${trabajador.apellidos}`,
    pageTitle: `${trabajador.nombres} ${trabajador.apellidos}`, pageSubtitle: 'Ficha e histórico de planilla',
    seccionActiva: 'resumen',
    trabajador: { ...trabajador, cargoMostrar: cargoMostrarDe(trabajador) },
    historial, ultimo,
    totalDescuentosPendientes: descuentosPendientes.reduce((s, d) => s + Number(d.saldo), 0),
    descuentosPendientes,
    vacaciones: vacaciones || [], permisos: permisos || [],
    puedeEditar: esAdminOEditor(req.usuarioFresco)
  });
});

// ═══════════════════════════════════════════════
// 4-7. PERIODOS — sección principal de Planilla
// ═══════════════════════════════════════════════

async function totalesDelPeriodo(periodoId) {
  const [{ data: roster }, { data: bonos }, { data: cobros }] = await Promise.all([
    db.select('planilla_periodo_trabajadores', `select=personal_id,sueldo_base&periodo_id=eq.${periodoId}`),
    db.select('planilla_bonos', `select=personal_id,importe&periodo_id=eq.${periodoId}`),
    db.select('planilla_descuento_cobros', `select=personal_id,importe&periodo_id=eq.${periodoId}&cobrado=eq.true`)
  ]);
  const sueldos = (roster || []).reduce((s, r) => s + Number(r.sueldo_base || 0), 0);
  const totalBonos = (bonos || []).reduce((s, b) => s + Number(b.importe), 0);
  const totalCobrado = (cobros || []).reduce((s, c) => s + Number(c.importe), 0);
  return {
    trabajadores: (roster || []).length,
    sueldos, bonos: totalBonos, descuentos: totalCobrado,
    neto: sueldos + totalBonos - totalCobrado
  };
}

router.get('/periodos', async (req, res) => {
  const { data: periodos } = await db.select('planilla_periodos', 'select=id,mes,anio,etiqueta,estado,creado_en,cerrado_en&order=anio.desc,mes.desc');
  const lista = await Promise.all((periodos || []).map(async p => ({ ...p, totales: await totalesDelPeriodo(p.id) })));
  const porAnio = {};
  lista.forEach(p => { (porAnio[p.anio] = porAnio[p.anio] || []).push(p); });
  const anios = Object.keys(porAnio).sort((a, b) => b - a).map(a => ({ anio: a, periodos: porAnio[a] }));

  res.render('planilla/periodos', {
    layout: 'main', title: 'Periodos de Planilla',
    pageTitle: 'Periodos de Planilla', pageSubtitle: 'Historial de planillas mes a mes',
    seccionActiva: 'periodos', anios, meses: MESES, currentYear: new Date().getFullYear(),
    puedeEditar: esAdminOEditor(req.usuarioFresco)
  });
});

router.post('/periodos', requirePlanillaEditar, async (req, res) => {
  const mes = parseInt(req.body.mes), anio = parseInt(req.body.anio);
  if (!mes || mes < 1 || mes > 12 || !anio) {
    req.flash('error', 'Selecciona un mes y año válidos.');
    return res.redirect('/planilla/periodos');
  }
  const { data, error } = await db.rpc('planilla_crear_periodo', { p_mes: mes, p_anio: anio, p_usuario_id: req.session.user.id });
  if (error) {
    req.flash('error', error.message.includes('duplicate') ? 'Ya existe un periodo para ese mes y año.' : ('Error: ' + error.message));
    return res.redirect('/planilla/periodos');
  }
  const periodoId = Array.isArray(data) ? data[0] : data;
  await registrarAuditoria({
    usuario: req.session.user, accion: 'crear_periodo', entidad: 'periodo',
    entidad_id: periodoId, periodo_id: periodoId, valor_nuevo: { mes, anio }
  });
  req.flash('success', `Periodo ${MESES[mes]} ${anio} creado.`);
  res.redirect('/planilla/periodos');
});

router.get('/periodos/:id', async (req, res) => {
  const { data: periodoRows } = await db.select('planilla_periodos', `select=*&id=eq.${req.params.id}&limit=1`);
  const periodo = periodoRows && periodoRows[0];
  if (!periodo) { req.flash('error', 'Periodo no encontrado.'); return res.redirect('/planilla/periodos'); }

  const { q, area, cargo } = req.query;
  let query = `select=id,personal_id,sueldo_base,cargo,area,categoria,tipo,personal:personal_tripulantes(nombres,apellidos,dni,activo)&periodo_id=eq.${req.params.id}&order=apellidos.asc`;
  // El orden por relación embebida no siempre funciona en PostgREST — se ordena en JS igual.
  query = query.replace('&order=apellidos.asc', '');
  const { data: rosterRaw } = await db.select('planilla_periodo_trabajadores', query);
  let roster = rosterRaw || [];

  if (area && area.trim()) roster = roster.filter(r => (r.area || '').toLowerCase().includes(area.trim().toLowerCase()));
  if (cargo && cargo.trim()) roster = roster.filter(r => (r.cargo || r.tipo || '').toLowerCase().includes(cargo.trim().toLowerCase()));
  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    roster = roster.filter(r => r.personal && (
      `${r.personal.nombres} ${r.personal.apellidos}`.toLowerCase().includes(term) || (r.personal.dni || '').includes(term)
    ));
  }

  const rosterIds = roster.map(r => r.id);
  const personalIds = roster.map(r => r.personal_id);
  let bonosPorPersonal = {}, cobrosPorPersonal = {}, pendientesPorPersonal = {};
  if (personalIds.length) {
    const [{ data: bonos }, { data: cobros }, { data: pendientes }] = await Promise.all([
      db.select('planilla_bonos', `select=personal_id,importe&periodo_id=eq.${req.params.id}`),
      db.select('planilla_descuento_cobros', `select=personal_id,importe&periodo_id=eq.${req.params.id}&cobrado=eq.true`),
      db.select('planilla_descuentos', `select=personal_id&estado=eq.pendiente&personal_id=in.(${personalIds.join(',')})`)
    ]);
    (bonos || []).forEach(b => { bonosPorPersonal[b.personal_id] = (bonosPorPersonal[b.personal_id] || 0) + Number(b.importe); });
    (cobros || []).forEach(c => { cobrosPorPersonal[c.personal_id] = (cobrosPorPersonal[c.personal_id] || 0) + Number(c.importe); });
    (pendientes || []).forEach(d => { pendientesPorPersonal[d.personal_id] = (pendientesPorPersonal[d.personal_id] || 0) + 1; });
  }

  const filas = roster.map(r => {
    const sueldo = Number(r.sueldo_base || 0);
    const bonos = bonosPorPersonal[r.personal_id] || 0;
    const descuentos = cobrosPorPersonal[r.personal_id] || 0;
    return {
      rosterId: r.id, personalId: r.personal_id,
      nombreCompleto: r.personal ? `${r.personal.nombres} ${r.personal.apellidos}` : '—',
      dni: r.personal ? r.personal.dni : '—',
      cargoMostrar: r.categoria === 'tripulacion' ? (r.tipo || '—') : (r.cargo || '—'),
      area: r.area || '—', sueldo, bonos, descuentos, neto: sueldo + bonos - descuentos,
      tieneDescuentosPendientes: !!pendientesPorPersonal[r.personal_id],
      inactivo: r.personal && !r.personal.activo
    };
  }).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));

  // Trabajadores activos que aún no están en este periodo (para "agregar trabajador")
  let disponibles = [];
  if (periodo.estado === 'abierto') {
    const { data: activos } = await db.select('personal_tripulantes', 'select=id,nombres,apellidos,dni,categoria,tipo,cargo&activo=eq.true&order=apellidos.asc');
    const yaEnPeriodo = new Set(roster.map(r => r.personal_id));
    disponibles = (activos || []).filter(p => !yaEnPeriodo.has(p.id))
      .map(p => ({ id: p.id, nombreCompleto: `${p.nombres} ${p.apellidos}`, dni: p.dni, cargoMostrar: cargoMostrarDe(p) }));
  }

  res.render('planilla/periodo-detalle', {
    layout: 'main', title: periodo.etiqueta, pageTitle: periodo.etiqueta,
    pageSubtitle: periodo.estado === 'abierto' ? 'Periodo abierto' : 'Periodo cerrado — histórico',
    seccionActiva: 'periodos', periodo, filas, disponibles,
    filtros: { q: q || '', area: area || '', cargo: cargo || '' },
    puedeEditar: esAdminOEditor(req.usuarioFresco),
    esAdmin: esAdminODesarrollador(req.usuarioFresco)
  });
});

router.post('/periodos/:id/agregar-trabajador', requirePlanillaEditar, async (req, res) => {
  const { personal_id } = req.body;
  if (!personal_id) return res.status(400).json({ error: 'Selecciona un trabajador.' });
  const { error } = await db.rpc('planilla_agregar_trabajador', {
    p_periodo_id: req.params.id, p_personal_id: personal_id, p_usuario_id: req.session.user.id
  });
  if (error) {
    const msg = error.message.includes('YA_EXISTE_EN_PERIODO') ? 'Ese trabajador ya está en este periodo.' :
                error.message.includes('PERIODO_CERRADO') ? 'Este periodo ya está cerrado.' :
                'No se pudo agregar: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'agregar_trabajador', entidad: 'periodo_trabajador',
    entidad_id: personal_id, periodo_id: req.params.id, valor_nuevo: { personal_id }
  });
  res.json({ ok: true });
});

router.post('/periodos/:id/cerrar', requirePlanillaEditar, async (req, res) => {
  const { error } = await db.rpc('planilla_cerrar_periodo', { p_periodo_id: req.params.id, p_usuario_id: req.session.user.id });
  if (error) {
    const msg = error.message.includes('PERIODO_YA_CERRADO') ? 'Este periodo ya estaba cerrado.' : 'No se pudo cerrar: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  await registrarAuditoria({ usuario: req.session.user, accion: 'cerrar_periodo', entidad: 'periodo', entidad_id: req.params.id, periodo_id: req.params.id });
  res.json({ ok: true });
});

router.post('/periodos/:id/reabrir', requirePlanillaAdmin, async (req, res) => {
  const { motivo } = req.body;
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'Indica el motivo de la reapertura.' });
  const { error } = await db.rpc('planilla_reabrir_periodo', {
    p_periodo_id: req.params.id, p_usuario_id: req.session.user.id, p_motivo: motivo.trim()
  });
  if (error) {
    const msg = error.message.includes('PERIODO_NO_CERRADO') ? 'Este periodo no está cerrado.' : 'No se pudo reabrir: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'reabrir_periodo', entidad: 'periodo',
    entidad_id: req.params.id, periodo_id: req.params.id, valor_nuevo: { motivo: motivo.trim() }
  });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// 7-8. DETALLE DE PLANILLA DEL TRABAJADOR (dentro de un periodo)
// ═══════════════════════════════════════════════

async function cargarRosterTrabajador(periodoId, rosterId) {
  const { data } = await db.select('planilla_periodo_trabajadores',
    `select=*,personal:personal_tripulantes(nombres,apellidos,dni,area,cargo,categoria,tipo,activo)&id=eq.${rosterId}&periodo_id=eq.${periodoId}&limit=1`);
  return data && data[0];
}

router.get('/periodos/:periodoId/trabajador/:rosterId', async (req, res) => {
  const { data: periodoRows } = await db.select('planilla_periodos', `select=*&id=eq.${req.params.periodoId}&limit=1`);
  const periodo = periodoRows && periodoRows[0];
  const roster = periodo && await cargarRosterTrabajador(req.params.periodoId, req.params.rosterId);
  if (!periodo || !roster) { req.flash('error', 'No se encontró esa planilla.'); return res.redirect(`/planilla/periodos/${req.params.periodoId}`); }

  const [{ data: bonos }, { data: cobrosDelPeriodo }, { data: pendientesTrabajador }, vacPer] = await Promise.all([
    db.select('planilla_bonos', `select=*&periodo_id=eq.${req.params.periodoId}&personal_id=eq.${roster.personal_id}&order=fecha.asc`),
    db.select('planilla_descuento_cobros', `select=*,descuento:planilla_descuentos(origen_codigo,importe_original,saldo,concepto:planilla_conceptos_descuento(nombre))&periodo_id=eq.${req.params.periodoId}&personal_id=eq.${roster.personal_id}`),
    db.select('planilla_descuentos', `select=*,concepto:planilla_conceptos_descuento(nombre,clave)&personal_id=eq.${roster.personal_id}&estado=eq.pendiente&order=fecha.asc`),
    obtenerVacacionesPermisosDelPeriodo(roster.personal_id, periodo.mes, periodo.anio)
  ]);

  const cobrosPorDescuento = {};
  (cobrosDelPeriodo || []).forEach(c => { cobrosPorDescuento[c.descuento_id] = c; });

  // Descuentos pendientes con la decisión (si existe) tomada en ESTE periodo
  const descuentosConDecision = (pendientesTrabajador || []).map(d => {
    const cobro = cobrosPorDescuento[d.id];
    return {
      ...d,
      cobroEnEstePeriodo: cobro ? { importe: Number(cobro.importe), cobrado: cobro.cobrado } : null
    };
  });

  const totalBonos = (bonos || []).reduce((s, b) => s + Number(b.importe), 0);
  const totalDescontadoEstePeriodo = (cobrosDelPeriodo || []).filter(c => c.cobrado).reduce((s, c) => s + Number(c.importe), 0);
  const sueldo = Number(roster.sueldo_base || 0);
  const totalIngresos = sueldo + totalBonos;
  const neto = totalIngresos - totalDescontadoEstePeriodo;

  res.render('planilla/trabajador-periodo', {
    layout: 'main',
    title: `${roster.personal.nombres} ${roster.personal.apellidos} — ${periodo.etiqueta}`,
    pageTitle: `${roster.personal.nombres} ${roster.personal.apellidos}`, pageSubtitle: periodo.etiqueta,
    seccionActiva: 'periodos', periodo, roster,
    cargoMostrar: roster.categoria === 'tripulacion' ? (roster.tipo || '—') : (roster.cargo || '—'),
    bonos: bonos || [], descuentosConDecision,
    vacaciones: vacPer.vacaciones, permisos: vacPer.permisos,
    totales: { sueldo, bonos: totalBonos, totalIngresos, descuentos: totalDescontadoEstePeriodo, neto },
    puedeEditar: esAdminOEditor(req.usuarioFresco) && periodo.estado === 'abierto',
    periodoAbierto: periodo.estado === 'abierto',
    today: new Date().toISOString().slice(0, 10)
  });
});

router.post('/periodos/:periodoId/trabajador/:rosterId/sueldo', requirePlanillaEditar, async (req, res) => {
  const { data: periodoRows } = await db.select('planilla_periodos', `select=estado&id=eq.${req.params.periodoId}&limit=1`);
  if (!periodoRows || !periodoRows[0] || periodoRows[0].estado !== 'abierto') {
    req.flash('error', 'Solo se puede editar el sueldo mientras el periodo está abierto.');
    return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
  }
  const nuevoSueldo = parseFloat(req.body.sueldo_base);
  if (isNaN(nuevoSueldo) || nuevoSueldo < 0) {
    req.flash('error', 'Sueldo inválido.');
    return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
  }
  const anterior = await cargarRosterTrabajador(req.params.periodoId, req.params.rosterId);
  await db.update('planilla_periodo_trabajadores', `id=eq.${req.params.rosterId}`, { sueldo_base: nuevoSueldo });
  await registrarAuditoria({
    usuario: req.session.user, accion: 'editar_sueldo_planilla', entidad: 'periodo_trabajador',
    entidad_id: req.params.rosterId, periodo_id: req.params.periodoId,
    valor_anterior: { sueldo_base: anterior ? anterior.sueldo_base : null }, valor_nuevo: { sueldo_base: nuevoSueldo }
  });
  req.flash('success', 'Sueldo de esta planilla actualizado.');
  res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
});

// ── Bonos (ligados a trabajador + periodo, sección 8) ──
router.post('/periodos/:periodoId/trabajador/:rosterId/bonos', requirePlanillaEditar, async (req, res) => {
  const roster = await cargarRosterTrabajador(req.params.periodoId, req.params.rosterId);
  const { data: periodoRows } = await db.select('planilla_periodos', `select=estado&id=eq.${req.params.periodoId}&limit=1`);
  if (!roster || !periodoRows || !periodoRows[0] || periodoRows[0].estado !== 'abierto') {
    req.flash('error', 'Solo se pueden agregar bonos mientras el periodo está abierto.');
    return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
  }
  const { concepto, descripcion, importe, fecha, observacion } = req.body;
  const importeNum = parseFloat(importe);
  if (!concepto || !concepto.trim() || isNaN(importeNum) || importeNum <= 0) {
    req.flash('error', 'Indica un concepto y un importe válido (mayor a 0).');
    return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
  }
  const { data, error } = await db.insert('planilla_bonos', {
    periodo_id: req.params.periodoId, personal_id: roster.personal_id,
    concepto: concepto.trim(), descripcion: descripcion || null, importe: importeNum,
    fecha: fecha || new Date().toISOString().slice(0, 10), observacion: observacion || null,
    creado_por: req.session.user.id
  });
  if (error) { req.flash('error', 'Error al registrar el bono: ' + error.message); }
  else {
    await registrarAuditoria({
      usuario: req.session.user, accion: 'crear_bono', entidad: 'bono',
      entidad_id: data && data[0] && data[0].id, periodo_id: req.params.periodoId,
      valor_nuevo: { concepto: concepto.trim(), importe: importeNum }
    });
    req.flash('success', 'Bono agregado.');
  }
  res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
});

router.post('/periodos/:periodoId/trabajador/:rosterId/bonos/:bonoId/eliminar', requirePlanillaEditar, async (req, res) => {
  const { data: periodoRows } = await db.select('planilla_periodos', `select=estado&id=eq.${req.params.periodoId}&limit=1`);
  if (!periodoRows || !periodoRows[0] || periodoRows[0].estado !== 'abierto') {
    req.flash('error', 'No se pueden eliminar bonos de un periodo cerrado.');
    return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
  }
  await db.delete('planilla_bonos', `id=eq.${req.params.bonoId}&periodo_id=eq.${req.params.periodoId}`);
  await registrarAuditoria({
    usuario: req.session.user, accion: 'eliminar_bono', entidad: 'bono',
    entidad_id: req.params.bonoId, periodo_id: req.params.periodoId
  });
  req.flash('success', 'Bono eliminado.');
  res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
});

// ═══════════════════════════════════════════════
// 9-22. DESCUENTOS con saldo + COBROS parciales por periodo
// (DESCUENTO ≠ COBRO — un descuento es una obligación con saldo;
// cada cobro es cuánto de esa obligación se descontó en una planilla
// puntual. No se duplica el descuento al pasar de periodo.)
// ═══════════════════════════════════════════════

router.get('/descuentos/conceptos', async (req, res) => {
  const { data } = await db.select('planilla_conceptos_descuento', 'select=id,clave,nombre&activo=eq.true&order=nombre.asc');
  res.json({ conceptos: data || [] });
});

// Crear una nueva obligación de descuento (préstamo, adelanto, falta, etc.)
router.post('/descuentos', requirePlanillaEditar, async (req, res) => {
  const { personal_id, concepto_id, origen_codigo, importe_original, observacion, fecha } = req.body;
  const importeNum = parseFloat(importe_original);
  if (!personal_id || !concepto_id || isNaN(importeNum) || importeNum <= 0) {
    req.flash('error', 'Completa trabajador, concepto e importe (mayor a 0).');
    return res.redirect(req.get('Referer') || '/planilla/resumen');
  }
  const { data, error } = await db.insert('planilla_descuentos', {
    personal_id, concepto_id, origen_codigo: origen_codigo || null,
    importe_original: importeNum, saldo: importeNum,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    observacion: observacion || null, creado_por: req.session.user.id
  });
  if (error) { req.flash('error', 'Error al crear el descuento: ' + error.message); }
  else {
    await registrarAuditoria({
      usuario: req.session.user, accion: 'crear_descuento', entidad: 'descuento',
      entidad_id: data && data[0] && data[0].id, valor_nuevo: { personal_id, importe_original: importeNum }
    });
    req.flash('success', 'Descuento registrado. Se podrá cobrar (total o parcialmente) desde cualquier planilla abierta.');
  }
  res.redirect(req.get('Referer') || `/planilla/resumen/${personal_id}`);
});

// Detalle de un descuento + su historial de cobros (sección 21)
router.get('/descuentos/:id', async (req, res) => {
  const [{ data: rows }, { data: cobros }] = await Promise.all([
    db.select('planilla_descuentos',
      `select=*,concepto:planilla_conceptos_descuento(nombre,clave),personal:personal_tripulantes(nombres,apellidos,dni)&id=eq.${req.params.id}&limit=1`),
    db.select('planilla_descuento_cobros',
      `select=importe,cobrado,creado_en,periodo:planilla_periodos(etiqueta,mes,anio)&descuento_id=eq.${req.params.id}&order=creado_en.asc`)
  ]);
  const descuento = rows && rows[0];
  if (!descuento) return res.status(404).json({ error: 'Descuento no encontrado' });
  res.json({ descuento, historial: cobros || [] });
});

// Registrar (o corregir) el cobro de un descuento dentro de un periodo
router.post('/descuentos/:id/cobro', requirePlanillaEditar, async (req, res) => {
  const { periodo_id, importe, cobrado } = req.body;
  const importeNum = parseFloat(importe) || 0;
  const { data, error } = await db.rpc('planilla_registrar_cobro', {
    p_descuento_id: req.params.id, p_periodo_id: periodo_id,
    p_importe: importeNum, p_cobrado: cobrado === true || cobrado === 'true' || cobrado === 'on',
    p_usuario_id: req.session.user.id
  });
  if (error) {
    const msg = error.message.includes('PERIODO_CERRADO') ? 'Este periodo ya está cerrado.' :
                error.message.includes('IMPORTE_EXCEDE_SALDO') ? 'El importe supera el saldo disponible de este descuento.' :
                'No se pudo registrar el cobro: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'registrar_cobro', entidad: 'descuento_cobro',
    entidad_id: req.params.id, periodo_id, valor_nuevo: { importe: importeNum, cobrado: !!cobrado, saldo_resultante: data }
  });
  res.json({ ok: true, saldo: data });
});

// Solo se puede eliminar un descuento si NUNCA se le registró ningún cobro
// (para corregir errores de tipeo) — si ya tiene historial, se conserva.
router.post('/descuentos/:id/eliminar', requirePlanillaEditar, async (req, res) => {
  const { data: cobros } = await db.select('planilla_descuento_cobros', `select=id&descuento_id=eq.${req.params.id}&limit=1`);
  if (cobros && cobros.length) {
    req.flash('error', 'Este descuento ya tiene cobros registrados; no se puede eliminar (se conserva como histórico).');
    return res.redirect(req.get('Referer') || '/planilla/resumen');
  }
  await db.delete('planilla_descuentos', `id=eq.${req.params.id}`);
  await registrarAuditoria({ usuario: req.session.user, accion: 'eliminar_descuento', entidad: 'descuento', entidad_id: req.params.id });
  req.flash('success', 'Descuento eliminado.');
  res.redirect(req.get('Referer') || '/planilla/resumen');
});

// ═══════════════════════════════════════════════
// 23-28. VACACIONES Y PERMISOS
// ═══════════════════════════════════════════════

router.get('/vacaciones-permisos', async (req, res) => {
  const [{ data: tipos }, { data: proximasVac }, { data: proximosPer }] = await Promise.all([
    db.select('planilla_tipos_permiso', 'select=id,nombre&activo=eq.true&order=nombre.asc'),
    db.select('planilla_vacaciones',
      'select=id,fecha_inicio,fecha_fin,dias,estado,personal:personal_tripulantes(nombres,apellidos)&order=fecha_inicio.desc&limit=20'),
    db.select('planilla_permisos',
      'select=id,fecha,dia_completo,con_goce,estado,motivo,personal:personal_tripulantes(nombres,apellidos),tipo:planilla_tipos_permiso(nombre),descuento:planilla_descuentos(importe_original,saldo)&order=fecha.desc&limit=20')
  ]);
  res.render('planilla/vacaciones-permisos', {
    layout: 'main', title: 'Vacaciones y Permisos',
    pageTitle: 'Vacaciones y Permisos', pageSubtitle: 'Administra las ausencias de los trabajadores',
    seccionActiva: 'vacaciones-permisos', tipos: tipos || [],
    vacaciones: proximasVac || [], permisos: proximosPer || [],
    estadosVacacion: ['Programada', 'Aprobada', 'Tomada', 'Cancelada'],
    estadosPermiso: ['Pendiente', 'Aprobado', 'Rechazado', 'Cancelado'],
    puedeEditar: esAdminOEditor(req.usuarioFresco)
  });
});

router.get('/vacaciones-permisos/trabajador/:personalId', async (req, res) => {
  const [{ data: vac }, { data: per }] = await Promise.all([
    db.select('planilla_vacaciones', `select=*&personal_id=eq.${req.params.personalId}&order=fecha_inicio.desc`),
    db.select('planilla_permisos', `select=*,tipo:planilla_tipos_permiso(nombre)&personal_id=eq.${req.params.personalId}&order=fecha.desc`)
  ]);
  res.json({ vacaciones: vac || [], permisos: per || [] });
});

router.post('/vacaciones', requirePlanillaEditar, async (req, res) => {
  const { personal_id, fecha_inicio, fecha_fin, observacion } = req.body;
  if (!personal_id || !fecha_inicio || !fecha_fin) {
    req.flash('error', 'Completa trabajador, fecha de inicio y fecha de fin.');
    return res.redirect('/planilla/vacaciones-permisos');
  }
  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin);
  if (isNaN(ini) || isNaN(fin) || fin < ini) {
    req.flash('error', 'El rango de fechas no es válido (la fecha de fin no puede ser anterior a la de inicio).');
    return res.redirect('/planilla/vacaciones-permisos');
  }
  const dias = Math.round((fin - ini) / 86400000) + 1;
  const { data, error } = await db.insert('planilla_vacaciones', {
    personal_id, fecha_inicio, fecha_fin, dias, observacion: observacion || null, creado_por: req.session.user.id
  });
  if (error) { req.flash('error', 'Error al registrar vacaciones: ' + error.message); }
  else {
    await registrarAuditoria({
      usuario: req.session.user, accion: 'registrar_vacaciones', entidad: 'vacacion',
      entidad_id: data && data[0] && data[0].id, valor_nuevo: { personal_id, fecha_inicio, fecha_fin, dias }
    });
    req.flash('success', `Vacaciones registradas (${dias} día${dias === 1 ? '' : 's'}).`);
  }
  res.redirect('/planilla/vacaciones-permisos');
});

router.post('/vacaciones/:id/estado', requirePlanillaEditar, async (req, res) => {
  const { estado } = req.body;
  if (!['Programada', 'Aprobada', 'Tomada', 'Cancelada'].includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  await db.update('planilla_vacaciones', `id=eq.${req.params.id}`, { estado });
  await registrarAuditoria({ usuario: req.session.user, accion: 'actualizar_estado_vacacion', entidad: 'vacacion', entidad_id: req.params.id, valor_nuevo: { estado } });
  res.json({ ok: true });
});

router.post('/vacaciones/:id/eliminar', requirePlanillaEditar, async (req, res) => {
  await db.delete('planilla_vacaciones', `id=eq.${req.params.id}`);
  await registrarAuditoria({ usuario: req.session.user, accion: 'eliminar_vacacion', entidad: 'vacacion', entidad_id: req.params.id });
  req.flash('success', 'Registro eliminado.');
  res.redirect('/planilla/vacaciones-permisos');
});

router.post('/permisos', requirePlanillaEditar, async (req, res) => {
  const { personal_id, tipo_id, fecha, hora_inicio, hora_fin, dia_completo, con_goce, motivo, observacion, monto_descuento } = req.body;
  if (!personal_id || !fecha) {
    req.flash('error', 'Completa trabajador y fecha.');
    return res.redirect('/planilla/vacaciones-permisos');
  }
  const esDiaCompleto = dia_completo === 'on' || dia_completo === true;
  const esConGoce = con_goce === 'on' || con_goce === true;
  const montoNum = parseFloat(monto_descuento);
  const descontar = !esConGoce && !isNaN(montoNum) && montoNum > 0;

  const { data, error } = await db.rpc('planilla_registrar_permiso', {
    p_personal_id: personal_id, p_tipo_id: tipo_id || null, p_fecha: fecha,
    p_hora_inicio: esDiaCompleto ? null : (hora_inicio || null),
    p_hora_fin: esDiaCompleto ? null : (hora_fin || null),
    p_dia_completo: esDiaCompleto, p_con_goce: esConGoce,
    p_motivo: motivo || null, p_observacion: observacion || null,
    p_monto_descuento: descontar ? montoNum : null,
    p_usuario_id: req.session.user.id
  });
  if (error) { req.flash('error', 'Error al registrar el permiso: ' + error.message); }
  else {
    const permisoId = Array.isArray(data) ? data[0] : data;
    await registrarAuditoria({
      usuario: req.session.user, accion: 'registrar_permiso', entidad: 'permiso',
      entidad_id: permisoId, valor_nuevo: { personal_id, fecha, con_goce: esConGoce, monto_descuento: descontar ? montoNum : null }
    });
    req.flash('success', descontar
      ? `Permiso registrado. Se generó un descuento de S/ ${montoNum.toFixed(2)} por ser sin goce de haber — se cobrará desde cualquier planilla abierta.`
      : 'Permiso registrado.');
  }
  res.redirect('/planilla/vacaciones-permisos');
});

router.post('/permisos/:id/estado', requirePlanillaEditar, async (req, res) => {
  const { estado } = req.body;
  if (!['Pendiente', 'Aprobado', 'Rechazado', 'Cancelado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  await db.update('planilla_permisos', `id=eq.${req.params.id}`, { estado });
  await registrarAuditoria({ usuario: req.session.user, accion: 'actualizar_estado_permiso', entidad: 'permiso', entidad_id: req.params.id, valor_nuevo: { estado } });
  res.json({ ok: true });
});

// Genera (retroactivamente) el descuento de un permiso "sin goce" que se
// registró sin indicar monto en su momento, o que se creó antes de que
// existiera esta función.
router.post('/permisos/:id/generar-descuento', requirePlanillaEditar, async (req, res) => {
  const montoNum = parseFloat(req.body.monto);
  if (isNaN(montoNum) || montoNum <= 0) return res.status(400).json({ error: 'Ingresa un monto válido (mayor a 0).' });

  const { data: rows } = await db.select('planilla_permisos', `select=*&id=eq.${req.params.id}&limit=1`);
  const permiso = rows && rows[0];
  if (!permiso) return res.status(404).json({ error: 'Permiso no encontrado.' });
  if (permiso.con_goce) return res.status(400).json({ error: 'Este permiso es con goce de haber; no corresponde generarle un descuento.' });
  if (permiso.descuento_id) return res.status(400).json({ error: 'Este permiso ya tiene un descuento asociado.' });

  const { data: conceptoRows } = await db.select('planilla_conceptos_descuento', `select=id&clave=eq.permiso_sin_goce&limit=1`);
  const concepto_id = conceptoRows && conceptoRows[0] && conceptoRows[0].id;
  if (!concepto_id) return res.status(400).json({ error: 'Falta el concepto "Permiso sin goce de haber" en el catálogo. Ejecuta PLANILLA_PERMISO_DESCUENTO_MIGRATION.sql.' });

  const { data: descuentoRows, error } = await db.insert('planilla_descuentos', {
    personal_id: permiso.personal_id, concepto_id,
    origen_codigo: 'Permiso sin goce — ' + new Date(permiso.fecha).toLocaleDateString('es-PE'),
    importe_original: montoNum, saldo: montoNum, fecha: permiso.fecha,
    observacion: permiso.motivo || permiso.observacion || null, creado_por: req.session.user.id
  });
  if (error) return res.status(400).json({ error: 'No se pudo generar el descuento: ' + error.message });

  const descuentoId = descuentoRows && descuentoRows[0] && descuentoRows[0].id;
  await db.update('planilla_permisos', `id=eq.${req.params.id}`, { descuento_id: descuentoId });
  await registrarAuditoria({
    usuario: req.session.user, accion: 'generar_descuento_permiso', entidad: 'permiso',
    entidad_id: req.params.id, valor_nuevo: { descuento_id: descuentoId, monto: montoNum }
  });
  res.json({ ok: true });
});

router.post('/permisos/:id/eliminar', requirePlanillaEditar, async (req, res) => {
  const { data: rows } = await db.select('planilla_permisos', `select=descuento_id&id=eq.${req.params.id}&limit=1`);
  const permiso = rows && rows[0];
  await db.delete('planilla_permisos', `id=eq.${req.params.id}`);
  // Si el permiso tenía un descuento generado y nunca se le cobró nada, se
  // elimina junto con el permiso. Si ya tiene cobros registrados, se
  // conserva como histórico independiente (ya no ligado a ningún permiso).
  if (permiso && permiso.descuento_id) {
    const { data: cobros } = await db.select('planilla_descuento_cobros', `select=id&descuento_id=eq.${permiso.descuento_id}&limit=1`);
    if (!cobros || !cobros.length) await db.delete('planilla_descuentos', `id=eq.${permiso.descuento_id}`);
  }
  await registrarAuditoria({ usuario: req.session.user, accion: 'eliminar_permiso', entidad: 'permiso', entidad_id: req.params.id });
  req.flash('success', 'Registro eliminado.');
  res.redirect('/planilla/vacaciones-permisos');
});

// ═══════════════════════════════════════════════
// 35. REPORTES (con filtros y exportación)
// Nota: la exportación se genera como CSV (Excel lo abre nativamente).
// Para PDF, se usa "Imprimir" del navegador (Guardar como PDF), igual
// que en el resto del sistema — no se agregó una librería nueva de PDF
// para no cambiar de tecnología sin necesidad.
// ═══════════════════════════════════════════════

async function periodosOrdenados() {
  const { data } = await db.select('planilla_periodos', 'select=id,mes,anio,etiqueta&order=anio.asc,mes.asc');
  return data || [];
}
function periodosEnRango(todos, desdeId, hastaId) {
  if (!desdeId && !hastaId) return todos;
  const iDesde = desdeId ? todos.findIndex(p => p.id === desdeId) : 0;
  const iHasta = hastaId ? todos.findIndex(p => p.id === hastaId) : todos.length - 1;
  const ini = Math.max(0, iDesde === -1 ? 0 : iDesde);
  const fin = iHasta === -1 ? todos.length - 1 : iHasta;
  return todos.slice(Math.min(ini, fin), Math.max(ini, fin) + 1);
}

async function generarReporte(tipo, filtros) {
  const todos = await periodosOrdenados();
  const periodosRango = periodosEnRango(todos, filtros.periodoDesde, filtros.periodoHasta);
  const idsPeriodo = periodosRango.map(p => p.id);
  const etiquetaPeriodo = {}; todos.forEach(p => { etiquetaPeriodo[p.id] = p.etiqueta; });

  const coincideFiltroPersonal = (p) => {
    if (!p) return false;
    if (filtros.area && !((p.area || '').toLowerCase().includes(filtros.area.toLowerCase()))) return false;
    if (filtros.cargo && !((p.cargo || p.tipo || '').toLowerCase().includes(filtros.cargo.toLowerCase()))) return false;
    return true;
  };

  if (tipo === 'bonos') {
    if (!idsPeriodo.length) return { headers: ['Periodo', 'Trabajador', 'Concepto', 'Importe'], rows: [] };
    let qBonos = `select=importe,concepto,periodo_id,personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo)&periodo_id=in.(${idsPeriodo.join(',')})&order=fecha.asc`;
    if (filtros.personalId) qBonos += `&personal_id=eq.${filtros.personalId}`;
    const { data } = await db.select('planilla_bonos', qBonos);
    const rows = (data || []).filter(b => coincideFiltroPersonal(b.personal)).map(b => [
      etiquetaPeriodo[b.periodo_id] || '—', b.personal ? `${b.personal.nombres} ${b.personal.apellidos}` : '—', b.concepto, Number(b.importe).toFixed(2)
    ]);
    return { headers: ['Periodo', 'Trabajador', 'Concepto', 'Importe'], rows };
  }

  if (tipo === 'descuentos') {
    let q = 'select=origen_codigo,importe_original,saldo,estado,personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo),concepto:planilla_conceptos_descuento(nombre,clave)&order=fecha.desc';
    if (filtros.personalId) q += `&personal_id=eq.${filtros.personalId}`;
    if (filtros.estado) q += `&estado=eq.${filtros.estado}`;
    if (filtros.tipoConcepto) q += `&concepto_id=eq.${filtros.tipoConcepto}`;
    const { data } = await db.select('planilla_descuentos', q);
    const rows = (data || []).filter(d => coincideFiltroPersonal(d.personal)).map(d => [
      d.personal ? `${d.personal.nombres} ${d.personal.apellidos}` : '—',
      d.concepto ? d.concepto.nombre : '—', d.origen_codigo || '—',
      Number(d.importe_original).toFixed(2), (Number(d.importe_original) - Number(d.saldo)).toFixed(2), Number(d.saldo).toFixed(2)
    ]);
    return { headers: ['Trabajador', 'Concepto', 'Origen', 'Importe original', 'Cobrado', 'Saldo'], rows };
  }

  if (tipo === 'uniformes') {
    let qUnif = `select=cantidad,creado_en,valor_unitario,valor_total,uniforme:inventario_uniformes(nombre),personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo),descuento:planilla_descuentos(importe_original,saldo)&tipo=eq.entrega&order=creado_en.desc`;
    if (filtros.personalId) qUnif += `&personal_id=eq.${filtros.personalId}`;
    const { data } = await db.select('inventario_uniformes_movimientos', qUnif);
    const rows = (data || []).filter(m => coincideFiltroPersonal(m.personal)).map(m => [
      m.personal ? `${m.personal.nombres} ${m.personal.apellidos}` : '—',
      m.uniforme ? m.uniforme.nombre : '—', (m.creado_en || '').slice(0, 10), m.cantidad,
      Number(m.valor_total || 0).toFixed(2),
      m.descuento ? (Number(m.descuento.importe_original) - Number(m.descuento.saldo)).toFixed(2) : '0.00',
      m.descuento ? Number(m.descuento.saldo).toFixed(2) : '0.00'
    ]);
    return { headers: ['Trabajador', 'Uniforme', 'Fecha entrega', 'Cantidad', 'Valor', 'Cobrado', 'Saldo'], rows };
  }

  if (tipo === 'vacaciones') {
    let q = 'select=fecha_inicio,fecha_fin,dias,estado,personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo)&order=fecha_inicio.desc';
    if (filtros.personalId) q += `&personal_id=eq.${filtros.personalId}`;
    if (filtros.estado) q += `&estado=eq.${filtros.estado}`;
    const { data } = await db.select('planilla_vacaciones', q);
    const rows = (data || []).filter(v => coincideFiltroPersonal(v.personal)).map(v => [
      v.personal ? `${v.personal.nombres} ${v.personal.apellidos}` : '—', v.fecha_inicio, v.fecha_fin, v.dias, v.estado
    ]);
    return { headers: ['Trabajador', 'Fecha inicio', 'Fecha fin', 'Días', 'Estado'], rows };
  }

  if (tipo === 'permisos') {
    let q = 'select=fecha,hora_inicio,hora_fin,dia_completo,estado,personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo),tipo:planilla_tipos_permiso(nombre)&order=fecha.desc';
    if (filtros.personalId) q += `&personal_id=eq.${filtros.personalId}`;
    if (filtros.estado) q += `&estado=eq.${filtros.estado}`;
    const { data } = await db.select('planilla_permisos', q);
    const rows = (data || []).filter(p => coincideFiltroPersonal(p.personal)).map(p => [
      p.personal ? `${p.personal.nombres} ${p.personal.apellidos}` : '—', p.fecha,
      p.tipo ? p.tipo.nombre : '—',
      p.dia_completo ? 'Día completo' : `${p.hora_inicio || '—'} a ${p.hora_fin || '—'}`, p.estado
    ]);
    return { headers: ['Trabajador', 'Fecha', 'Tipo', 'Horas', 'Estado'], rows };
  }

  if (tipo === 'historico-trabajador') {
    if (!filtros.personalId) return { headers: ['Periodo', 'Sueldo', 'Bonos', 'Descuentos', 'Neto'], rows: [] };
    const { data: roster } = await db.select('planilla_periodo_trabajadores',
      `select=periodo_id,sueldo_base,periodo:planilla_periodos(etiqueta,mes,anio)&personal_id=eq.${filtros.personalId}`);
    const [{ data: bonos }, { data: cobros }] = await Promise.all([
      db.select('planilla_bonos', `select=periodo_id,importe&personal_id=eq.${filtros.personalId}`),
      db.select('planilla_descuento_cobros', `select=periodo_id,importe&personal_id=eq.${filtros.personalId}&cobrado=eq.true`)
    ]);
    const bonosPor = {}, cobrosPor = {};
    (bonos || []).forEach(b => { bonosPor[b.periodo_id] = (bonosPor[b.periodo_id] || 0) + Number(b.importe); });
    (cobros || []).forEach(c => { cobrosPor[c.periodo_id] = (cobrosPor[c.periodo_id] || 0) + Number(c.importe); });
    const rows = (roster || []).filter(r => r.periodo).sort((a, b) => (a.periodo.anio - b.periodo.anio) || (a.periodo.mes - b.periodo.mes))
      .map(r => {
        const sueldo = Number(r.sueldo_base || 0), bon = bonosPor[r.periodo_id] || 0, desc = cobrosPor[r.periodo_id] || 0;
        return [r.periodo.etiqueta, sueldo.toFixed(2), bon.toFixed(2), desc.toFixed(2), (sueldo + bon - desc).toFixed(2)];
      });
    return { headers: ['Periodo', 'Sueldo', 'Bonos', 'Descuentos', 'Neto'], rows };
  }

  // 'general' (por defecto)
  if (!idsPeriodo.length) return { headers: ['Trabajador', 'Periodo', 'Sueldo', 'Bonos', 'Descuentos', 'Neto'], rows: [] };
  let qRoster = `select=id,periodo_id,personal_id,sueldo_base,area,cargo,tipo,categoria,personal:personal_tripulantes(nombres,apellidos)&periodo_id=in.(${idsPeriodo.join(',')})`;
  if (filtros.personalId) qRoster += `&personal_id=eq.${filtros.personalId}`;
  const { data: roster } = await db.select('planilla_periodo_trabajadores', qRoster);
  const filtrado = (roster || []).filter(coincideFiltroPersonal);
  const rIds = filtrado.map(r => r.personal_id);
  let bonosPor = {}, cobrosPor = {};
  if (rIds.length) {
    const [{ data: bonos }, { data: cobros }] = await Promise.all([
      db.select('planilla_bonos', `select=periodo_id,personal_id,importe&periodo_id=in.(${idsPeriodo.join(',')})`),
      db.select('planilla_descuento_cobros', `select=periodo_id,personal_id,importe&periodo_id=in.(${idsPeriodo.join(',')})&cobrado=eq.true`)
    ]);
    (bonos || []).forEach(b => { const k = b.periodo_id + '|' + b.personal_id; bonosPor[k] = (bonosPor[k] || 0) + Number(b.importe); });
    (cobros || []).forEach(c => { const k = c.periodo_id + '|' + c.personal_id; cobrosPor[k] = (cobrosPor[k] || 0) + Number(c.importe); });
  }
  const rows = filtrado.map(r => {
    const k = r.periodo_id + '|' + r.personal_id;
    const sueldo = Number(r.sueldo_base || 0), bon = bonosPor[k] || 0, desc = cobrosPor[k] || 0;
    return [r.personal ? `${r.personal.nombres} ${r.personal.apellidos}` : '—', etiquetaPeriodo[r.periodo_id] || '—',
      sueldo.toFixed(2), bon.toFixed(2), desc.toFixed(2), (sueldo + bon - desc).toFixed(2)];
  });
  return { headers: ['Trabajador', 'Periodo', 'Sueldo', 'Bonos', 'Descuentos', 'Neto'], rows };
}

function leerFiltrosReporte(q) {
  return {
    periodoDesde: q.periodo_desde || null, periodoHasta: q.periodo_hasta || null,
    personalId: q.personal_id || null, area: q.area || null, cargo: q.cargo || null,
    estado: q.estado || null, tipoConcepto: q.tipo_concepto || null
  };
}

router.get('/reportes', async (req, res) => {
  const tipo = req.query.tipo || 'general';
  const [periodos, { data: conceptos }] = await Promise.all([
    periodosOrdenados(), db.select('planilla_conceptos_descuento', 'select=id,nombre&order=nombre.asc')
  ]);
  const filtros = leerFiltrosReporte(req.query);
  const reporte = await generarReporte(tipo, filtros);
  const tiposReporte = [
    { clave: 'general', nombre: 'Reporte General' }, { clave: 'bonos', nombre: 'Bonos' },
    { clave: 'descuentos', nombre: 'Descuentos' }, { clave: 'uniformes', nombre: 'Uniformes' },
    { clave: 'vacaciones', nombre: 'Vacaciones' }, { clave: 'permisos', nombre: 'Permisos' },
    { clave: 'historico-trabajador', nombre: 'Histórico de trabajador' }
  ];
  const qs = new URLSearchParams(req.query).toString();
  res.render('planilla/reportes', {
    layout: 'main', title: 'Reportes de Planilla',
    pageTitle: 'Reportes', pageSubtitle: 'Filtra por periodo, trabajador, área, cargo o tipo',
    seccionActiva: 'reportes', tipo, periodos: periodos.slice().reverse(), conceptos: conceptos || [],
    filtros: req.query, reporte, tiposReporte, queryString: qs
  });
});

function aCSV(headers, rows) {
  const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

router.get('/reportes/exportar.csv', async (req, res) => {
  const tipo = req.query.tipo || 'general';
  const reporte = await generarReporte(tipo, leerFiltrosReporte(req.query));
  const csv = aCSV(reporte.headers, reporte.rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-planilla-${tipo}.csv"`);
  res.send('\uFEFF' + csv);
});

// ═══════════════════════════════════════════════
// 36-37. IMPRESIÓN (individual y masiva)
// ═══════════════════════════════════════════════

async function datosEmpresa() {
  const { data } = await db.select('planilla_empresa_datos', 'select=nombre,ruc&id=eq.1&limit=1');
  return (data && data[0]) || { nombre: null, ruc: null };
}

async function armarBoleta(periodoId, rosterId) {
  const [{ data: periodoRows }, roster, empresa] = await Promise.all([
    db.select('planilla_periodos', `select=*&id=eq.${periodoId}&limit=1`),
    cargarRosterTrabajador(periodoId, rosterId),
    datosEmpresa()
  ]);
  const periodo = periodoRows && periodoRows[0];
  if (!periodo || !roster) return null;

  const [{ data: bonos }, { data: cobros }, vacPer] = await Promise.all([
    db.select('planilla_bonos', `select=concepto,importe&periodo_id=eq.${periodoId}&personal_id=eq.${roster.personal_id}`),
    db.select('planilla_descuento_cobros',
      `select=importe,descuento:planilla_descuentos(origen_codigo,concepto:planilla_conceptos_descuento(nombre))&periodo_id=eq.${periodoId}&personal_id=eq.${roster.personal_id}&cobrado=eq.true`),
    obtenerVacacionesPermisosDelPeriodo(roster.personal_id, periodo.mes, periodo.anio)
  ]);
  const totalBonos = (bonos || []).reduce((s, b) => s + Number(b.importe), 0);
  const totalDescuentos = (cobros || []).reduce((s, c) => s + Number(c.importe), 0);
  const sueldo = Number(roster.sueldo_base || 0);
  return {
    empresa, periodo, roster,
    cargoMostrar: roster.categoria === 'tripulacion' ? (roster.tipo || '—') : (roster.cargo || '—'),
    bonos: bonos || [],
    descuentos: (cobros || []).map(c => ({
      concepto: c.descuento && c.descuento.concepto ? c.descuento.concepto.nombre : '—',
      origen: c.descuento ? c.descuento.origen_codigo : '—', importe: c.importe
    })),
    vacaciones: vacPer.vacaciones, permisos: vacPer.permisos,
    sueldo, totalBonos, totalIngresos: sueldo + totalBonos, totalDescuentos, neto: sueldo + totalBonos - totalDescuentos,
    fechaEmision: new Date().toLocaleDateString('es-PE')
  };
}

router.get('/periodos/:periodoId/trabajador/:rosterId/imprimir', async (req, res) => {
  const boleta = await armarBoleta(req.params.periodoId, req.params.rosterId);
  if (!boleta) { req.flash('error', 'No se encontró esa planilla.'); return res.redirect(`/planilla/periodos/${req.params.periodoId}`); }
  res.render('planilla/boleta', { layout: false, boletas: [boleta] });
});

router.get('/periodos/:periodoId/imprimir', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) {
    // Selector de trabajadores para impresión masiva
    const { data: roster } = await db.select('planilla_periodo_trabajadores',
      `select=id,cargo,tipo,categoria,personal:personal_tripulantes(nombres,apellidos,dni)&periodo_id=eq.${req.params.periodoId}`);
    const { data: periodoRows } = await db.select('planilla_periodos', `select=etiqueta&id=eq.${req.params.periodoId}&limit=1`);
    return res.render('planilla/imprimir-masivo', {
      layout: 'main', title: 'Imprimir planillas', pageTitle: 'Imprimir planillas',
      pageSubtitle: (periodoRows && periodoRows[0] && periodoRows[0].etiqueta) || '', seccionActiva: 'periodos',
      periodoId: req.params.periodoId,
      trabajadores: (roster || []).map(r => ({
        rosterId: r.id, nombreCompleto: r.personal ? `${r.personal.nombres} ${r.personal.apellidos}` : '—',
        dni: r.personal ? r.personal.dni : '—'
      })).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))
    });
  }
  const boletas = (await Promise.all(ids.map(id => armarBoleta(req.params.periodoId, id)))).filter(Boolean);
  res.render('planilla/boleta', { layout: false, boletas });
});

module.exports = router;
