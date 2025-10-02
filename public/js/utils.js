import state from './state.js';

const emoticonMap = {
    ':)': '🙂',
    ':-)': '😊',
    ':D': '😄',
    ':/': '😕',
    'XD': '😂',
    '(y)': '👍',
    '(n)': '👎',
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
        .map(key => key.replace(/[-\/\\^$*+?.()|[\\\]{}\\]/g, '\\$&'))
        .join('|'),
    'g'
);

export function replaceEmoticons(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map(part => {
        if (part.match(urlRegex)) {
            return part;
        } else {
            return part.replace(emoticonRegex, (match) => emoticonMap[match]);
        }
    }).join('');
}


export function getUserIcons(user) {
    if (!user) return '';

    const viewerIsStaff = state.myUserData && (state.myUserData.role === 'owner' || state.myUserData.role === 'admin');

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    // Si el usuario de la lista tiene la bandera de incógnito...
    if (user.isActuallyStaffIncognito) {
        // ...y el que está viendo es staff O el usuario de la lista soy YO MISMO, muestro el fantasma.
        if (viewerIsStaff || user.nick === state.myNick) {
            return `<span class="user-icon">👻</span>`;
        }
        // ...si no, no muestro ningún icono.
        return '';
    }
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

    const roleIcons = {
        owner: '👑',
        admin: '🛡️',
        operator: '📣',
        mod: '🔧'
    };

    const afkIcon = user.isAFK ? '⏳' : '';
    const vipIcon = user.isVIP ? '⭐' : '';
    const roleIcon = (user.role && roleIcons[user.role]) || '';
    
    return afkIcon || vipIcon || roleIcon ? `<span class="user-icon">${afkIcon}${vipIcon}${roleIcon}</span>` : '';
}

async function playSoundNotification() {
    if (!state.audioUnlocked) {
        console.log("Audio context no desbloqueado, se omite el sonido de notificación.");
        return;
    }

    state.sonidoMencion.currentTime = 0;

    try {
        await state.sonidoMencion.play();
    } catch (error) {
        console.error("Error al reproducir el sonido de notificación (probablemente bloqueado por el navegador):", error.name, error.message);
    }
}

export function showNotification(title, body, requiresInteraction = false) {
    playSoundNotification();

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