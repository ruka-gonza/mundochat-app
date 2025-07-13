// handlers/authHandler.js
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');
const banService = require('../services/banService');
const roomService = require('../services/roomService');
const { handleJoinRoom } = require('./roomHandler');

async function handleGuestJoin(io, socket, { nick, roomName }) {
    if (!nick || !roomName) return socket.emit('auth_error', { message: "El nick y la sala son obligatorios." });
    if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
    if (await userService.findUserByNick(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está registrado. Por favor, inicia sesión.` });
    if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' ya está en uso.` });

    const persistentId = uuidv4();
    socket.emit('assign id', persistentId);

    const banInfo = await banService.isUserBanned(persistentId);
    if (banInfo) {
        socket.emit('system message', { text: `Estás baneado. Razón: ${banInfo.reason}`, type: 'error' });
        return socket.disconnect();
    }

    socket.userData = { nick, id: persistentId, role: userService.getRole(nick), isMuted: false, isVIP: false };
    handleJoinRoom(io, socket, { roomName });
}

async function handleRegister(socket, { nick, password }) {
    if (!nick || !password) return socket.emit('auth_error', { message: "El nick y la contraseña no pueden estar vacíos." });
    if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
    if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está actualmente en uso por un invitado.` });
    if (await userService.findUserByNick(nick)) return socket.emit('auth_error', { message: "Ese nick ya está registrado." });

    try {
        await userService.createUser(nick, password);
        socket.emit('register_success', { message: `¡Nick '${nick}' registrado con éxito! Ahora puedes entrar.` });
    } catch (error) {
        console.error("Error al registrar:", error);
        socket.emit('auth_error', { message: "Error interno del servidor al registrar." });
    }
}

async function handleLogin(io, socket, { nick, password, roomName }) {
    const lowerCaseNick = nick.toLowerCase();
    const registeredData = await userService.findUserByNick(lowerCaseNick);
    if (!registeredData) return socket.emit('auth_error', { message: "El nick no está registrado." });

    try {
        const match = await userService.verifyPassword(password, registeredData.password);
        if (!match) return socket.emit('auth_error', { message: "Contraseña incorrecta." });
        if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El usuario '${nick}' ya está conectado.` });

        socket.emit('assign id', lowerCaseNick);
        const banInfo = await banService.isUserBanned(lowerCaseNick);
        if (banInfo) {
            socket.emit('system message', { text: `Estás baneado. Razón: ${banInfo.reason}`, type: 'error' });
            return socket.disconnect();
        }

        socket.userData = { nick: registeredData.nick, id: lowerCaseNick, role: userService.getRole(registeredData.nick), isMuted: false, isVIP: registeredData.isVIP === 1 };
        handleJoinRoom(io, socket, { roomName });
    } catch (error) {
        console.error("Error en login:", error);
        socket.emit('auth_error', { message: "Error interno del servidor al iniciar sesión." });
    }
}

module.exports = { handleGuestJoin, handleRegister, handleLogin };