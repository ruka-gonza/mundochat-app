// handlers/chatHandler.js (LIMPIADO: Eliminado require de sqlite3 y lógica de DB)
const { handleCommand } = require('./modHandler');
const roomService = require('../services/roomService');
const botService = require('../services/botService');

let fileChunks = {}; // In-memory file chunk storage

// NOTA: La lógica para guardar mensajes en la base de datos ha sido removida.
// En una arquitectura serverless como la de Cyclic, los mensajes no suelen persistir
// a menos que se guarden en un servicio de DB como DynamoDB, lo cual complica
// el historial. Por ahora, el historial será solo de sesión.

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
    
    const isMessageSafe = botService.checkMessage(socket, text);
    if (!isMessageSafe) {
        return;
    }

    const messageData = {
        text,
        nick: sender.nick,
        role: sender.role,
        isVIP: sender.isVIP,
        roomName,
        id: Date.now() // Usamos un ID temporal para el cliente
    };
    
    // Simplemente emitimos el mensaje, ya no lo guardamos en la DB desde aquí.
    io.to(roomName).emit('chat message', messageData);
}

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
            isVIP: sender.isVIP,
            id: Date.now() // ID temporal
        };
        
        // Emitimos a ambos, ya no guardamos en DB desde aquí.
        io.to(targetSocketId).emit('private message', messagePayload);
        socket.emit('private message', messagePayload);

    } else {
        socket.emit('system message', { text: `El usuario '${to}' no se encuentra conectado.`, type: 'error' });
    }
}

// El resto de las funciones de manejo de archivos no necesitan cambios lógicos.

function handleFileStart(socket, data) {
    fileChunks[data.id] = { ...data, chunks: [], receivedSize: 0, owner: socket.id };
}

function handlePrivateFileStart(socket, data) {
    fileChunks[data.id] = { ...data, toNick: data.to, chunks: [], receivedSize: 0, owner: socket.id };
}

function handleFileChunk(io, socket, data) {
    const fileData = fileChunks[data.id];
    if (!fileData || fileData.owner !== socket.id) return;

    fileData.chunks.push(data.data);
    fileData.receivedSize += data.data.byteLength;

    if (fileData.receivedSize >= fileData.size) {
        const fullFileBuffer = Buffer.concat(fileData.chunks);
        const base64File = `data:${fileData.type};base64,${fullFileBuffer.toString('base64')}`;
        const sender = socket.userData;

        const fileMessagePayload = { file: base64File, type: fileData.type, nick: sender.nick, from: sender.nick, to: fileData.toNick, role: sender.role, isVIP: sender.isVIP };

        if (fileData.roomName) {
            fileMessagePayload.roomName = fileData.roomName;
            io.to(fileData.roomName).emit('file message', fileMessagePayload);
        } else if (fileData.toNick) {
            const targetSocketId = roomService.findSocketIdByNick(fileData.toNick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('private file message', fileMessagePayload);
            }
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

// La edición y borrado de mensajes ya no es posible si no se guardan en una DB.
function handleEditMessage(io, socket, { messageId, newText, roomName }) {
    socket.emit('system message', {text: "La edición de mensajes no está disponible.", type: "error"});
}

function handleDeleteMessage(io, socket, { messageId, roomName }) {
    socket.emit('system message', {text: "El borrado de mensajes no está disponible.", type: "error"});
}

function handleDeleteAnyMessage(io, socket, { messageId, roomName }) {
    socket.emit('system message', {text: "El borrado de mensajes no está disponible.", type: "error"});
}

module.exports = {
    handleChatMessage,
    handlePrivateMessage,
    handleFileStart,
    handlePrivateFileStart,
    handleFileChunk,
    clearUserFileChunks,
    handleEditMessage,
    handleDeleteMessage,
    handleDeleteAnyMessage
};