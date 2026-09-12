// =============================================
// utils/auditoria.js — Registro de auditoría de Planilla
//
// Se llama "best-effort" después de cada acción sensible ya
// confirmada (creación de periodo, cierre, reapertura, bonos,
// descuentos, cobros, entrega de uniforme, vacaciones, permisos).
// Si el registro de auditoría falla, NO debe romper la operación
// principal — solo se deja constancia en consola.
// =============================================
const { db } = require('../config/supabase');

async function registrarAuditoria({ usuario, accion, entidad, entidad_id, periodo_id, valor_anterior, valor_nuevo }) {
  try {
    await db.insert('planilla_auditoria', {
      usuario_id:     usuario && usuario.id ? usuario.id : null,
      usuario_nombre: usuario && usuario.nombre ? usuario.nombre : null,
      accion, entidad,
      entidad_id: entidad_id || null,
      periodo_id: periodo_id || null,
      valor_anterior: valor_anterior || null,
      valor_nuevo: valor_nuevo || null
    });
  } catch (e) {
    console.error('Error registrando auditoria de planilla:', e.message);
  }
}

module.exports = { registrarAuditoria };
