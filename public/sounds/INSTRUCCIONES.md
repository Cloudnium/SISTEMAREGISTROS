# 🔊 Sonido de notificación del chat

## Cómo cambiar el sonido

1. Consigue tu archivo de audio (formato `.mp3`, `.wav` u `.ogg`)
2. Renómbralo exactamente como: `notificacion.mp3` (o `.wav`/`.ogg`)
3. Reemplaza el archivo en esta carpeta: `public/sounds/`
4. Si usas otro nombre o formato, edita la línea en
   `public/js/chat-widget.js` que dice:
   ```js
   const SONIDO_NOTIFICACION = '/sounds/notificacion.wav';
   ```
   y cambia la ruta por la tuya.

## Recomendaciones
- Duración corta: 0.3 a 1.5 segundos (sonidos largos se sienten invasivos)
- Volumen moderado, sin picos fuertes
- Formato `.mp3` es el más compatible con todos los navegadores

## Dónde conseguir sonidos gratuitos
- https://freesound.org (requiere cuenta gratuita)
- https://mixkit.co/free-sound-effects/notification/
- https://notificationsounds.com
