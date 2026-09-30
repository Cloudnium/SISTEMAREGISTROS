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
const XLSX = require('xlsx');
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

// ═══════════════════════════════════════════════
// VACACIONES — helpers compartidos (módulo Vacaciones + planilla/boleta)
//
// Modelo: empresa (días por defecto) → periodo vacacional (guarda SUS
// días otorgados) → vacaciones → pago. Días utilizados/restantes NO se
// guardan: se calculan sumando las vacaciones no canceladas del periodo
// (así cancelar devuelve los días solo y nada se descuenta dos veces).
//
// Planilla: la remuneración vacacional es un concepto PROPIO (no es un
// bono). Se incluye en la planilla cuyo mes/año es el de la fecha de
// pago, solo cuando el pago está registrado; un pago = una sola vez.
// ═══════════════════════════════════════════════
const ESTADOS_VACACION = ['Pendiente', 'Aprobado', 'En curso', 'Finalizado', 'Cancelado'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) { return String(n).padStart(2, '0'); }
function rangoMes(mes, anio) {
  return { desde: `${anio}-${pad2(mes)}-01`, hasta: `${anio}-${pad2(mes)}-${pad2(new Date(anio, mes, 0).getDate())}` };
}
// '2026-10-05' → '05/10/2026' sin pasar por zonas horarias
function fechaTxt(iso) {
  const f = String(iso || '').slice(0, 10);
  return RE_FECHA.test(f) ? f.split('-').reverse().join('/') : '—';
}
// true solo para fechas reales yyyy-mm-dd (rechaza 2026-02-30, que JS "corrige" a marzo)
function fechaValida(f) {
  if (!RE_FECHA.test(f || '')) return false;
  const t = Date.parse(f + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === f;
}
// Días entre dos fechas ISO (yyyy-mm-dd) incluyendo ambas; null si alguna es inválida.
function diasEntre(ini, fin) {
  if (!fechaValida(ini) || !fechaValida(fin)) return null;
  return Math.round((Date.parse(fin + 'T00:00:00Z') - Date.parse(ini + 'T00:00:00Z')) / 86400000) + 1;
}

// { [periodoVacId]: { otorgados, utilizados, restantes } }. excluirVacacionId
// sirve para validar una edición sin contar los días de la propia vacación.
async function saldosDePeriodos(periodoIds, excluirVacacionId) {
  const saldos = {};
  if (!periodoIds.length) return saldos;
  const lista = periodoIds.join(',');
  const [{ data: periodos }, { data: vacs }] = await Promise.all([
    db.select('planilla_vacaciones_periodos', `select=id,dias_otorgados&id=in.(${lista})`),
    db.select('planilla_vacaciones',
      `select=periodo_vacacional_id,dias&estado=neq.Cancelado&periodo_vacacional_id=in.(${lista})` +
      (excluirVacacionId ? `&id=neq.${excluirVacacionId}` : ''))
  ]);
  (periodos || []).forEach(p => {
    saldos[p.id] = { otorgados: Number(p.dias_otorgados), utilizados: 0, restantes: Number(p.dias_otorgados) };
  });
  (vacs || []).forEach(v => {
    const sd = saldos[v.periodo_vacacional_id];
    if (sd) { sd.utilizados += Number(v.dias); sd.restantes = sd.otorgados - sd.utilizados; }
  });
  return saldos;
}

// Remuneraciones vacacionales PAGADAS cuyo mes de pago es el de este periodo.
async function pagosVacacionalesDelMes(mes, anio, personalId) {
  const { desde, hasta } = rangoMes(mes, anio);
  let q = `select=id,personal_id,monto,fecha_pago,vacacion:planilla_vacaciones(fecha_inicio,fecha_fin,dias)` +
          `&fecha_pago=gte.${desde}&fecha_pago=lte.${hasta}&order=fecha_pago.asc`;
  if (personalId) q += `&personal_id=eq.${personalId}`;
  const { data } = await db.select('planilla_vacaciones_pagos', q);
  return (data || []).map(p => ({
    ...p, monto: Number(p.monto),
    detalle: p.vacacion ? `Vacaciones del ${fechaTxt(p.vacacion.fecha_inicio)} al ${fechaTxt(p.vacacion.fecha_fin)} (${p.vacacion.dias} día${Number(p.vacacion.dias) === 1 ? '' : 's'})` : ''
  }));
}
const sumaPagosVac = (pagos) => (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);

async function obtenerVacacionesPermisosDelPeriodo(personalId, mes, anio) {
  const inicioPeriodo = `${anio}-${pad2(mes)}-01`;
  const finPeriodo = rangoMes(mes, anio).hasta;
  const [{ data: vac }, { data: per }] = await Promise.all([
    db.select('planilla_vacaciones',
      `select=id,fecha_inicio,fecha_fin,dias,estado,estado_pago,observacion,periodo:planilla_vacaciones_periodos(id,anio)&personal_id=eq.${personalId}` +
      `&estado=neq.Cancelado&fecha_inicio=lte.${finPeriodo}&fecha_fin=gte.${inicioPeriodo}&order=fecha_inicio.asc`),
    db.select('planilla_permisos',
      `select=id,fecha,hora_inicio,hora_fin,dia_completo,con_goce,motivo,estado,tipo:planilla_tipos_permiso(nombre),descuento:planilla_descuentos(importe_original,saldo)&personal_id=eq.${personalId}` +
      `&fecha=gte.${inicioPeriodo}&fecha=lte.${finPeriodo}&order=fecha.asc`)
  ]);
  const saldos = await saldosDePeriodos([...new Set((vac || []).filter(v => v.periodo).map(v => v.periodo.id))]);
  const vacaciones = (vac || []).map(v => ({
    ...v, ...diasEnPeriodo(v.fecha_inicio, v.fecha_fin, mes, anio),
    periodoVac: v.periodo ? { anio: v.periodo.anio, ...(saldos[v.periodo.id] || {}) } : null
  }));
  return { vacaciones, permisos: per || [] };
}

// ═══════════════════════════════════════════════
// 3. RESUMEN — consulta rápida de cualquier trabajador
// ═══════════════════════════════════════════════

router.get('/', (req, res) => res.redirect('/planilla/resumen'));

router.get('/resumen', async (req, res) => {
  const trabajadores = await listaTrabajadoresResumen();
  res.render('planilla/resumen', {
    layout: 'main', title: 'Planilla — Resumen',
    pageTitle: 'Planilla', pageSubtitle: 'Consulta rápida de cualquier trabajador',
    seccionActiva: 'resumen', trabajadores
  });
});

async function listaTrabajadoresResumen(filtro) {
  const query = filtro
    ? `select=id,nombres,apellidos,dni,categoria,tipo,cargo,area,activo&${filtro}&order=apellidos.asc&limit=50`
    : 'select=id,nombres,apellidos,dni,categoria,tipo,cargo,area,activo&order=apellidos.asc&limit=300';
  const { data } = await db.select('personal_tripulantes', query);
  return (data || []).map(p => ({
    id: p.id, nombreCompleto: `${p.nombres} ${p.apellidos}`, dni: p.dni,
    cargoMostrar: cargoMostrarDe(p), area: p.area || '', activo: p.activo
  }));
}

// Buscador inteligente (se filtra mientras se escribe). Sin texto,
// devuelve la lista completa de trabajadores.
router.get('/resumen/buscar', async (req, res) => {
  const q = (req.query.q || '').trim();
  const filtro = q.length ? filtroBusquedaTrabajador(q) : null;
  const resultados = await listaTrabajadoresResumen(filtro);
  res.json({ resultados });
});

// Ficha completa de un trabajador: datos actuales + histórico de planillas
router.get('/resumen/:personalId', async (req, res) => {
  const { data: rows } = await db.select('personal_tripulantes',
    `select=*&id=eq.${req.params.personalId}&limit=1`);
  const trabajador = rows && rows[0];
  if (!trabajador) { req.flash('error', 'Trabajador no encontrado.'); return res.redirect('/planilla/resumen'); }

  const [{ data: roster }, { data: descuentos }, { data: vacaciones }, { data: permisos }, { data: pagosVac }] = await Promise.all([
    db.select('planilla_periodo_trabajadores',
      `select=id,periodo_id,sueldo_base,periodo:planilla_periodos(id,etiqueta,mes,anio,estado)&personal_id=eq.${req.params.personalId}`),
    db.select('planilla_descuentos',
      `select=id,origen_codigo,importe_original,saldo,estado,fecha,concepto:planilla_conceptos_descuento(nombre)&personal_id=eq.${req.params.personalId}&order=fecha.desc`),
    db.select('planilla_vacaciones',
      `select=id,fecha_inicio,fecha_fin,dias,estado,estado_pago,remuneracion,periodo:planilla_vacaciones_periodos(anio)&personal_id=eq.${req.params.personalId}&order=fecha_inicio.desc&limit=10`),
    db.select('planilla_permisos',
      `select=id,fecha,dia_completo,con_goce,estado,motivo&personal_id=eq.${req.params.personalId}&order=fecha.desc&limit=10`),
    db.select('planilla_vacaciones_pagos', `select=monto,fecha_pago&personal_id=eq.${req.params.personalId}`)
  ]);

  // Remuneración vacacional PAGADA, por mes de pago (concepto separado de los bonos)
  const vacPorMes = {};
  (pagosVac || []).forEach(p => { const k = String(p.fecha_pago).slice(0, 7); vacPorMes[k] = (vacPorMes[k] || 0) + Number(p.monto); });

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
      const remVac = vacPorMes[`${r.periodo.anio}-${pad2(r.periodo.mes)}`] || 0;
      return {
        periodoId: r.periodo_id, etiqueta: r.periodo.etiqueta, mes: r.periodo.mes, anio: r.periodo.anio,
        estado: r.periodo.estado, rosterId: r.id,
        sueldo, bonos, vacaciones: remVac, descuentos: descuentosCobrados, neto: sueldo + bonos + remVac - descuentosCobrados
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
    vacaciones: (vacaciones || []).map(v => ({ ...v, inicioTxt: fechaTxt(v.fecha_inicio), finTxt: fechaTxt(v.fecha_fin), remuneracion: Number(v.remuneracion || 0) })),
    permisos: permisos || [],
    puedeEditar: esAdminOEditor(req.usuarioFresco)
  });
});

