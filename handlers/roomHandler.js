// handlers/chatHandler.js (AÑADIDO: Guardar mensajes en DB)
const { handleCommand } = require('./modHandler');
const roomService = require('../services/roomService');

// =========================================================================
// INICIO: AÑADIR CONEXIÓN A LA BASE DE DATOS
// =========================================================================
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./chat.db');
// =========================================================================
// FIN: AÑADIR CONEXIÓN
// =========================================================================

let fileChunks = {}; // In-memory file chunk storage

function handleChatMessage(io, socket, { text, roomName }) {
    if (!socket.rooms.has(roomName) || !roomService.rooms[roomName] || !roomService.rooms[roomName].users[socket.id]) {
        return;
    }

    const sender = socket.userData;
    if (sender.isMuted && !text.startsWith('/')) {
        return socket.emit('system message', { text: 'Estás silenciado y no puedes enviar mensajes.', type: 'error', roomName });
    }

    if (text.startsWith('/')) {
        return handleCommand(io, socket, text, roomName);
    }
    
    // Crear el objeto del mensaje una sola vez
    const messageData = {
        text,
        nick: sender.nick,
        role: sender.role,
        isVIP: sender.isVIP,
        roomName
    };

    // Emitir el mensaje a todos en la sala
    io.to(roomName).emit('chat message', messageData);

    // =========================================================================
    // INICIO: GUARDAR MENSAJE EN LA BASE DE DATOS
    // =========================================================================
    const stmt = db.prepare('INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(roomName, sender.nick, text, sender.role, sender.isVIP ? 1 : 0, new Date().toISOString());
    stmt.finalize();
    // =========================================================================
    // FIN: GUARDAR MENSAJE
    // =========================================================================
}

// --- El resto del archivo permanece intacto ---

function handlePrivateMessage(io, socket, { to, text }) {
    const sender = socket.userData;
    if (!sender || !sender.nick) return;

    if (sender.nick.toLowerCase() === to.toLowerCase()) {
        return socket.emit('system message', { text: 'No puedes enviarte mensajes a ti mismo.', type: 'error' });
    }

    const targetSocketId = roomService.findSocketIdByNick(to);

    if (targetSocketId) {
        const messagePayload = {
            text,
            from: sender.nick,
            to: to,
            role: sender.role,
            isVIP: sender.isVIP
        };

        // PASO 1: Enviar el mensaje al destinatario real.
        io.to(targetSocketId).emit('private message', messagePayload);
        
        // PASO 2: Enviar un "eco" del mensaje de vuelta al remitente.
        // Esto es crucial para que la UI del remitente pueda mostrar el mensaje que acaba de enviar.
        socket.emit('private message', messagePayload);

    } else {
        socket.emit('system message', { text: `El usuario '${to}' no se encuentra conectado.`, type: 'error' });
    }
}

function handleFileStart(socket, data) {
    fileChunks[data.id] = { ...data, chunks: [], receivedSize: 0, owner: socket.id };
}

function handlePrivateFileStart(socket, data) {
    fileChunks[data.id] = { ...data, toNick: data.to, chunks: [], receivedSize: 0, owner: socket.id };
}

function handleFileChunk(io, socket, data) {
    const fileData = fileChunks[data.id];
    if (!fileData || fileData.owner !== socket.id) {
        return;
    }

    fileData.chunks.push(data.data);
    fileData.receivedSize += data.data.byteLength;

    if (fileData.receivedSize >= fileData.size) {
        const fullFileBuffer = Buffer.concat(fileData.chunks);
        const base64File = `data:${fileData.type};base64,${fullFileBuffer.toString('base64')}`;
        const sender = socket.userData;

        const fileMessagePayload = {
            file: base64File,
            type: fileData.type,
            nick: sender.nick,
            from: sender.nick,
            to: fileData.toNick,
            role: sender.role,
            isVIP: sender.isVIP
        };

        if (fileData.roomName) {
            fileMessagePayload.roomName = fileData.roomName;
            io.to(fileData.roomName).emit('file message', fileMessagePayload);
        } else if (fileData.toNick) {
            const targetSocketId = roomService.findSocketIdByNick(fileData.toNick);
            // Enviar al destinatario
            if (targetSocketId) {
                io.to(targetSocketId).emit('private file message', fileMessagePayload);
            }
            // Enviar eco al remitente
            socket.emit('private file message', fileMessagePayload);
        }
        delete fileChunks[data.id];
    }
}

function clearUserFileChunks(socketId) {
    Object.keys(fileChunks).forEach(fileId => {
        if (fileChunks[fileId].owner === socketId) {
            delete fileChunks[fileId];
        }
    });
}

module.exports = {
    handleChatMessage,
    handlePrivateMessage,
    handleFileStart,
    handlePrivateFileStart,
    handleFileChunk,
    clearUserFileChunks
};