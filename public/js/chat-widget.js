// =============================================
// public/js/chat-widget.js
// Logica del chat flotante tipo Messenger
// Polling cada POLL_MS para sentir "tiempo real"
// Heartbeat cada HEARTBEAT_MS para marcar "en linea"
// =============================================

const ChatWidget = (function () {

  const POLL_MS      = 3000;   // cada cuanto revisa mensajes nuevos / contactos
  const HEARTBEAT_MS = 10000;  // cada cuanto avisa "sigo activo"

  let abierto          = false;
  let conversacionActiva = null; // { id, nombre, rol }
  let pollTimer         = null;
  let heartbeatTimer    = null;
  let ultimaFirmaMsgs  = '';

  // ─── Helpers de fetch ───
  // Si la sesion alguna vez expira, el servidor redirige a /login
  // en vez de devolver JSON. Antes esto causaba fallos silenciosos
  // que se sentian como "el chat no carga". Ahora se detecta y
  // se recarga la pagina para volver al login correctamente.
  function manejarRespuesta(r) {
    if (r.redirected && r.url.indexOf('/login') !== -1) {
      window.location.href = '/login';
      return Promise.reject(new Error('Sesion expirada'));
    }
    return r.json();
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(manejarRespuesta);
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(manejarRespuesta);
  }

  // ─── Iniciales para avatar sin foto ───
  function iniciales(nombre) {
    if (!nombre) return '?';
    const partes = nombre.trim().split(' ');
    return partes.length > 1
      ? (partes[0][0] + partes[1][0]).toUpperCase()
      : partes[0].substring(0, 2).toUpperCase();
  }

  // ─── Formato de hora corta ───
  function horaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Abre / cierra el panel ───
  function toggle() {
    abierto = !abierto;
    document.getElementById('chatwPanel').style.display = abierto ? 'flex' : 'none';
    document.getElementById('chatwBar').classList.toggle('chatw-bar-active', abierto);
    if (abierto) {
      cargarContactos();
    }
  }

  // ─── Vuelve de la conversacion a la lista ───
  function volverALista() {
    conversacionActiva = null;
    document.getElementById('chatwListaView').style.display = '';
    document.getElementById('chatwConvView').style.display  = 'none';
    document.getElementById('chatwBackBtn').style.display   = 'none';
    cargarContactos();
  }

  // ─── Abre una conversacion con un contacto ───
  function abrirConversacion(contacto) {
    conversacionActiva = contacto;
    ultimaFirmaMsgs = ''; // reinicia para forzar el primer render de esta conversacion
    document.getElementById('chatwListaView').style.display = 'none';
    document.getElementById('chatwConvView').style.display  = 'flex';
    document.getElementById('chatwBackBtn').style.display   = 'flex';

    const header = document.getElementById('chatwConvHeader');
    header.innerHTML =
      '<div class="chatw-avatar">' +
        '<span>' + iniciales(contacto.nombre) + '</span>' +
        (contacto.enLinea ? '<span class="chatw-dot"></span>' : '') +
      '</div>' +
      '<div class="chatw-conv-info">' +
        '<span class="chatw-conv-name">' + escapeHtml(contacto.nombre) + '</span>' +
        '<span class="chatw-conv-status">' + (contacto.enLinea ? 'En linea' : 'Desconectado') + '</span>' +
      '</div>';

    cargarMensajes();
    document.getElementById('chatwInput').focus();
  }

  // ─── Escape basico para evitar inyeccion HTML ───
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ─── Carga lista de contactos con estado en linea y no leidos ───
  function cargarContactos() {
    getJSON('/chat/contactos').then(function (data) {
      const cont = document.getElementById('chatwContactos');
      const contactos = data.contactos || [];

      actualizarBadgeGlobal(data.totalNoLeidos || 0);

      if (contactos.length === 0) {
        cont.innerHTML = '<div class="chatw-empty"><i data-lucide="users"></i><span>No hay otros usuarios aun.</span></div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      cont.innerHTML = contactos.map(function (c) {
        const preview = c.ultimoMensaje
          ? escapeHtml(c.ultimoMensaje.substring(0, 40)) + (c.ultimoMensaje.length > 40 ? '...' : '')
          : 'Sin mensajes aun';
        return (
          '<div class="chatw-contacto" data-id="' + c.id + '" onclick="ChatWidget.seleccionarContacto(\'' + c.id + '\')">' +
            '<div class="chatw-avatar">' +
              '<span>' + iniciales(c.nombre) + '</span>' +
              (c.enLinea ? '<span class="chatw-dot"></span>' : '') +
            '</div>' +
            '<div class="chatw-contacto-info">' +
              '<div class="chatw-contacto-top">' +
                '<span class="chatw-contacto-name">' + escapeHtml(c.nombre) + '</span>' +
                '<span class="chatw-contacto-time">' + horaCorta(c.ultimaFecha) + '</span>' +
              '</div>' +
              '<div class="chatw-contacto-bottom">' +
                '<span class="chatw-contacto-preview' + (c.noLeidos > 0 ? ' chatw-unread' : '') + '">' + preview + '</span>' +
                (c.noLeidos > 0 ? '<span class="chatw-badge-mini">' + c.noLeidos + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      // Guarda referencia para abrir conversacion al click
      window._chatwContactosCache = contactos;
      if (window.lucide) lucide.createIcons();
    }).catch(function () { /* silencioso, reintenta en el siguiente poll */ });
  }

  function seleccionarContacto(id) {
    const contacto = (window._chatwContactosCache || []).find(c => c.id === id);
    if (contacto) abrirConversacion(contacto);
  }

  // ─── Carga mensajes de la conversacion activa ───
  // Compara un "firma" de todos los mensajes (id + leido) para detectar
  // cambios reales, incluyendo cuando solo cambia el estado "visto"
  // (antes solo comparaba la cantidad y por eso los checks no se
  // actualizaban en vivo cuando no llegaban mensajes nuevos)
  function cargarMensajes(silencioso) {
    if (!conversacionActiva) return;
    getJSON('/chat/conversacion/' + conversacionActiva.id).then(function (data) {
      const mensajes = data.mensajes || [];
      const firma = mensajes.map(function (m) { return m.id + ':' + (m.leido ? 1 : 0); }).join('|');

      if (!silencioso || firma !== ultimaFirmaMsgs) {
        renderMensajes(mensajes);
        ultimaFirmaMsgs = firma;
      }
    }).catch(function () {});
  }

  function renderMensajes(mensajes) {
    const cont = document.getElementById('chatwMensajes');
    const miId = window.CHATW_USER_ID;
    const estabaAbajo = cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 30;

    cont.innerHTML = mensajes.map(function (m) {
      const esMio = m.remitente_id === miId;
      // Solo mis propios mensajes muestran el estado de "visto"
      const estado = esMio ? renderChecks(m.leido) : '';
      return (
        '<div class="chatw-msg ' + (esMio ? 'chatw-msg-mio' : 'chatw-msg-otro') + '">' +
          '<span class="chatw-msg-bubble">' + escapeHtml(m.contenido) + '</span>' +
          '<span class="chatw-msg-time">' + horaCorta(m.creado_en) + estado + '</span>' +
        '</div>'
      );
    }).join('');

    if (estabaAbajo || mensajes.length <= 1) {
      cont.scrollTop = cont.scrollHeight;
    }
  }

  // ─── Checks estilo WhatsApp: gris = enviado, azul = visto ───
  function renderChecks(leido) {
    const claseExtra = leido ? 'chatw-check-leido' : '';
    // Doble check SVG inline (sin depender de Lucide para que siempre se vea)
    return (
      '<svg class="chatw-check ' + claseExtra + '" viewBox="0 0 16 11" width="14" height="10">' +
        '<path d="M1 5.5L4.5 9L11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M5.5 5.5L9 9L15.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  // ─── Envia un mensaje nuevo ───
  function enviarMensaje(e) {
    e.preventDefault();
    if (!conversacionActiva) return false;

    const input = document.getElementById('chatwInput');
    const texto = input.value.trim();
    if (!texto) return false;

    input.value = '';
    input.focus();

    postJSON('/chat/enviar', {
      destinatario_id: conversacionActiva.id,
      contenido: texto
    }).then(function () {
      cargarMensajes();
    }).catch(function () {
      alert('No se pudo enviar el mensaje. Intenta de nuevo.');
    });

    return false;
  }

  // ─── Actualiza el contador en la barra colapsada ───
  function actualizarBadgeGlobal(total) {
    const badgeBar = document.getElementById('chatwBadgeBar');
    if (total > 0) {
      badgeBar.textContent = total > 9 ? '9+' : total;
      badgeBar.style.display = 'inline-flex';
    } else {
      badgeBar.style.display = 'none';
    }
  }

  // ─── Ciclo de polling: refresca contactos y/o conversacion abierta ───
  function poll() {
    if (!document.getElementById('chatw')) return;

    // Siempre refresca el contador global aunque el panel este cerrado
    getJSON('/chat/contactos').then(function (data) {
      actualizarBadgeGlobal(data.totalNoLeidos || 0);
      window._chatwContactosCache = data.contactos || [];
      // Si el panel esta abierto y estamos viendo la lista, refresca la lista visualmente
      if (abierto && !conversacionActiva) {
        const listaVisible = document.getElementById('chatwListaView').style.display !== 'none';
        if (listaVisible) cargarContactos();
      }
    }).catch(function () {});

    // Si hay conversacion abierta, refresca sus mensajes en silencio
    if (abierto && conversacionActiva) {
      cargarMensajes(true);
    }
  }

  // ─── Heartbeat: avisa que el usuario sigue activo ───
  function heartbeat() {
    postJSON('/chat/heartbeat', {}).catch(function () {});
  }

  // ─── Inicializa todo cuando el DOM esta listo ───
  function init(userId) {
    window.CHATW_USER_ID = userId;
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    pollTimer = setInterval(poll, POLL_MS);
    poll(); // primera carga inmediata del badge
  }

  return {
    init: init,
    toggle: toggle,
    volverALista: volverALista,
    seleccionarContacto: seleccionarContacto,
    enviarMensaje: enviarMensaje
  };
})();
