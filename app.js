// =============================================
// app.js — Punto de entrada principal del servidor
// Configura Express, Handlebars, sesiones y rutas
// =============================================

require('dotenv').config();
const express = require('express');
const { engine } = require('express-handlebars');
const cookieSession = require('cookie-session');
const flash = require('connect-flash');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'cloudnium_secret_2026';

// Necesario en Vercel para que Express reconozca correctamente
// que la conexion original del navegador es HTTPS (Vercel hace
// el TLS y reenvia internamente), asi las cookies "secure" funcionan bien
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE HANDLEBARS (motor de vistas)
// ─────────────────────────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    // Helper: compara dos valores para condicionales en HBS
    eq: (a, b) => a === b,
    // Helper: concatena strings
    concat: (...args) => args.slice(0, -1).join(''),
    // Helper: formatea fecha legible
    formatDate: (date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    },
    // Helper: formatea moneda en soles
    formatSoles: (num) => {
      if (!num && num !== 0) return 'S/ 0.00';
      return `S/ ${parseFloat(num).toFixed(2)}`;
    },
    // Helper: devuelve "active" si la ruta coincide con la actual
    isActive: (currentPath, routePath) => currentPath === routePath ? 'active' : '',
    // Helper: serializa un objeto a JSON seguro para usar en atributos
    // HTML (onclick='...'), escapando comillas simples para que no
    // rompa el atributo. Usado en personal/index.hbs para pasar los
    // datos del tripulante al abrir el modal de edición sin AJAX extra.
    json: (obj) => JSON.stringify(obj).replace(/'/g, '&apos;'),
    // Helper: formatea número con cero a la izquierda si es menor a 10
    // Ej: 8 → "08", 24 → "24" — para los indicadores del módulo Personal
    padNum: (n) => String(n || 0).padStart(2, '0')
  }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ─────────────────────────────────────────────
// MIDDLEWARES GLOBALES
// ─────────────────────────────────────────────

// Sirve archivos estáticos desde /public (CSS, JS, imágenes)
app.use(express.static(path.join(__dirname, 'public')));

// Parsea cuerpos JSON y URL-encoded (formularios)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// SESIONES — 100% sin estado en el servidor
//
// IMPORTANTE: cookie-session guarda TODA la sesion
// (firmada y comprimida) dentro de la cookie del
// navegador. No depende de memoria del servidor,
// por eso funciona perfecto en Vercel serverless,
// donde cada peticion puede caer en una instancia
// distinta sin memoria compartida.
//
// Antes se usaba express-session con MemoryStore
// (memoria del servidor) y eso causaba que la sesion
// se "perdiera" al cambiar de pagina en Vercel.
// ─────────────────────────────────────────────
app.use(cookieSession({
  name: 'cloudnium_session',
  keys: [SECRET],
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
  secure: process.env.NODE_ENV === 'production', // HTTPS en produccion
  httpOnly: true,  // no accesible desde JS del navegador
  sameSite: 'lax'  // proteccion CSRF basica
}));

// Flash messages (mensajes de éxito/error entre redirecciones)
app.use(flash());

// Expone datos de sesión y flash a todas las vistas HBS
app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.success     = req.flash('success');
  res.locals.error       = req.flash('error');
  // Expone rol a todas las vistas para mostrar/ocultar botones
  res.locals.isAdmin     = req.session.user && req.session.user.rol === 'admin';
  next();
});

// ─────────────────────────────────────────────
// IMPORTACIÓN DE RUTAS
// ─────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const usuariosRoutes = require('./routes/usuarios');
const combustibleRoutes = require('./routes/combustible');
const personalRoutes = require('./routes/personal');
const inventarioRoutes = require('./routes/inventario');
const chatRoutes = require('./routes/chat');

app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/usuarios', usuariosRoutes);
app.use('/combustible', combustibleRoutes);
app.use('/personal', personalRoutes);
app.use('/inventario', inventarioRoutes);
app.use('/chat', chatRoutes);

// ─────────────────────────────────────────────
// MANEJO DE ERRORES 404
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    layout: 'main',
    title: 'Página no encontrada',
    code: 404,
    message: 'La página que buscas no existe.'
  });
});

// ─────────────────────────────────────────────
// INICIO DEL SERVIDOR
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