// ═══════════════════════════════════════════════
// 4-7. PERIODOS — sección principal de Planilla
// ═══════════════════════════════════════════════

async function totalesDelPeriodo(periodoId, periodo) {
  const [{ data: roster }, { data: bonos }, { data: cobros }, pagosVac] = await Promise.all([
    db.select('planilla_periodo_trabajadores', `select=personal_id,sueldo_base&periodo_id=eq.${periodoId}`),
    db.select('planilla_bonos', `select=personal_id,importe&periodo_id=eq.${periodoId}`),
    db.select('planilla_descuento_cobros', `select=personal_id,importe&periodo_id=eq.${periodoId}&cobrado=eq.true`),
    periodo ? pagosVacacionalesDelMes(periodo.mes, periodo.anio) : Promise.resolve([])
  ]);
  const enRoster = new Set((roster || []).map(r => r.personal_id));
  const totalVac = sumaPagosVac(pagosVac.filter(p => enRoster.has(p.personal_id)));
  const sueldos = (roster || []).reduce((s, r) => s + Number(r.sueldo_base || 0), 0);
  const totalBonos = (bonos || []).reduce((s, b) => s + Number(b.importe), 0);
  const totalCobrado = (cobros || []).reduce((s, c) => s + Number(c.importe), 0);
  return {
    trabajadores: (roster || []).length,
    sueldos, bonos: totalBonos, vacaciones: totalVac, descuentos: totalCobrado,
    neto: sueldos + totalBonos + totalVac - totalCobrado
  };
}

