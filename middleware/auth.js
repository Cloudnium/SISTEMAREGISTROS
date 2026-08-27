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

// Bloquea el acceso directo por URL a una sección que el Desarrollador
// ocultó, para quien no sea admin/desarrollador (el sidebar ya la
// oculta, pero esto evita que alguien entre escribiendo la URL).
function requireSeccionVisible(clave) {
  return async (req, res, next) => {
    const rol = req.session && req.session.user && req.session.user.rol;
    if (rol === 'admin' || rol === 'desarrollador') return next();
    if (res.locals.secciones && res.locals.secciones[clave] === false) {
      req.flash('error', 'Esta sección no está disponible en este momento.');
      return res.redirect('/dashboard');
    }
    next();
  };
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
  requireSeccionVisible,
  redirectIfAuth,
  exposeUserRole
};
