# 🗂️ Estructura del Proyecto — Cloudnium

```
cloudnium/
│
├── app.js                          ← Punto de entrada principal del servidor
├── package.json                    ← Dependencias del proyecto
├── .env.example                    ← Plantilla de variables de entorno
├── .env                            ← (crear tú) Variables secretas reales
│
├── config/
│   └── supabase.js                 ← Configuración del cliente Supabase
│
├── middleware/
│   └── auth.js                     ← Protección de rutas (requireAuth, requireAdmin)
│
├── routes/                         ← Controladores de cada sección
│   ├── auth.js                     ← Login, logout
│   ├── dashboard.js                ← Panel principal
│   ├── usuarios.js                 ← CRUD de usuarios del sistema
│   ├── combustible.js              ← Módulo combustible (pendiente)
│   ├── personal.js                 ← Módulo personal (pendiente)
│   └── inventario.js               ← Módulo inventario (pendiente)
│
├── views/                          ← Plantillas Handlebars (.hbs)
│   │
│   ├── layouts/
│   │   ├── main.hbs                ← Layout general (con sidebar)
│   │   └── auth.hbs                ← Layout login (sin sidebar)
│   │
│   ├── partials/
│   │   ├── sidebar.hbs             ← Barra lateral de navegación
│   │   ├── topbar.hbs              ← Cabecera superior
│   │   └── flash.hbs               ← Mensajes de éxito/error
│   │
│   ├── auth/
│   │   └── login.hbs               ← Pantalla de inicio de sesión
│   │
│   ├── dashboard/
│   │   └── index.hbs               ← Panel principal (vacío por ahora)
│   │
│   ├── usuarios/
│   │   ├── index.hbs               ← Lista de usuarios
│   │   └── form.hbs                ← Formulario crear/editar usuario
│   │
│   ├── combustible/
│   │   └── index.hbs               ← Módulo combustible
│   │
│   ├── personal/
│   │   └── index.hbs               ← Módulo personal
│   │
│   └── inventario/
│       └── index.hbs               ← Módulo inventario
│
└── public/                         ← Archivos estáticos (servidos directamente)
    │
    ├── css/
    │   ├── variables.css           ← Tokens de diseño: colores, fuentes, espaciados
    │   ├── base.css                ← Reset y estilos globales
    │   ├── layout.css              ← Sidebar, topbar, estructura
    │   ├── components.css          ← Botones, cards, tablas, badges, formularios
    │   ├── pages.css               ← Estilos específicos por página
    │   └── auth.css                ← Estilos de la pantalla de login
    │
    ├── js/
    │   └── main.js                 ← JS global: sidebar móvil, flash auto-dismiss
    │
    └── images/
        ├── INSTRUCCIONES.md        ← Guía para reemplazar imágenes
        ├── logos/                  ← Logo de la empresa (logo.png, logo-white.png)
        ├── icons/                  ← Íconos personalizados opcionales
        └── avatars/                ← Avatares de usuarios
```

---

## 🔁 Flujo de una petición HTTP

```
Usuario → Express → Middleware auth → Route handler → Supabase → HBS template → HTML
```

1. El usuario hace una petición (ej: GET /dashboard)
2. Express la recibe en `app.js`
3. El middleware `requireAuth` verifica la sesión
4. Si está autenticado, el route handler en `routes/dashboard.js` se ejecuta
5. Si necesita datos, consulta Supabase
6. Renderiza la vista `views/dashboard/index.hbs` con el layout `main.hbs`
7. Devuelve HTML completo al navegador

---

## 🔐 Sistema de roles

| Rol          | Acceso                                        |
|-------------|-----------------------------------------------|
| `admin`     | Todo el sistema + gestión de usuarios         |
| `operador`  | Módulos: Combustible, Personal, Inventario    |
| `visualizador` | Solo lectura en los módulos               |

---

## 📦 Dependencias principales

| Paquete               | Función                                      |
|----------------------|----------------------------------------------|
| express              | Servidor web y enrutamiento                  |
| express-handlebars   | Motor de plantillas HBS                      |
| express-session      | Manejo de sesiones de usuario                |
| bcryptjs             | Hash seguro de contraseñas                   |
| @supabase/supabase-js| Cliente de base de datos Supabase            |
| connect-flash        | Mensajes entre redirecciones                 |
| dotenv               | Variables de entorno desde .env              |

---

## 🚀 Cómo levantar el proyecto

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo .env con tus credenciales
cp .env.example .env
# Edita .env con tu SUPABASE_URL, claves y SESSION_SECRET

# 3. Ejecutar el SQL de base de datos en Supabase
# (ver archivo: SUPABASE_SETUP.sql)

# 4. Iniciar el servidor
npm run dev      # Desarrollo (con nodemon)
npm start        # Producción
```
