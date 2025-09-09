import state from './state.js';

const emoticonMap = {
    ':)': '🙂',
    ':-)': '😊',
    ':D': '😄',
    ':/': '😕',
    'XD': '😂',
    '(y)': '👍',
    '(n)': '👎',
    ':)': '🙂',
    ':P': '😛',
    ':p': '😛',
    ':O': '😮',
    ':o': '😮',
    ':(': '😞',
    ':-(': '😞',
    ":'(": '😢',
    '<3': '❤️',
    ';)': '😉'
};

const emoticonRegex = new RegExp(
    Object.keys(emoticonMap)
        .map(key => key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'))
        .join('|'),
    'g'
);

export function replaceEmoticons(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    return text.replace(emoticonRegex, (match) => emoticonMap[match]);
}


export function getUserIcons(user) {
    if (!user) return '';

    const roleIcons = {
        owner: '👑',
        admin: '🛡️',
        mod: '🔧',
        operator: '📣'
    };

    const afkIcon = user.isAFK ? '⏳' : '';
    const vipIcon = user.isVIP ? '⭐' : '';
    const roleIcon = (user.role && roleIcons[user.role]) || '';
    
    return afkIcon || vipIcon || roleIcon ? `<span class="user-icon">${afkIcon}${vipIcon}${roleIcon}</span>` : '';
}

// --- INICIO DE LA MODIFICACIÓN ---

// 1. Creamos una función robusta para reproducir el sonido
async function playSoundNotification() {
    // Si el audio nunca fue desbloqueado, no intentamos nada.
    if (!state.audioUnlocked) {
        console.log("Audio context no desbloqueado, se omite el sonido de notificación.");
        return;
    }

    // Reiniciamos el sonido para que suene desde el principio si hay varias menciones seguidas.
    state.sonidoMencion.currentTime = 0;

    try {
        // El método play() devuelve una Promise. Debemos esperarla.
        await state.sonidoMencion.play();
    } catch (error) {
        // Los navegadores móviles a menudo lanzan un error "NotAllowedError" aquí.
        // Lo capturamos para que no rompa la aplicación y lo registramos para depuración.
        console.error("Error al reproducir el sonido de notificación (probablemente bloqueado por el navegador):", error.name, error.message);
    }
}

export function showNotification(title, body, requiresInteraction = false) {
    // 2. Siempre intentamos reproducir el sonido, sin importar si la pestaña está oculta.
    // Nuestra nueva función segura se encargará de los posibles errores.
    playSoundNotification();

    // El resto de la lógica de notificaciones visuales no cambia.
    if (!("Notification" in window)) return;
    
    const doNotify = () => {
        new Notification(title, { body, icon: '/image/favicon.png', requireInteraction: requiresInteraction });
    };

    if (document.hidden) {
        if (Notification.permission === "granted") {
            doNotify();
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then((permission) => {
                if (permission === "granted") doNotify();
            });
        }
    }
}
// --- FIN DE LA MODIFICACIÓN ---

export function isValidNick(nick) {
    const nickRegex = /^[a-zA-Z0-9_-]+$/;
    return nickRegex.test(nick);
}

export function unlockAudioContext() {
    if (state.audioUnlocked) return;
    
    const sound = state.sonidoMencion;
    sound.volume = 0; 
    const promise = sound.play();

    if (promise !== undefined) {
        promise.then(() => {
            sound.pause();
            sound.currentTime = 0;
            sound.volume = 0.7;
            state.audioUnlocked = true;
            console.log("Contexto de audio desbloqueado exitosamente.");
        }).catch(error => {
            console.warn("El navegador bloqueó el desbloqueo de audio:", error);
            sound.volume = 0.7;
        });
    }
}