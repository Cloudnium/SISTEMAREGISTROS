// =============================================
// middleware/auth.js — Control de acceso
//
// Roles del sistema:
//   admin       → todo: ver, registrar, editar, eliminar
//   operador    → ver y registrar solamente
//   visualizador → solo ver
// =============================================

// Verifica sesión activa — requerido en todas las rutas privadas
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Debes iniciar sesion para acceder.');
  res.redirect('/login');
}

// Solo administradores (gestión de usuarios del sistema)
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && (req.session.user.rol === 'admin' || req.session.user.rol === 'desarrollador')) return next();
  req.flash('error', 'No tienes permisos para acceder a esta seccion.');
  res.redirect('/dashboard');
}

// Solo admin puede EDITAR (PUT/POST editar)
function requireAdminToEdit(req, res, next) {
  if (req.session && req.session.user && (req.session.user.rol === 'admin' || req.session.user.rol === 'desarrollador')) return next();
  req.flash('error', 'Solo el administrador puede editar registros.');
  res.redirect('back');
}

// Solo admin puede CREAR catálogos maestros (Servicios, Buses,
// Ciudades/Agencias, Destinos). La venta de boletos y demás
// operaciones diarias NO pasan por aquí.
function requireAdminToCreate(req, res, next) {
  if (req.session && req.session.user && (req.session.user.rol === 'admin' || req.session.user.rol === 'desarrollador')) return next();
  req.flash('error', 'Solo el administrador puede crear nuevos registros en esta sección.');
  res.redirect('back');
}

// Solo admin puede ELIMINAR (POST eliminar)
function requireAdminToDelete(req, res, next) {
  if (req.session && req.session.user && (req.session.user.rol === 'admin' || req.session.user.rol === 'desarrollador')) return next();
  req.flash('error', 'Solo el administrador puede eliminar registros.');
  res.redirect('back');
}

// Solo Desarrollador (o admin) puede administrar la visibilidad de secciones
function requireDesarrollador(req, res, next) {
  const rol = req.session && req.session.user && req.session.user.rol;
  if (rol === 'desarrollador' || rol === 'admin') return next();
  req.flash('error', 'No tienes permisos para acceder a esta sección.');
  res.redirect('/dashboard');
}

// Página "Roles" (permisos por defecto de cada rol): a diferencia de
// requireDesarrollador, aquí NI SIQUIERA admin puede entrar — es
// exclusiva del rol "desarrollador", tal como se pidió.
function requireSoloDesarrollador(req, res, next) {
  const rol = req.session && req.session.user && req.session.user.rol;
  if (rol === 'desarrollador') return next();
  req.flash('error', 'Solo el rol Desarrollador puede acceder a esta sección.');
  res.redirect('/dashboard');
}

// Bloquea el acceso directo por URL a una sección que el Desarrollador
// ocultó (el sidebar ya la oculta, pero esto evita que alguien entre
// escribiendo la URL). SOLO el rol "desarrollador" ignora esta
// restricción: el rol "admin" también queda sujeto a lo que el
// Desarrollador configure en "Visibilidad de secciones".
function requireSeccionVisible(clave) {
  return async (req, res, next) => {
    const rol = req.session && req.session.user && req.session.user.rol;
    if (rol === 'desarrollador') return next();
    if (res.locals.secciones && res.locals.secciones[clave] === false) {
      req.flash('error', 'Esta sección no está disponible en este momento.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

// Igual que requireSeccionVisible, pero además exige un permiso de
// usuario explícito para roles distintos de admin/desarrollador.
// Usado por Combustible, Personal e Inventario: ya no están siempre
// visibles para todos — el Desarrollador puede ocultarlas (afecta
// también a admin) y, si están visibles, cada usuario normal necesita
// el permiso puntual (puede_ver_combustible, etc.) para entrar.
function requireSeccionYPermiso(clave, campoPermiso) {
  return async (req, res, next) => {
    const user = req.session && req.session.user;
    const rol  = user && user.rol;
    if (rol === 'desarrollador') return next();
    if (res.locals.secciones && res.locals.secciones[clave] === false) {
      req.flash('error', 'Esta sección no está disponible en este momento.');
      return res.redirect('/dashboard');
    }
    if (rol === 'admin') return next();
    if (user && user[campoPermiso] === true) return next();
    req.flash('error', 'No tienes permisos para acceder a esta sección.');
    res.redirect('/dashboard');
  };
}

// Permite gestionar (ver/crear/editar/eliminar) el panel de
// Estaciones / Placas del Dashboard: admin y desarrollador siempre
// pueden; el resto de roles solo si tienen el permiso explícito
// "puede_gestionar_estaciones_placas" activado por un administrador.
function requireEstacionesPlacas(req, res, next) {
  const user = req.session && req.session.user;
  const rol  = user && user.rol;
  if (rol === 'admin' || rol === 'desarrollador' || (user && user.puede_gestionar_estaciones_placas === true)) {
    return next();
  }
  req.flash('error', 'No tienes permisos para gestionar Estaciones y Placas.');
  res.redirect('/dashboard');
}

// Redirige al dashboard si ya tiene sesión activa (para el login)
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
}

// Expone el rol del usuario a las vistas HBS como variable global
// Usado para mostrar/ocultar botones según el rol
function exposeUserRole(req, res, next) {
  res.locals.isAdmin      = req.session && req.session.user && (req.session.user.rol === 'admin' || req.session.user.rol === 'desarrollador');
  res.locals.isOperador   = req.session && req.session.user && req.session.user.rol === 'operador';
  res.locals.userRol      = req.session && req.session.user ? req.session.user.rol : null;
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireAdminToEdit,
  requireAdminToCreate,
  requireAdminToDelete,
  requireDesarrollador,
  requireSoloDesarrollador,
  requireSeccionVisible,
  requireSeccionYPermiso,
  requireEstacionesPlacas,
  redirectIfAuth,
  exposeUserRole
};
