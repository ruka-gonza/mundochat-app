// services/botService.js (CORREGIDO: Lógica de expulsión ahora limpia y actualiza las salas)
const config = require('../botConfig.js');
const roomService = require('./roomService'); // Importar roomService para actualizar listas

let io;
const userStates = new Map();

function botSay(roomName, text) {
    if (io && roomName) {
        io.to(roomName).emit('system message', {
            text: `🤖 ${config.botNick}: ${text}`,
            type: 'warning',
            roomName: roomName
        });
    }
}

function punishUser(socket, punishmentType, reason) {
    const userData = socket.userData;
    if (!userData) return;

    if (punishmentType === 'warn') {
        const currentRoom = Array.from(socket.rooms).find(r => r !== socket.id);
        botSay(currentRoom, `${userData.nick}, has recibido una advertencia por: ${reason}.`);
    } else if (punishmentType === 'kick') {
        const kickReason = `Expulsión automática por ${reason}.`;
        console.log(`[BOT] Expulsando a ${userData.nick} por: ${reason}`);

        // --- INICIO DE LA LÓGICA CORREGIDA ---
        const roomsUserIsIn = Array.from(socket.rooms);

        // 1. Anunciar la expulsión en todas las salas donde estaba el usuario
        roomsUserIsIn.forEach(room => {
            if (room !== socket.id) {
                botSay(room, `${userData.nick} ha sido expulsado por el sistema. Razón: ${reason}.`);
            }
        });

        // 2. Limpiar al usuario de la lógica de salas y actualizar las listas
        roomsUserIsIn.forEach(room => {
            if (room !== socket.id && roomService.rooms[room]) {
                delete roomService.rooms[room].users[socket.id];
                roomService.updateUserList(io, room); // <-- ¡LA LÍNEA MÁS IMPORTANTE!
            }
        });
        
        // 3. Notificar al usuario y desconectarlo
        socket.emit('system message', { text: kickReason, type: 'error' });
        socket.disconnect(true);
        // --- FIN DE LA LÓGICA CORREGIDA ---
        
        userStates.delete(userData.nick);
    }
}

function checkMessage(socket, message) {
    const userData = socket.userData;

    if (['owner', 'admin', 'mod'].includes(userData.role)) {
        return true;
    }

    if (!userStates.has(userData.nick)) {
        userStates.set(userData.nick, {
            messages: [],
            timestamps: [],
        });
    }
    const state = userStates.get(userData.nick);

    const now = Date.now();
    state.timestamps.push(now);
    state.timestamps = state.timestamps.filter(ts => now - ts < config.flood.timeFrame * 1000);
    if (state.timestamps.length > config.flood.messageLimit) {
        punishUser(socket, config.flood.punishment, config.flood.reason);
        return false;
    }

    state.messages.push(message.toLowerCase());
    if (state.messages.length > config.repetition.count) {
        state.messages.shift();
    }
    if (state.messages.length === config.repetition.count && state.messages.every(m => m === state.messages[0])) {
        punishUser(socket, config.repetition.punishment, config.repetition.reason);
        return false;
    }
    
    for (const bannedWordRegex of config.bannedWords.list) {
        if (bannedWordRegex.test(message)) {
            punishUser(socket, config.bannedWords.punishment, config.bannedWords.reason);
            return false;
        }
    }

    return true;
}

function initialize(ioInstance) {
    io = ioInstance;
    console.log('🤖 Módulo de Bot de moderación inicializado.');
}

module.exports = {
    initialize,
    checkMessage
};