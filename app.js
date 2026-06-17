// =============================================
// app.js — Punto de entrada principal del servidor
// Configura Express, Handlebars, sesiones y rutas
// =============================================

require('dotenv').config();
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'cloudnium_secret_2026';

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
    isActive: (currentPath, routePath) => currentPath === routePath ? 'active' : ''
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
app.use(cookieParser(SECRET));


// Configura sesiones de usuario
app.use(session({
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
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
