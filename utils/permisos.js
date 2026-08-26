// =============================================
// utils/permisos.js — Permisos y agencia SIEMPRE frescos desde BD
//
// req.session.user se guarda una sola vez, al iniciar sesión. Si un
// admin le asigna una agencia o cambia permisos a un usuario que ya
// tiene la sesión abierta, esos cambios NO se reflejan hasta que esa
// persona vuelva a iniciar sesión (la sesión quedó "vieja"/cacheada).
// Esto es lo que causaba que la serie de boletos no se generara
// aunque ya se hubiera asignado una agencia.
//
// Esta función consulta el usuario directamente en la base de datos
// en el momento de cada acción sensible (vender/anular/etc.), así los
// cambios de un administrador aplican de inmediato, sin re-login.
// =============================================
const { db } = require('../config/supabase');

async function usuarioActualFresco(sessionUser) {
  if (!sessionUser || !sessionUser.id) return sessionUser;
  const { data, error } = await db.select('usuarios',
    'select=id,nombre,rol,agencia_id,puede_anular,puede_postergar,puede_reservar,puede_habilitar,puede_reintegro,puede_crear_codigos,puede_editar_precios,puede_programar,puede_gestionar_inventario,puede_ver_planilla' +
    `&id=eq.${sessionUser.id}&limit=1`);
  if (error || !data || !data[0]) {
    // Respaldo defensivo: si falla la consulta, seguimos con lo que
    // había en sesión en vez de romper la operación.
    return sessionUser;
  }
  const u = data[0];
  return {
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    agencia_id: u.agencia_id || null,
    puede_anular:       u.puede_anular       !== false,
    puede_postergar:    u.puede_postergar    !== false,
    puede_reservar:     u.puede_reservar     !== false,
    puede_habilitar:    u.puede_habilitar    !== false,
    puede_reintegro:    u.puede_reintegro    !== false,
    puede_crear_codigos: u.puede_crear_codigos === true,
    puede_editar_precios: u.puede_editar_precios === true,
    puede_programar:      u.puede_programar      === true,
    puede_gestionar_inventario: u.puede_gestionar_inventario === true,
    puede_ver_planilla:         u.puede_ver_planilla         === true
  };
}

module.exports = { usuarioActualFresco };
