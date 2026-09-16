// =============================================
// public/js/chat-widget.js
// Chat completo: 1-a-1 + grupos + emojis
// Polling cada POLL_MS para "tiempo real"
// =============================================
const ChatWidget = (function () {

  const POLL_MS      = 3000;
  const HEARTBEAT_MS = 10000;

  // ─── SONIDO DE NOTIFICACION ───
  // Para cambiar el sonido: reemplaza el archivo en public/sounds/
  // manteniendo el mismo nombre, o cambia esta ruta por la tuya.
  // Ver public/sounds/INSTRUCCIONES.md para mas detalles.
  const SONIDO_NOTIFICACION = '/sounds/notificacion.wav';
  const VOLUMEN_NOTIFICACION = 0.5; // 0.0 a 1.0
  let audioNotificacion = null; // se crea una sola vez, se reutiliza

  let abierto            = false;
  let conversacionActiva = null; // { id, nombre, tipo: 'usuario'|'grupo', ... }
  let ultimaFirma        = '';
  let grupoInfoVisible   = false;
  let grupoActualCreador = null;
  let idsMensajesConocidos = new Set(); // ids ya vistos en la conversacion abierta
  let totalOtrosAnterior   = null;      // no leidos de OTRAS conversaciones (no la abierta)

  // ─── Reproduce el sonido de notificacion ───
  // Falla en silencio si el navegador bloquea el autoplay
  // (los navegadores requieren al menos una interaccion del
  // usuario con la pagina antes de permitir sonidos automaticos)
  function reproducirSonido() {
    try {
      if (!audioNotificacion) {
        audioNotificacion = new Audio(SONIDO_NOTIFICACION);
        audioNotificacion.volume = VOLUMEN_NOTIFICACION;
      }
      audioNotificacion.currentTime = 0;
      audioNotificacion.play().catch(function () { /* bloqueado por el navegador, ignorar */ });
    } catch (e) { /* ignorar */ }
  }

  // ══════════════════════════════════════
  // FETCH HELPERS
  // ══════════════════════════════════════
  function manejarResp(r) {
    if (r.redirected && r.url.includes('/login')) {
      window.location.href = '/login';
      return Promise.reject('sesion-expirada');
    }
    return r.json();
  }
  function get(url)        { return fetch(url, { credentials: 'same-origin' }).then(manejarResp); }
  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(manejarResp);
  }
  function del(url) {
    return fetch(url, { method: 'DELETE', credentials: 'same-origin' }).then(manejarResp);
  }

  // ══════════════════════════════════════
  // UTILIDADES
  // ══════════════════════════════════════
  function iniciales(n) {
    if (!n) return '?';
    const p = n.trim().split(' ');
    return p.length > 1 ? (p[0][0]+p[1][0]).toUpperCase() : n.substring(0,2).toUpperCase();
  }
  function hora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ══════════════════════════════════════
  // TOGGLE PANEL
  // ══════════════════════════════════════
  function toggle() {
    abierto = !abierto;
    document.getElementById('chatwPanel').style.display = abierto ? 'flex' : 'none';
    document.getElementById('chatwBar').classList.toggle('chatw-bar-active', abierto);
    if (abierto) cargarContactos();
  }

  // ══════════════════════════════════════
  // LISTA DE CONTACTOS Y GRUPOS
  // ══════════════════════════════════════
  function cargarContactos() {
    get('/chat/contactos').then(function(data) {
      actualizarBadge(data.totalNoLeidos || 0);
      window._contactosCache = data.contactos || [];
      const lista = data.contactos || [];
      const cont  = document.getElementById('chatwContactos');

      if (lista.length === 0) {
        cont.innerHTML = '<div class="chatw-empty"><i data-lucide="users"></i><span>No hay contactos aún.</span></div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      cont.innerHTML = lista.map(function(c) {
        const esGrupo   = c.tipo === 'grupo';
        const iconExtra = esGrupo
          ? '<span class="chatw-tipo-badge">Grupo</span>'
          : (c.enLinea ? '<span class="chatw-dot"></span>' : '');

        const escribiendoAhora = esGrupo
          ? (c.escribiendoNombres && c.escribiendoNombres.length > 0)
          : !!c.escribiendo;

        let preview;
        if (escribiendoAhora) {
          const texto = esGrupo
            ? esc(c.escribiendoNombres.join(', ')) + (c.escribiendoNombres.length > 1 ? ' están escribiendo…' : ' está escribiendo…')
            : 'Escribiendo…';
          preview = '<em class="chatw-typing-preview">' + texto + '</em>';
        } else if (c.ultimoMensaje) {
          const leido = esGrupo ? c.ultimoLeidoPorTodos : c.ultimoLeido;
          const checkPreview = c.ultimoEsMio ? renderChecks(leido) : '';
          preview = checkPreview + esc(c.ultimoMensaje.substring(0,38)) + (c.ultimoMensaje.length > 38 ? '…' : '');
        } else {
          preview = '<em>Sin mensajes aún</em>';
        }

        return (
          '<div class="chatw-contacto" onclick="ChatWidget.seleccionar(\'' + c.id + '\')">' +
            '<div class="chatw-avatar chatw-avatar-' + (esGrupo ? 'grupo' : 'user') + '">' +
              '<span>' + iniciales(c.nombre) + '</span>' +
              iconExtra +
            '</div>' +
            '<div class="chatw-contacto-info">' +
              '<div class="chatw-contacto-top">' +
                '<span class="chatw-contacto-name">' + esc(c.nombre) + '</span>' +
                '<span class="chatw-contacto-time">' + hora(c.ultimaFecha) + '</span>' +
              '</div>' +
              '<div class="chatw-contacto-bottom">' +
                '<span class="chatw-contacto-preview' + (c.noLeidos > 0 ? ' chatw-unread' : '') + (escribiendoAhora ? ' chatw-typing-active' : '') + '">' + preview + '</span>' +
                (c.noLeidos > 0 ? '<span class="chatw-badge-mini">'+c.noLeidos+'</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      if (window.lucide) lucide.createIcons();
    }).catch(function(){});
  }

  function seleccionar(id) {
    const c = (window._contactosCache || []).find(x => x.id === id);
    if (c) abrirConversacion(c);
  }

  // ══════════════════════════════════════
  // ABRIR CONVERSACIÓN (usuario o grupo)
  // ══════════════════════════════════════
  function abrirConversacion(c) {
    conversacionActiva = c;
    ultimaFirma        = '';
    grupoInfoVisible   = false;
    idsMensajesConocidos = new Set(); // nueva conversacion, reinicia el seguimiento

    document.getElementById('chatwListaView').style.display  = 'none';
    document.getElementById('chatwConvView').style.display   = 'flex';
    document.getElementById('chatwBackBtn').style.display    = 'flex';
    document.getElementById('chatwNuevoGrupoBtn').style.display = 'none';
    document.getElementById('chatwGrupoInfo').style.display  = 'none';

    const esGrupo = c.tipo === 'grupo';
    document.getElementById('chatwGrupoInfoBtn').style.display = esGrupo ? 'flex' : 'none';
    document.getElementById('chatwHeaderLabel').textContent   = c.nombre;

    const header = document.getElementById('chatwConvHeader');
    header.innerHTML =
      '<div class="chatw-avatar chatw-avatar-sm chatw-avatar-' + (esGrupo ? 'grupo' : 'user') + '">' +
        '<span>' + iniciales(c.nombre) + '</span>' +
        (!esGrupo && c.enLinea ? '<span class="chatw-dot"></span>' : '') +
      '</div>' +
      '<div class="chatw-conv-info">' +
        '<span class="chatw-conv-name">' + esc(c.nombre) + '</span>' +
        '<span class="chatw-conv-status" id="chatwConvStatusText">' +
          (esGrupo ? 'Grupo de chat' : (c.enLinea ? 'En línea' : 'Desconectado')) +
        '</span>' +
      '</div>';

    if (esGrupo) cargarInfoGrupo(c.id);
    cargarMensajes();
    document.getElementById('chatwInput').focus();
  }

  function volverALista() {
    conversacionActiva = null;
    grupoInfoVisible   = false;
    document.getElementById('chatwListaView').style.display  = '';
    document.getElementById('chatwConvView').style.display   = 'none';
    document.getElementById('chatwBackBtn').style.display    = 'none';
    document.getElementById('chatwGrupoInfoBtn').style.display = 'none';
    document.getElementById('chatwNuevoGrupoBtn').style.display = 'flex';
    document.getElementById('chatwHeaderLabel').textContent  = 'Chat';
    cerrarEmojis();
    cargarContactos();
  }

  // ══════════════════════════════════════
  // INFO DEL GRUPO
  // ══════════════════════════════════════
  function cargarInfoGrupo(grupoId) {
    get('/chat/grupos/' + grupoId).then(function(data) {
      grupoActualCreador = data.grupo ? data.grupo.creado_por : null;
      const miId = window.CHATW_USER_ID;
      const miembros = data.miembros || [];
      document.getElementById('chatwGrupoMiembros').innerHTML =
        miembros.map(function(m) {
          const u = m.usuarios;
          if (!u) return '';
          return (
            '<div class="chatw-miembro-item">' +
              '<div class="chatw-avatar chatw-avatar-xs">' +
                '<span>' + iniciales(u.nombre) + '</span>' +
              '</div>' +
              '<span>' + esc(u.nombre) + '</span>' +
              (grupoActualCreador === u.id ? '<span class="chatw-admin-badge">Admin</span>' : '') +
            '</div>'
          );
        }).join('');
      // Solo el creador puede eliminar
      const elimBtn = document.getElementById('chatwEliminarGrupoBtn');
      if (elimBtn) elimBtn.style.display = grupoActualCreador === miId ? 'flex' : 'none';
      if (window.lucide) lucide.createIcons();
    }).catch(function(){});
  }

  function toggleInfoGrupo() {
    grupoInfoVisible = !grupoInfoVisible;
    document.getElementById('chatwGrupoInfo').style.display = grupoInfoVisible ? 'block' : 'none';
  }

  // ══════════════════════════════════════
  // CARGAR Y RENDERIZAR MENSAJES
  // ══════════════════════════════════════
  function cargarMensajes(silencioso) {
    if (!conversacionActiva) return;
    const esGrupo = conversacionActiva.tipo === 'grupo';
    const url = esGrupo
      ? '/chat/grupos/' + conversacionActiva.id + '/mensajes'
      : '/chat/conversacion/' + conversacionActiva.id;

    get(url).then(function(data) {
      const msgs  = data.mensajes || [];
      const firma = msgs.map(function(m) {
        return m.id + ':' + (m.leido ? 1 : 0);
      }).join('|');

      if (!silencioso || firma !== ultimaFirma) {
        // Detecta si llego un mensaje nuevo de OTRA persona mientras
        // estoy viendo esta conversacion (en polls silenciosos en
        // segundo plano) para sonar la notificacion
        if (silencioso) {
          const miId = window.CHATW_USER_ID;
          const hayNuevoDeOtro = msgs.some(function (m) {
            return m.remitente_id !== miId && !idsMensajesConocidos.has(m.id);
          });
          if (hayNuevoDeOtro) reproducirSonido();
        }
        idsMensajesConocidos = new Set(msgs.map(function (m) { return m.id; }));
        renderMensajes(msgs, esGrupo);
        ultimaFirma = firma;
      }
    }).catch(function(){});
  }

  function renderMensajes(msgs, esGrupo) {
    const cont = document.getElementById('chatwMensajes');
    const miId = window.CHATW_USER_ID;
    const abajo = cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 40;

    const tipoReaccion = esGrupo ? 'grupo' : 'individual';

    cont.innerHTML = msgs.map(function(m) {
      const esMio = m.remitente_id === miId;
      const nombreRemitente = esGrupo && !esMio && m.usuarios
        ? '<span class="chatw-msg-remitente">' + esc(m.usuarios.nombre) + '</span>'
        : '';
      const checks = esMio ? renderChecks(esGrupo ? m.leidoPorTodos : m.leido) : '';

      const trigger =
        '<button type="button" class="chatw-react-trigger" title="Reaccionar" ' +
          'onclick="ChatWidget.abrirPickerReaccion(event,\'' + m.id + '\',\'' + tipoReaccion + '\')">' +
          '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6">' +
            '<circle cx="10" cy="10" r="8"/><path d="M6.5 11.5s1 2 3.5 2 3.5-2 3.5-2" stroke-linecap="round"/>' +
            '<circle cx="7" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="7.5" r=".9" fill="currentColor" stroke="none"/>' +
          '</svg>' +
        '</button>';

      const pills = (m.reacciones || []).length
        ? '<div class="chatw-reactions">' + m.reacciones.map(function(r) {
            return '<button type="button" class="chatw-reaction-pill' + (r.mia ? ' chatw-reaction-pill-mia' : '') + '" ' +
              'title="' + esc(r.nombres.join(', ')) + '" ' +
              'onclick="ChatWidget.reaccionar(\'' + m.id + '\',\'' + tipoReaccion + '\',\'' + r.emoji + '\')">' +
              r.emoji + (r.count > 1 ? ' <span>' + r.count + '</span>' : '') +
            '</button>';
          }).join('') + '</div>'
        : '';

      return (
        '<div class="chatw-msg ' + (esMio ? 'chatw-msg-mio' : 'chatw-msg-otro') + '">' +
          nombreRemitente +
          '<div class="chatw-msg-row">' +
            '<span class="chatw-msg-bubble">' + esc(m.contenido) + '</span>' +
            trigger +
          '</div>' +
          '<span class="chatw-msg-time">' + hora(m.creado_en) + checks + '</span>' +
          pills +
        '</div>'
      );
    }).join('');

    if (abajo || msgs.length <= 1) cont.scrollTop = cont.scrollHeight;
  }

  function renderChecks(leido) {
    const cls = leido ? 'chatw-check-leido' : '';
    return (
      '<svg class="chatw-check ' + cls + '" viewBox="0 0 16 11" width="14" height="10">' +
        '<path d="M1 5.5L4.5 9L11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M5.5 5.5L9 9L15.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  // ══════════════════════════════════════
  // ENVIAR MENSAJE
  // ══════════════════════════════════════
  function enviarMensaje(e) {
    e.preventDefault();
    if (!conversacionActiva) return false;
    const input   = document.getElementById('chatwInput');
    const texto   = input.value.trim();
    if (!texto) return false;
    input.value = '';
    cerrarEmojis();

    const esGrupo = conversacionActiva.tipo === 'grupo';
    const url     = esGrupo
      ? '/chat/grupos/' + conversacionActiva.id + '/enviar'
      : '/chat/enviar';
    const body    = esGrupo
      ? { contenido: texto }
      : { destinatario_id: conversacionActiva.id, contenido: texto };

    post(url, body).then(function() { cargarMensajes(); })
                   .catch(function() { alert('Error al enviar. Intenta de nuevo.'); });
    return false;
  }

  // ══════════════════════════════════════
  // EMOJIS
  // ══════════════════════════════════════
  // Lista de emojis organizados por categoría
  const EMOJIS = [
    // Caritas
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
    '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
    '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
    '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
    '😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵',
    '🥶','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟',
    '🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨',
    '😰','😥','😢','😭','😱','😖','😣','😞','😓','😩',
    '😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️',
    // Gestos y manos
    '👍','👎','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈',
    '👉','👆','👇','☝️','👋','🤚','🖐️','✋','🖖','💪',
    '🦵','🦶','👏','🙌','🤲','🤝','🙏',
    // Corazones
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
    '❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️',
    // Objetos y símbolos
    '🔥','✨','⭐','🌟','💥','💢','💬','💭','💤','🎉',
    '🎊','🎈','🎁','🏆','🥇','🚀','⚡','☀️','🌙','⚽',
    '🍕','🍔','🍟','🍦','☕','🎵','🎶','💻','📱','📷'
  ];

  // 'insertar' → el panel completo de emojis escribe en el input (uso normal).
  // 'reaccionar' → el panel completo se abrió desde el "+" del picker rápido
  // de reacciones; elegir un emoji ahí reacciona al mensaje en vez de escribir.
  let modoEmojiPanel = 'insertar';

  function construirPanelEmojis() {
    const panel = document.getElementById('chatwEmojiPanel');
    if (!panel.dataset.built) {
      panel.innerHTML = EMOJIS.map(function(em) {
        return '<button type="button" class="chatw-emoji-item" onclick="ChatWidget.clicEmojiPanel(\'' + em + '\')">' + em + '</button>';
      }).join('');
      panel.dataset.built = '1';
    }
  }

  function toggleEmojis(e) {
    e.stopPropagation();
    const panel = document.getElementById('chatwEmojiPanel');
    const visible = panel.style.display !== 'none';
    if (visible) { cerrarEmojis(); return; }
    modoEmojiPanel = 'insertar';
    construirPanelEmojis();
    panel.style.display = 'grid';
  }

  function cerrarEmojis() {
    document.getElementById('chatwEmojiPanel').style.display = 'none';
  }

  function clicEmojiPanel(emoji) {
    if (modoEmojiPanel === 'reaccionar') {
      reaccionarRapido(emoji);
      cerrarEmojis();
    } else {
      insertarEmoji(emoji);
    }
  }

  function insertarEmoji(emoji) {
    const input = document.getElementById('chatwInput');
    const pos   = input.selectionStart;
    const val   = input.value;
    input.value = val.substring(0, pos) + emoji + val.substring(pos);
    input.selectionStart = input.selectionEnd = pos + emoji.length;
    input.focus();
    // No cierra el panel para poder insertar varios emojis seguidos
  }

  // ══════════════════════════════════════
  // REACCIONES A MENSAJES (estilo WhatsApp)
  // ══════════════════════════════════════
  let reaccionObjetivo = null; // { mensajeId, tipo }

  function abrirPickerReaccion(e, mensajeId, tipo) {
    e.stopPropagation();
    cerrarEmojis();
    reaccionObjetivo = { mensajeId: mensajeId, tipo: tipo };

    const picker = document.getElementById('chatwReactionPicker');
    const rect   = e.currentTarget.getBoundingClientRect();
    const anchoPicker = 252;

    let left = rect.left - 100;
    if (left < 8) left = 8;
    if (left + anchoPicker > window.innerWidth) left = window.innerWidth - anchoPicker - 8;

    let top = rect.top - 46;
    if (top < 8) top = rect.bottom + 6; // si no cabe arriba, se muestra abajo del botón

    picker.style.left = left + 'px';
    picker.style.top  = top + 'px';
    picker.style.display = 'flex';
  }

  function cerrarPickerReaccion() {
    const picker = document.getElementById('chatwReactionPicker');
    if (picker) picker.style.display = 'none';
    reaccionObjetivo = null;
  }

  function masEmojisReaccion(e) {
    e.stopPropagation();
    if (!reaccionObjetivo) return;
    document.getElementById('chatwReactionPicker').style.display = 'none';
    modoEmojiPanel = 'reaccionar';
    construirPanelEmojis();
    document.getElementById('chatwEmojiPanel').style.display = 'grid';
  }

  function reaccionarRapido(emoji) {
    if (!reaccionObjetivo) return;
    enviarReaccion(reaccionObjetivo.mensajeId, reaccionObjetivo.tipo, emoji);
    cerrarPickerReaccion();
  }

  // Reaccionar tocando directamente una "pastilla" de reacción ya puesta
  function reaccionar(mensajeId, tipo, emoji) {
    enviarReaccion(mensajeId, tipo, emoji);
  }

  function enviarReaccion(mensajeId, tipo, emoji) {
    post('/chat/reaccionar', { mensaje_id: mensajeId, mensaje_tipo: tipo, emoji: emoji })
      .then(function () { cargarMensajes(true); })
      .catch(function () {});
  }

  // ══════════════════════════════════════
  // GRUPOS — MODAL CREAR
  // ══════════════════════════════════════
  function abrirModalGrupo() {
    document.getElementById('chatwModalGrupo').style.display = 'flex';
    document.getElementById('grupoNombre').value = '';
    // Carga usuarios disponibles
    get('/chat/usuarios-disponibles').then(function(data) {
      const lista = data.usuarios || [];
      const cont  = document.getElementById('grupoMiembrosLista');
      if (lista.length === 0) {
        cont.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted)">No hay otros usuarios.</p>';
        return;
      }
      cont.innerHTML = lista.map(function(u) {
        return (
          '<label class="chatw-miembro-check">' +
            '<input type="checkbox" value="' + u.id + '" class="chatw-chk-miembro" />' +
            '<div class="chatw-avatar chatw-avatar-xs"><span>' + iniciales(u.nombre) + '</span></div>' +
            '<span>' + esc(u.nombre) + '</span>' +
          '</label>'
        );
      }).join('');
    }).catch(function(){});
  }

  function cerrarModalGrupo(e) {
    if (e && e.target !== document.getElementById('chatwModalGrupo')) return;
    document.getElementById('chatwModalGrupo').style.display = 'none';
  }

  function crearGrupo() {
    const nombre   = document.getElementById('grupoNombre').value.trim();
    const checks   = document.querySelectorAll('.chatw-chk-miembro:checked');
    const miembros = Array.from(checks).map(function(c) { return c.value; });

    if (!nombre) { alert('Escribe un nombre para el grupo.'); return; }
    if (miembros.length === 0) { alert('Selecciona al menos un miembro.'); return; }

    post('/chat/grupos/crear', { nombre, miembros }).then(function(data) {
      document.getElementById('chatwModalGrupo').style.display = 'none';
      cargarContactos();
      // Abre el grupo recién creado
      if (data.grupo) {
        abrirConversacion({
          id: data.grupo.id,
          nombre: data.grupo.nombre,
          tipo: 'grupo',
          enLinea: false
        });
      }
    }).catch(function() { alert('Error al crear el grupo. Intenta de nuevo.'); });
  }

  function eliminarGrupo() {
    if (!conversacionActiva || conversacionActiva.tipo !== 'grupo') return;
    if (!confirm('¿Eliminar el grupo "' + conversacionActiva.nombre + '"? Esta acción no se puede deshacer.')) return;
    del('/chat/grupos/' + conversacionActiva.id).then(function() {
      volverALista();
    }).catch(function() { alert('No se pudo eliminar el grupo.'); });
  }

  // ══════════════════════════════════════
  // BADGE GLOBAL
  // ══════════════════════════════════════
  function actualizarBadge(total) {
    const b = document.getElementById('chatwBadgeBar');
    if (total > 0) {
      b.textContent    = total > 9 ? '9+' : total;
      b.style.display  = 'inline-flex';
    } else {
      b.style.display = 'none';
    }
  }

  // ══════════════════════════════════════
  // POLLING
  // ══════════════════════════════════════
  function poll() {
    // Siempre actualiza el badge global aunque el panel esté cerrado
    get('/chat/contactos').then(function(data) {
      const contactos = data.contactos || [];

      // Suma de no leidos de OTRAS conversaciones (excluye la que tengo
      // abierta ahora mismo, porque esos mensajes ya se detectan en
      // cargarMensajes() y sonarian el aviso dos veces por el mismo mensaje)
      const idActivo = conversacionActiva ? conversacionActiva.id : null;
      const totalOtros = contactos.reduce(function (sum, c) {
        return c.id === idActivo ? sum : sum + (c.noLeidos || 0);
      }, 0);

      if (totalOtrosAnterior !== null && totalOtros > totalOtrosAnterior) {
        reproducirSonido();
      }
      totalOtrosAnterior = totalOtros;

      actualizarBadge(data.totalNoLeidos || 0);
      window._contactosCache = contactos;
      if (abierto && !conversacionActiva) cargarContactos();

      // Actualiza el "Escribiendo..." del encabezado de la conversación abierta
      if (conversacionActiva) {
        const activo = contactos.find(function (c) { return c.id === conversacionActiva.id; });
        actualizarEstadoEscribiendo(activo);
      }
    }).catch(function(){});

    if (abierto && conversacionActiva) cargarMensajes(true);
  }

  function actualizarEstadoEscribiendo(c) {
    const statusEl = document.getElementById('chatwConvStatusText');
    if (!statusEl || !c) return;
    const esGrupo = c.tipo === 'grupo';
    if (esGrupo && c.escribiendoNombres && c.escribiendoNombres.length > 0) {
      statusEl.textContent = c.escribiendoNombres.join(', ') +
        (c.escribiendoNombres.length > 1 ? ' están escribiendo…' : ' está escribiendo…');
      statusEl.classList.add('chatw-status-typing');
    } else if (!esGrupo && c.escribiendo) {
      statusEl.textContent = 'Escribiendo…';
      statusEl.classList.add('chatw-status-typing');
    } else {
      statusEl.textContent = esGrupo ? 'Grupo de chat' : (c.enLinea ? 'En línea' : 'Desconectado');
      statusEl.classList.remove('chatw-status-typing');
    }
  }

  // ══════════════════════════════════════
  // AVISAR "ESTOY ESCRIBIENDO" (con throttle, cada 1.5s como máximo)
  // ══════════════════════════════════════
  let ultimoAvisoEscribiendo = 0;
  function notificarEscribiendo() {
    if (!conversacionActiva) return;
    const ahora = Date.now();
    if (ahora - ultimoAvisoEscribiendo < 1500) return;
    ultimoAvisoEscribiendo = ahora;
    const esGrupo = conversacionActiva.tipo === 'grupo';
    post('/chat/escribiendo', esGrupo ? { grupo_id: conversacionActiva.id } : { destinatario_id: conversacionActiva.id })
      .catch(function(){});
  }

  function heartbeat() {
    post('/chat/heartbeat', {}).catch(function(){});
  }

  // ══════════════════════════════════════
  // INIT
  // ══════════════════════════════════════
  function init(userId) {
    window.CHATW_USER_ID = userId;

    // Cierra emojis al hacer clic fuera
    document.addEventListener('click', function(e) {
      const panel = document.getElementById('chatwEmojiPanel');
      const btn   = document.querySelector('.chatw-emoji-btn');
      if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
        cerrarEmojis();
      }
      // Cierra el picker rápido de reacciones al hacer clic fuera de él
      // (y fuera de cualquier botón "reaccionar" de un mensaje)
      const reactPicker = document.getElementById('chatwReactionPicker');
      if (reactPicker && reactPicker.style.display !== 'none' &&
          !reactPicker.contains(e.target) && !e.target.closest('.chatw-react-trigger')) {
        cerrarPickerReaccion();
      }
    });

    // Avisa "escribiendo..." mientras el usuario teclea en el chat
    const inputMsg = document.getElementById('chatwInput');
    if (inputMsg) inputMsg.addEventListener('input', notificarEscribiendo);

    heartbeat();
    setInterval(heartbeat, HEARTBEAT_MS);
    setInterval(poll, POLL_MS);
    poll();
  }

  return {
    init, toggle, volverALista, seleccionar,
    enviarMensaje, toggleEmojis, insertarEmoji, clicEmojiPanel,
    abrirModalGrupo, cerrarModalGrupo, crearGrupo,
    eliminarGrupo, toggleInfoGrupo,
    abrirPickerReaccion, cerrarPickerReaccion, reaccionarRapido,
    reaccionar, masEmojisReaccion
  };

})();