router.get('/periodos', async (req, res) => {
  const { data: periodos } = await db.select('planilla_periodos', 'select=id,mes,anio,etiqueta,estado,creado_en,cerrado_en&order=anio.desc,mes.desc');
  const lista = await Promise.all((periodos || []).map(async p => ({ ...p, totales: await totalesDelPeriodo(p.id, p) })));
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

  const vacPorPersonal = {};
  (await pagosVacacionalesDelMes(periodo.mes, periodo.anio)).forEach(p => {
    vacPorPersonal[p.personal_id] = (vacPorPersonal[p.personal_id] || 0) + p.monto;
  });

  const filas = roster.map(r => {
    const sueldo = Number(r.sueldo_base || 0);
    const bonos = bonosPorPersonal[r.personal_id] || 0;
    const remVac = vacPorPersonal[r.personal_id] || 0;
    const descuentos = cobrosPorPersonal[r.personal_id] || 0;
    return {
      rosterId: r.id, personalId: r.personal_id,
      nombreCompleto: r.personal ? `${r.personal.nombres} ${r.personal.apellidos}` : '—',
      dni: r.personal ? r.personal.dni : '—',
      cargoMostrar: r.categoria === 'tripulacion' ? (r.tipo || '—') : (r.cargo || '—'),
      area: r.area || '—', sueldo, bonos, vacaciones: remVac, descuentos, neto: sueldo + bonos + remVac - descuentos,
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

  const [{ data: bonos }, { data: cobrosDelPeriodo }, { data: pendientesTrabajador }, vacPer, pagosVac] = await Promise.all([
    db.select('planilla_bonos', `select=*&periodo_id=eq.${req.params.periodoId}&personal_id=eq.${roster.personal_id}&order=fecha.asc`),
    db.select('planilla_descuento_cobros', `select=*,descuento:planilla_descuentos(origen_codigo,importe_original,saldo,concepto:planilla_conceptos_descuento(nombre))&periodo_id=eq.${req.params.periodoId}&personal_id=eq.${roster.personal_id}`),
    db.select('planilla_descuentos', `select=*,concepto:planilla_conceptos_descuento(nombre,clave)&personal_id=eq.${roster.personal_id}&estado=eq.pendiente&order=fecha.asc`),
    obtenerVacacionesPermisosDelPeriodo(roster.personal_id, periodo.mes, periodo.anio),
    pagosVacacionalesDelMes(periodo.mes, periodo.anio, roster.personal_id)
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
  const totalVac = sumaPagosVac(pagosVac);
  const totalIngresos = sueldo + totalBonos + totalVac;
  const neto = totalIngresos - totalDescontadoEstePeriodo;

  res.render('planilla/trabajador-periodo', {
    layout: 'main',
    title: `${roster.personal.nombres} ${roster.personal.apellidos} — ${periodo.etiqueta}`,
    pageTitle: `${roster.personal.nombres} ${roster.personal.apellidos}`, pageSubtitle: periodo.etiqueta,
    seccionActiva: 'periodos', periodo, roster,
    cargoMostrar: roster.categoria === 'tripulacion' ? (roster.tipo || '—') : (roster.cargo || '—'),
    bonos: bonos || [], descuentosConDecision,
    vacaciones: vacPer.vacaciones, permisos: vacPer.permisos,
    remuneracionesVac: pagosVac.map(x => ({ concepto: 'Remuneración vacacional', detalle: x.detalle, importe: x.monto, fechaPagoTxt: fechaTxt(x.fecha_pago) })),
    totales: { sueldo, bonos: totalBonos, vacaciones: totalVac, totalIngresos, descuentos: totalDescontadoEstePeriodo, neto },
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
  const { data: periodoRows } = await db.select('planilla_periodos', `select=estado,mes,anio&id=eq.${req.params.periodoId}&limit=1`);
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
  // La remuneración vacacional es un concepto propio de la planilla: si ya
  // está pagada en este periodo no se debe volver a cargar como bono.
  if (/vacaci/i.test(concepto)) {
    const yaIncluida = await pagosVacacionalesDelMes(periodoRows[0].mes, periodoRows[0].anio, roster.personal_id);
    if (yaIncluida.length) {
      req.flash('error', 'La remuneración vacacional de este trabajador ya se incluye en esta planilla como concepto separado; no la registres también como bono.');
      return res.redirect(`/planilla/periodos/${req.params.periodoId}/trabajador/${req.params.rosterId}`);
    }
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

const esUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
const BADGE_VAC  = { 'Pendiente': 'badge-warning', 'Aprobado': 'badge-primary', 'En curso': 'badge-primary', 'Finalizado': 'badge-success', 'Cancelado': 'badge-error' };
const BADGE_PAGO = { 'Pendiente de pago': 'badge-warning', 'Pagado': 'badge-success' };
const numTxt = (n) => String(Number(n));

// Días de vacaciones anuales por defecto (Configuración → Parámetros laborales)
async function diasVacacionesEmpresa() {
  const { data } = await db.select('planilla_empresa_datos', 'select=*&id=eq.1&limit=1');
  const d = data && data[0] ? Number(data[0].dias_vacaciones_anuales) : 0;
  return d > 0 ? d : 15;
}

// Valida y arma los datos de una vacación (alta o edición). No escribe en
// la base de datos. Devuelve { error } o { registro, periodoNuevo }.
async function prepararVacacion(body, { personalId, excluirId }) {
  const { periodo_id, anio_nuevo, dias_nuevo, fecha_inicio, fecha_fin, remuneracion, fecha_pago, observacion } = body;
  const estado = ESTADOS_VACACION.includes(body.estado) && body.estado !== 'Cancelado' ? body.estado : 'Pendiente';
  if (!personalId || !periodo_id || !fecha_inicio || !fecha_fin) {
    return { error: 'Completa trabajador, periodo vacacional, fecha de inicio y fecha de fin.' };
  }
  const dias = diasEntre(fecha_inicio, fecha_fin);
  if (dias === null) return { error: 'Las fechas no son válidas.' };
  if (dias < 1) return { error: 'La fecha de fin no puede ser anterior a la fecha de inicio.' };

  const remu = (remuneracion === undefined || remuneracion === null || remuneracion === '') ? 0 : parseFloat(remuneracion);
  if (isNaN(remu) || remu < 0) return { error: 'La remuneración vacacional debe ser un monto válido (0 o mayor).' };
  if (fecha_pago && !fechaValida(fecha_pago)) return { error: 'La fecha de pago no es válida.' };

  // No superponer con otras vacaciones (no canceladas) del mismo trabajador
  let qTraslape = `select=id,fecha_inicio,fecha_fin&personal_id=eq.${personalId}&estado=neq.Cancelado` +
                  `&fecha_inicio=lte.${fecha_fin}&fecha_fin=gte.${fecha_inicio}&limit=1`;
  if (excluirId) qTraslape += `&id=neq.${excluirId}`;
  const { data: traslape } = await db.select('planilla_vacaciones', qTraslape);
  if (traslape && traslape.length) {
    return { error: `Se superpone con otras vacaciones de este trabajador (${fechaTxt(traslape[0].fecha_inicio)} al ${fechaTxt(traslape[0].fecha_fin)}).` };
  }

  // Periodo vacacional: uno existente o uno nuevo (hereda los días de la configuración)
  let periodoNuevo = null, otorgados, utilizados = 0;
  if (periodo_id === 'nuevo') {
    const anio = parseInt(anio_nuevo);
    if (!anio || anio < 2000 || anio > 2100) return { error: 'Indica un año válido para el nuevo periodo vacacional.' };
    const diasOtorgados = (dias_nuevo === undefined || dias_nuevo === null || dias_nuevo === '') ? await diasVacacionesEmpresa() : parseFloat(dias_nuevo);
    if (isNaN(diasOtorgados) || diasOtorgados <= 0) return { error: 'Los días otorgados del periodo deben ser mayores a 0.' };
    const { data: existe } = await db.select('planilla_vacaciones_periodos', `select=id&personal_id=eq.${personalId}&anio=eq.${anio}&limit=1`);
    if (existe && existe.length) return { error: `Este trabajador ya tiene el periodo vacacional ${anio}; selecciónalo en la lista.` };
    periodoNuevo = { personal_id: personalId, anio, dias_otorgados: diasOtorgados };
    otorgados = diasOtorgados;
  } else {
    if (!esUuid(periodo_id)) return { error: 'Periodo vacacional inválido.' };
    const { data: per } = await db.select('planilla_vacaciones_periodos', `select=id&id=eq.${periodo_id}&personal_id=eq.${personalId}&limit=1`);
    if (!per || !per.length) return { error: 'Ese periodo vacacional no pertenece a este trabajador.' };
    const saldo = (await saldosDePeriodos([periodo_id], excluirId))[periodo_id];
    otorgados = saldo.otorgados; utilizados = saldo.utilizados;
  }
  if (dias > otorgados - utilizados) {
    return { error: `Esas vacaciones son ${dias} día(s), pero en el periodo solo quedan ${numTxt(otorgados - utilizados)} (otorgados ${numTxt(otorgados)}, utilizados ${numTxt(utilizados)}).` };
  }

  return {
    periodoNuevo,
    registro: {
      personal_id: personalId, periodo_vacacional_id: periodo_id === 'nuevo' ? null : periodo_id,
      fecha_inicio, fecha_fin, dias, estado, remuneracion: remu,
      fecha_pago: fecha_pago || null, observacion: observacion && observacion.trim() ? observacion.trim() : null
    }
  };
}

// ── Pantalla principal de Vacaciones ──
router.get('/vacaciones', async (req, res) => {
  const personalId = esUuid(req.query.personal_id) ? req.query.personal_id : null;
  const anioNum = parseInt(req.query.anio) || null;
  const estado = ESTADOS_VACACION.includes(req.query.estado) ? req.query.estado : '';
  const estadoPago = ['Pendiente de pago', 'Pagado'].includes(req.query.estado_pago) ? req.query.estado_pago : '';

  let qVac = 'select=id,personal_id,fecha_inicio,fecha_fin,dias,estado,estado_pago,remuneracion,personal:personal_tripulantes(nombres,apellidos),' +
             'periodo:planilla_vacaciones_periodos(id,anio)&order=fecha_inicio.desc&limit=500';
  let qPer = 'select=id,dias_otorgados&order=anio.desc';
  let qUsadas = 'select=periodo_vacacional_id,dias,remuneracion,estado_pago&estado=neq.Cancelado';
  if (personalId) { qVac += `&personal_id=eq.${personalId}`; qPer += `&personal_id=eq.${personalId}`; qUsadas += `&personal_id=eq.${personalId}`; }
  if (estado)     qVac += `&estado=eq.${encodeURIComponent(estado)}`;
  if (estadoPago) qVac += `&estado_pago=eq.${encodeURIComponent(estadoPago)}`;
  if (anioNum)    qPer += `&anio=eq.${anioNum}`;

  const [{ data: vacs }, { data: periodos }, { data: usadas }, { data: todosPeriodos }, { data: personalSel }, diasEmpresa, { data: trabajadores }] = await Promise.all([
    db.select('planilla_vacaciones', qVac), db.select('planilla_vacaciones_periodos', qPer),
    db.select('planilla_vacaciones', qUsadas), db.select('planilla_vacaciones_periodos', 'select=anio'),
    personalId ? db.select('personal_tripulantes', `select=nombres,apellidos&id=eq.${personalId}&limit=1`) : Promise.resolve({ data: [] }),
    diasVacacionesEmpresa(),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos&activo=eq.true&order=apellidos.asc')
  ]);

  // Tarjetas: días otorgados/utilizados/restantes (de los periodos en pantalla) y
  // remuneraciones pendientes de pago (vacaciones no canceladas sin pagar).
  const idsPeriodo = new Set((periodos || []).map(p => p.id));
  const otorgados = (periodos || []).reduce((sum, p) => sum + Number(p.dias_otorgados), 0);
  const enAlcance = (usadas || []).filter(u => !anioNum || idsPeriodo.has(u.periodo_vacacional_id));
  const utilizados = enAlcance.filter(u => idsPeriodo.has(u.periodo_vacacional_id)).reduce((sum, u) => sum + Number(u.dias), 0);
  const pendientes = enAlcance.filter(u => u.estado_pago === 'Pendiente de pago').reduce((sum, u) => sum + Number(u.remuneracion || 0), 0);

  const filas = (vacs || []).filter(v => !anioNum || (v.periodo && v.periodo.anio === anioNum)).map(v => {
    const cancelada = v.estado === 'Cancelado', pagada = v.estado_pago === 'Pagado';
    return {
      id: v.id, trabajador: v.personal ? `${v.personal.apellidos}, ${v.personal.nombres}` : '—',
      periodoTxt: v.periodo ? `Periodo ${v.periodo.anio}` : '—',
      inicioTxt: fechaTxt(v.fecha_inicio), finTxt: fechaTxt(v.fecha_fin), dias: Number(v.dias),
      remuneracion: Number(v.remuneracion || 0), estado: v.estado, estadoPago: v.estado_pago,
      badgeEstado: BADGE_VAC[v.estado] || 'badge-neutral', badgePago: BADGE_PAGO[v.estado_pago] || 'badge-neutral',
      puedeEditarFila: !cancelada, puedePagar: !cancelada && !pagada, puedeCancelar: !cancelada && !pagada
    };
  });

  res.render('planilla/vacaciones', {
    layout: 'main', title: 'Vacaciones', pageTitle: 'Vacaciones',
    pageSubtitle: 'Periodos vacacionales, vacaciones y su pago',
    seccionActiva: 'vacaciones', filas,
    resumen: { otorgados, utilizados, restantes: otorgados - utilizados, pendientes },
    filtros: { personalId: personalId || '', personalNombre: personalSel && personalSel[0] ? `${personalSel[0].nombres} ${personalSel[0].apellidos}` : '', anio: anioNum || '', estado, estadoPago },
    aniosFiltro: [...new Set((todosPeriodos || []).map(p => p.anio))].sort((a, b) => b - a),
    estadosFiltro: ESTADOS_VACACION, estadosForm: ESTADOS_VACACION.filter(e => e !== 'Cancelado'),
    trabajadoresFiltro: (trabajadores || []).map(t => ({ id: t.id, nombreCompleto: `${t.apellidos}, ${t.nombres}` })),
    diasEmpresa, anioActual: new Date().getFullYear(), today: new Date().toISOString().slice(0, 10),
    puedeEditar: esAdminOEditor(req.usuarioFresco)
  });
});

// Periodos vacacionales de un trabajador (con su saldo) — para el formulario
router.get('/vacaciones/trabajador/:personalId/periodos', async (req, res) => {
  if (!esUuid(req.params.personalId)) return res.status(400).json({ error: 'Trabajador inválido.' });
  const { data: periodos } = await db.select('planilla_vacaciones_periodos',
    `select=id,anio,dias_otorgados&personal_id=eq.${req.params.personalId}&order=anio.desc`);
  const saldos = await saldosDePeriodos((periodos || []).map(p => p.id));
  res.json({
    diasPorDefecto: await diasVacacionesEmpresa(), anioSugerido: new Date().getFullYear(),
    periodos: (periodos || []).map(p => ({ id: p.id, anio: p.anio, ...saldos[p.id] }))
  });
});

// Detalle de una vacación (botón "Ver" y precarga de "Editar")
router.get('/vacaciones/:id', async (req, res) => {
  if (!esUuid(req.params.id)) return res.status(400).json({ error: 'Registro inválido.' });
  const [{ data: rows }, { data: pagos }] = await Promise.all([
    db.select('planilla_vacaciones', `select=*,personal:personal_tripulantes(nombres,apellidos,dni),periodo:planilla_vacaciones_periodos(id,anio,dias_otorgados)&id=eq.${req.params.id}&limit=1`),
    db.select('planilla_vacaciones_pagos', `select=monto,fecha_pago,creado_en&vacacion_id=eq.${req.params.id}&limit=1`)
  ]);
  const v = rows && rows[0];
  if (!v) return res.status(404).json({ error: 'Vacación no encontrada.' });
  const saldo = v.periodo ? (await saldosDePeriodos([v.periodo.id]))[v.periodo.id] : null;
  res.json({ vacacion: v, saldo, pago: (pagos && pagos[0]) || null });
});

router.post('/vacaciones', requirePlanillaEditar, async (req, res) => {
  const volver = '/planilla/vacaciones';
  if (!esUuid(req.body.personal_id)) { req.flash('error', 'Selecciona un trabajador.'); return res.redirect(volver); }
  const r = await prepararVacacion(req.body, { personalId: req.body.personal_id });
  if (r.error) { req.flash('error', r.error); return res.redirect(volver); }

  let periodoId = r.registro.periodo_vacacional_id;
  if (r.periodoNuevo) {
    const { data, error } = await db.insert('planilla_vacaciones_periodos', { ...r.periodoNuevo, creado_por: req.session.user.id });
    if (error || !data || !data[0]) {
      req.flash('error', 'No se pudo crear el periodo vacacional: ' + (error ? error.message : 'sin respuesta'));
      return res.redirect(volver);
    }
    periodoId = data[0].id;
  }
  const { data, error } = await db.insert('planilla_vacaciones', { ...r.registro, periodo_vacacional_id: periodoId, creado_por: req.session.user.id });
  if (error) {
    if (r.periodoNuevo) await db.delete('planilla_vacaciones_periodos', `id=eq.${periodoId}`);
    req.flash('error', 'Error al registrar las vacaciones: ' + error.message);
    return res.redirect(volver);
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'registrar_vacaciones', entidad: 'vacacion', entidad_id: data && data[0] && data[0].id,
    valor_nuevo: { personal_id: r.registro.personal_id, periodo_vacacional_id: periodoId, fecha_inicio: r.registro.fecha_inicio, fecha_fin: r.registro.fecha_fin, dias: r.registro.dias, remuneracion: r.registro.remuneracion }
  });
  req.flash('success', `Vacaciones registradas (${r.registro.dias} día${r.registro.dias === 1 ? '' : 's'}).`);
  res.redirect(volver);
});

router.post('/vacaciones/:id/editar', requirePlanillaEditar, async (req, res) => {
  const volver = '/planilla/vacaciones';
  if (!esUuid(req.params.id)) { req.flash('error', 'Registro inválido.'); return res.redirect(volver); }
  const { data: rows } = await db.select('planilla_vacaciones', `select=*&id=eq.${req.params.id}&limit=1`);
  const actual = rows && rows[0];
  if (!actual) { req.flash('error', 'Vacación no encontrada.'); return res.redirect(volver); }
  if (actual.estado === 'Cancelado') { req.flash('error', 'Una vacación cancelada no se puede editar.'); return res.redirect(volver); }

  // Si ya está pagada, la remuneración y la fecha de pago quedan fijas (son las del pago).
  const body = { ...req.body };
  if (actual.estado_pago === 'Pagado') { body.remuneracion = actual.remuneracion; body.fecha_pago = actual.fecha_pago || ''; }

  const r = await prepararVacacion(body, { personalId: actual.personal_id, excluirId: actual.id });
  if (r.error) { req.flash('error', r.error); return res.redirect(volver); }

  let periodoId = r.registro.periodo_vacacional_id;
  if (r.periodoNuevo) {
    const { data, error } = await db.insert('planilla_vacaciones_periodos', { ...r.periodoNuevo, creado_por: req.session.user.id });
    if (error || !data || !data[0]) { req.flash('error', 'No se pudo crear el periodo vacacional.'); return res.redirect(volver); }
    periodoId = data[0].id;
  }
  const { error } = await db.update('planilla_vacaciones', `id=eq.${actual.id}`, { ...r.registro, periodo_vacacional_id: periodoId });
  if (error) {
    if (r.periodoNuevo) await db.delete('planilla_vacaciones_periodos', `id=eq.${periodoId}`);
    req.flash('error', 'No se pudo guardar: ' + error.message);
    return res.redirect(volver);
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'editar_vacaciones', entidad: 'vacacion', entidad_id: actual.id,
    valor_anterior: { fecha_inicio: actual.fecha_inicio, fecha_fin: actual.fecha_fin, dias: actual.dias, estado: actual.estado, remuneracion: actual.remuneracion },
    valor_nuevo: { fecha_inicio: r.registro.fecha_inicio, fecha_fin: r.registro.fecha_fin, dias: r.registro.dias, estado: r.registro.estado, remuneracion: r.registro.remuneracion }
  });
  req.flash('success', 'Vacaciones actualizadas.');
  res.redirect(volver);
});

// Registrar el pago de la remuneración vacacional (una sola vez por vacación)
router.post('/vacaciones/:id/pago', requirePlanillaEditar, async (req, res) => {
  const volver = '/planilla/vacaciones';
  if (!esUuid(req.params.id)) { req.flash('error', 'Registro inválido.'); return res.redirect(volver); }
  const monto = parseFloat(req.body.monto);
  const fechaPago = req.body.fecha_pago;
  if (isNaN(monto) || monto <= 0) { req.flash('error', 'Indica el monto pagado (mayor a 0).'); return res.redirect(volver); }
  if (!fechaValida(fechaPago)) { req.flash('error', 'Indica una fecha de pago válida.'); return res.redirect(volver); }

  const { data: rows } = await db.select('planilla_vacaciones', `select=*&id=eq.${req.params.id}&limit=1`);
  const v = rows && rows[0];
  if (!v) { req.flash('error', 'Vacación no encontrada.'); return res.redirect(volver); }
  if (v.estado === 'Cancelado') { req.flash('error', 'No se puede pagar una vacación cancelada.'); return res.redirect(volver); }
  if (v.estado_pago === 'Pagado') { req.flash('error', 'Esta vacación ya tiene su pago registrado.'); return res.redirect(volver); }

  // El pago entra en la planilla del mes de la fecha de pago: si ese mes ya
  // está cerrado, no se puede alterar (reábrelo o usa otra fecha).
  const [anioP, mesP] = fechaPago.split('-').map(Number);
  const { data: periodoMes } = await db.select('planilla_periodos', `select=estado,etiqueta&mes=eq.${mesP}&anio=eq.${anioP}&limit=1`);
  if (periodoMes && periodoMes[0] && periodoMes[0].estado === 'cerrado') {
    req.flash('error', `La planilla ${periodoMes[0].etiqueta} está cerrada; elige otra fecha de pago o reabre ese periodo.`);
    return res.redirect(volver);
  }

  // UNIQUE(vacacion_id) en la base impide un segundo pago aunque haya doble clic.
  const { error: errPago } = await db.insert('planilla_vacaciones_pagos', {
    vacacion_id: v.id, personal_id: v.personal_id, monto, fecha_pago: fechaPago, registrado_por: req.session.user.id
  });
  if (errPago) {
    req.flash('error', /duplicate|unique/i.test(errPago.message) ? 'Esta vacación ya tiene su pago registrado.' : 'No se pudo registrar el pago: ' + errPago.message);
    return res.redirect(volver);
  }
  const { error: errUpd } = await db.update('planilla_vacaciones', `id=eq.${v.id}`, { estado_pago: 'Pagado', fecha_pago: fechaPago, remuneracion: monto });
  if (errUpd) {
    await db.delete('planilla_vacaciones_pagos', `vacacion_id=eq.${v.id}`);
    req.flash('error', 'No se pudo confirmar el pago: ' + errUpd.message);
    return res.redirect(volver);
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'pagar_vacaciones', entidad: 'vacacion', entidad_id: v.id,
    valor_nuevo: { monto, fecha_pago: fechaPago }
  });
  req.flash('success', `Pago registrado: S/ ${monto.toFixed(2)}. Se incluirá en la planilla de ${MESES[mesP]} ${anioP}.`);
  res.redirect(volver);
});

// Cancelar: los días vuelven al saldo automáticamente (el saldo se calcula
// sumando solo las vacaciones no canceladas). Con pago registrado no se cancela.
router.post('/vacaciones/:id/cancelar', requirePlanillaEditar, async (req, res) => {
  const volver = '/planilla/vacaciones';
  if (!esUuid(req.params.id)) { req.flash('error', 'Registro inválido.'); return res.redirect(volver); }
  const { data: rows } = await db.select('planilla_vacaciones', `select=id,dias,estado,estado_pago&id=eq.${req.params.id}&limit=1`);
  const v = rows && rows[0];
  if (!v) { req.flash('error', 'Vacación no encontrada.'); return res.redirect(volver); }
  if (v.estado === 'Cancelado') { req.flash('error', 'Esta vacación ya estaba cancelada.'); return res.redirect(volver); }
  if (v.estado_pago === 'Pagado') { req.flash('error', 'No se puede cancelar: la vacación ya tiene su pago registrado.'); return res.redirect(volver); }
  const { error } = await db.update('planilla_vacaciones', `id=eq.${v.id}`, { estado: 'Cancelado' });
  if (error) { req.flash('error', 'No se pudo cancelar: ' + error.message); return res.redirect(volver); }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'cancelar_vacaciones', entidad: 'vacacion', entidad_id: v.id,
    valor_anterior: { estado: v.estado }, valor_nuevo: { estado: 'Cancelado' }
  });
  req.flash('success', `Vacaciones canceladas. Se devolvieron ${numTxt(v.dias)} día(s) al saldo del periodo.`);
  res.redirect(volver);
});

// ── Permisos (las vacaciones ahora viven en /planilla/vacaciones) ──
router.get('/vacaciones-permisos', async (req, res) => {
  const [{ data: tipos }, { data: proximosPer }] = await Promise.all([
    db.select('planilla_tipos_permiso', 'select=id,nombre&activo=eq.true&order=nombre.asc'),
    db.select('planilla_permisos',
      'select=id,fecha,dia_completo,con_goce,estado,motivo,personal:personal_tripulantes(nombres,apellidos),tipo:planilla_tipos_permiso(nombre),descuento:planilla_descuentos(importe_original,saldo)&order=fecha.desc&limit=20')
  ]);
  res.render('planilla/vacaciones-permisos', {
    layout: 'main', title: 'Permisos',
    pageTitle: 'Permisos', pageSubtitle: 'Administra los permisos de los trabajadores',
    seccionActiva: 'vacaciones-permisos', tipos: tipos || [],
    permisos: proximosPer || [],
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
  if (error) {
    const msg = error.message.includes('FALTA_CONCEPTO_PERMISO_SIN_GOCE')
      ? 'Falta ejecutar una migración de base de datos (PLANILLA_FIX_CONCEPTO_PERMISO_MIGRATION.sql) antes de poder generar descuentos por permisos sin goce.'
      : 'Error al registrar el permiso: ' + error.message;
    req.flash('error', msg);
  } else {
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
// Nota: la exportación se genera como un libro de Excel real (.xlsx,
// librería "xlsx"/SheetJS), con una hoja por cada tipo de reporte.
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
  const mesDePeriodo = {}; todos.forEach(p => { mesDePeriodo[p.id] = `${p.anio}-${pad2(p.mes)}`; });
  // Remuneración vacacional pagada: personal|YYYY-MM (mes de pago) → monto
  const cargarVacPagadas = async () => {
    const { data } = await db.select('planilla_vacaciones_pagos', 'select=personal_id,monto,fecha_pago');
    const m = {};
    (data || []).forEach(x => { const k = x.personal_id + '|' + String(x.fecha_pago).slice(0, 7); m[k] = (m[k] || 0) + Number(x.monto); });
    return m;
  };

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
    let q = 'select=fecha_inicio,fecha_fin,dias,estado,estado_pago,remuneracion,fecha_pago,periodo:planilla_vacaciones_periodos(anio),personal:personal_tripulantes(nombres,apellidos,area,cargo,tipo)&order=fecha_inicio.desc';
    if (filtros.personalId) q += `&personal_id=eq.${filtros.personalId}`;
    if (filtros.estado) q += `&estado=eq.${encodeURIComponent(filtros.estado)}`;
    const { data } = await db.select('planilla_vacaciones', q);
    const rows = (data || []).filter(v => coincideFiltroPersonal(v.personal)).map(v => [
      v.personal ? `${v.personal.nombres} ${v.personal.apellidos}` : '—', v.periodo ? `Periodo ${v.periodo.anio}` : '—',
      v.fecha_inicio, v.fecha_fin, v.dias, Number(v.remuneracion || 0).toFixed(2), v.estado, v.estado_pago, v.fecha_pago || '—'
    ]);
    return { headers: ['Trabajador', 'Periodo', 'Fecha inicio', 'Fecha fin', 'Días', 'Remuneración', 'Estado vacaciones', 'Estado pago', 'Fecha pago'], rows };
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
    if (!filtros.personalId) return { headers: ['Periodo', 'Sueldo', 'Bonos', 'Vacaciones', 'Descuentos', 'Neto'], rows: [] };
    const { data: roster } = await db.select('planilla_periodo_trabajadores',
      `select=periodo_id,sueldo_base,periodo:planilla_periodos(etiqueta,mes,anio)&personal_id=eq.${filtros.personalId}`);
    const [{ data: bonos }, { data: cobros }] = await Promise.all([
      db.select('planilla_bonos', `select=periodo_id,importe&personal_id=eq.${filtros.personalId}`),
      db.select('planilla_descuento_cobros', `select=periodo_id,importe&personal_id=eq.${filtros.personalId}&cobrado=eq.true`)
    ]);
    const vacPagadas = await cargarVacPagadas();
    const bonosPor = {}, cobrosPor = {};
    (bonos || []).forEach(b => { bonosPor[b.periodo_id] = (bonosPor[b.periodo_id] || 0) + Number(b.importe); });
    (cobros || []).forEach(c => { cobrosPor[c.periodo_id] = (cobrosPor[c.periodo_id] || 0) + Number(c.importe); });
    const rows = (roster || []).filter(r => r.periodo).sort((a, b) => (a.periodo.anio - b.periodo.anio) || (a.periodo.mes - b.periodo.mes))
      .map(r => {
        const sueldo = Number(r.sueldo_base || 0), bon = bonosPor[r.periodo_id] || 0, desc = cobrosPor[r.periodo_id] || 0;
        const vac = vacPagadas[filtros.personalId + '|' + `${r.periodo.anio}-${pad2(r.periodo.mes)}`] || 0;
        return [r.periodo.etiqueta, sueldo.toFixed(2), bon.toFixed(2), vac.toFixed(2), desc.toFixed(2), (sueldo + bon + vac - desc).toFixed(2)];
      });
    return { headers: ['Periodo', 'Sueldo', 'Bonos', 'Vacaciones', 'Descuentos', 'Neto'], rows };
  }

  // 'general' (por defecto)
  if (!idsPeriodo.length) return { headers: ['Trabajador', 'Periodo', 'Sueldo', 'Bonos', 'Vacaciones', 'Descuentos', 'Neto'], rows: [] };
  let qRoster = `select=id,periodo_id,personal_id,sueldo_base,area,cargo,tipo,categoria,personal:personal_tripulantes(nombres,apellidos)&periodo_id=in.(${idsPeriodo.join(',')})`;
  if (filtros.personalId) qRoster += `&personal_id=eq.${filtros.personalId}`;
  const { data: roster } = await db.select('planilla_periodo_trabajadores', qRoster);
  const filtrado = (roster || []).filter(coincideFiltroPersonal);
  const rIds = filtrado.map(r => r.personal_id);
  let bonosPor = {}, cobrosPor = {};
  const vacPagadas = rIds.length ? await cargarVacPagadas() : {};
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
    const vac = vacPagadas[r.personal_id + '|' + (mesDePeriodo[r.periodo_id] || '')] || 0;
    return [r.personal ? `${r.personal.nombres} ${r.personal.apellidos}` : '—', etiquetaPeriodo[r.periodo_id] || '—',
      sueldo.toFixed(2), bon.toFixed(2), vac.toFixed(2), desc.toFixed(2), (sueldo + bon + vac - desc).toFixed(2)];
  });
  return { headers: ['Trabajador', 'Periodo', 'Sueldo', 'Bonos', 'Vacaciones', 'Descuentos', 'Neto'], rows };
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

// Genera UN solo libro de Excel con todos los reportes, cada uno en su
// propia hoja (Reporte General, Bonos, Descuentos, Uniformes,
// Vacaciones, Permisos — y, si hay un trabajador filtrado, también su
// Histórico), respetando los mismos filtros que se ven en pantalla.
router.get('/reportes/exportar.xlsx', async (req, res) => {
  const filtros = leerFiltrosReporte(req.query);
  const hojas = [
    { tipo: 'general',     nombre: 'Reporte General' },
    { tipo: 'bonos',       nombre: 'Bonos' },
    { tipo: 'descuentos',  nombre: 'Descuentos' },
    { tipo: 'uniformes',   nombre: 'Uniformes' },
    { tipo: 'vacaciones',  nombre: 'Vacaciones' },
    { tipo: 'permisos',    nombre: 'Permisos' }
  ];
  if (filtros.personalId) hojas.push({ tipo: 'historico-trabajador', nombre: 'Histórico trabajador' });

  const wb = XLSX.utils.book_new();
  for (const h of hojas) {
    const reporte = await generarReporte(h.tipo, filtros);
    const ws = XLSX.utils.aoa_to_sheet([reporte.headers, ...reporte.rows]);
    ws['!cols'] = reporte.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.substring(0, 31)); // Excel limita el nombre de hoja a 31 caracteres
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="reportes-planilla.xlsx"');
  res.send(buffer);
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

  const [{ data: bonos }, { data: cobros }, vacPer, pagosVac] = await Promise.all([
    db.select('planilla_bonos', `select=concepto,importe&periodo_id=eq.${periodoId}&personal_id=eq.${roster.personal_id}`),
    db.select('planilla_descuento_cobros',
      `select=importe,descuento:planilla_descuentos(origen_codigo,concepto:planilla_conceptos_descuento(nombre))&periodo_id=eq.${periodoId}&personal_id=eq.${roster.personal_id}&cobrado=eq.true`),
    obtenerVacacionesPermisosDelPeriodo(roster.personal_id, periodo.mes, periodo.anio),
    pagosVacacionalesDelMes(periodo.mes, periodo.anio, roster.personal_id)
  ]);
  const totalVac = sumaPagosVac(pagosVac);
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
    remuneracionesVac: pagosVac.map(x => ({ concepto: 'Remuneración vacacional', detalle: x.detalle, importe: x.monto })),
    sueldo, totalBonos, totalVac, totalIngresos: sueldo + totalBonos + totalVac, totalDescuentos, neto: sueldo + totalBonos + totalVac - totalDescuentos,
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
