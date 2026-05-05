# 📁 Carpeta de Imágenes — Instrucciones

Este directorio contiene todas las imágenes del sistema.
Reemplaza los archivos con tus propias imágenes manteniendo los mismos nombres,
o actualiza las rutas en los archivos indicados.

---

## 📂 logos/
Logos de la empresa.

| Archivo              | Usado en                          | Descripción                         |
|---------------------|-----------------------------------|-------------------------------------|
| `logo.png`          | `views/partials/sidebar.hbs`     | Logo en la barra lateral (sidebar)  |
| `logo-white.png`    | `views/auth/login.hbs`           | Logo en la pantalla de login        |
| `favicon.ico`       | `views/layouts/main.hbs` (head)  | Ícono del navegador                 |

**Cómo activar logo de imagen en sidebar:**
Abre `views/partials/sidebar.hbs` y reemplaza el bloque `.sidebar-logo-text` con:
```html
<img src="/images/logos/logo.png" alt="Logo empresa" class="sidebar-logo-img" />
```

---

## 📂 icons/
Íconos personalizados (opcional).
Por defecto el sistema usa Lucide Icons (SVG inline).

Para cambiar un ícono, ve al archivo `.hbs` correspondiente
y modifica el atributo `data-lucide="nombre-del-icono"`.
Todos los íconos disponibles: https://lucide.dev/icons/

---

## 📂 avatars/
Avatares de usuarios.

Los usuarios pueden tener un avatar personalizado.
Coloca imágenes aquí y guarda la ruta en el campo `avatar` de la tabla `usuarios`.
Formato recomendado: `.jpg` o `.png`, tamaño 200x200px.

---

## 📐 Tamaños recomendados

| Imagen         | Tamaño sugerido | Formato  |
|---------------|-----------------|----------|
| Logo sidebar  | 140x36px        | PNG/SVG  |
| Logo login    | 200x52px        | PNG/SVG  |
| Favicon       | 32x32px         | ICO/PNG  |
| Avatar usuario| 200x200px       | JPG/PNG  |
