// =============================================
// routes/roles.js — Permisos por defecto de cada rol
// Exclusivo del rol "desarrollador" (ni siquiera admin entra aquí).
//
// Esto es solo una PLANTILLA: se usa para pre-marcar los checkboxes
// del formulario de Usuarios cuando se asigna un rol a alguien.
// Cambiar estos valores NO modifica a los usuarios ya existentes.
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireSoloDesarrollador, requireDesarrollador } = require('../middleware/auth');
const { GRUPOS_PERMISOS, CLAVES_PERMISOS, ROLES_CONFIGURABLES } = require('../config/permisos');

// JSON con los permisos por defecto de cada rol configurable — lo
// consume el formulario de Usuarios para pre-marcar los checkboxes
// cuando se elige un rol. Accesible por quien puede administrar
// Usuarios (admin/desarrollador), no solo por desarrollador.
router.get('/defaults.json', requireAuth, requireDesarrollador, async (req, res) => {
  const { data: filas } = await db.select('configuracion_roles_permisos', 'select=*');
  const porRol = {};
  (filas || []).forEach(f => {
    const valores = {};
    CLAVES_PERMISOS.forEach(clave => { valores[clave] = f[clave] === true; });
    porRol[f.rol] = valores;
  });
  res.json(porRol);
});

router.use(requireAuth, requireSoloDesarrollador);

router.get('/', async (req, res) => {
  const { data: filas } = await db.select('configuracion_roles_permisos', 'select=*');
  const porRol = {};
  (filas || []).forEach(f => { porRol[f.rol] = f; });

  const roles = ROLES_CONFIGURABLES.map(rol => ({
    rol,
    nombre: rol === 'operador' ? 'Operador' : 'Visualizador',
    valores: porRol[rol] || {}
  }));

  res.render('roles/index', {
    layout: 'main', title: 'Roles',
    pageTitle: 'Roles',
    pageSubtitle: 'Permisos por defecto de cada rol — solo se aplican al asignar el rol a un usuario nuevo; no afecta a los usuarios que ya existen',
    grupos: GRUPOS_PERMISOS,
    roles
  });
});

router.post('/:rol/guardar', async (req, res) => {
  const rol = req.params.rol;
  if (!ROLES_CONFIGURABLES.includes(rol)) {
    req.flash('error', 'Rol desconocido o no configurable.');
    return res.redirect('/roles');
  }
  const valores = { rol };
  CLAVES_PERMISOS.forEach(clave => { valores[clave] = req.body[clave] === 'on'; });
  valores.actualizado_por = req.session.user.id;
  valores.actualizado_en  = new Date().toISOString();

  const { error } = await db.upsert('configuracion_roles_permisos', valores, 'rol');
  if (error) req.flash('error', 'No se pudo guardar: ' + error.message);
  else       req.flash('success', 'Permisos por defecto del rol "' + rol + '" actualizados.');
  res.redirect('/roles');
});

module.exports = router;
