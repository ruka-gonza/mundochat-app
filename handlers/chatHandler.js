// handlers/chatHandler.js (REVISADO: No necesita cambios para audio si ya maneja fileData.type)
const { handleCommand } = require('./modHandler');
const roomService = require('../services/roomService');
const botService = require('../services/botService');
const sqlite3 = require('sqlite3').verbose();

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);

let fileChunks = {}; // In-memory file chunk storage

async function handleChatMessage(io, socket, { text, roomName }) {
    if (!socket.rooms.has(roomName) || !roomService.rooms[roomName] || !roomService.rooms[roomName].users[socket.id]) {
        return;
    }

    const sender = socket.userData;
    if (sender.isMuted && !text.startsWith('/')) {
        return socket.emit('system message', { text: 'Estás silenciado y no puedes enviar mensajes.', type: 'error', roomName });
    }

    if (text.startsWith('/')) {
        return await handleCommand(io, socket, text, roomName);
    }
    
    // INTEGRACIÓN DEL BOT
    const isMessageSafe = botService.checkMessage(socket, text);
    if (!isMessageSafe) {
        // Si el mensaje no es seguro, el bot ya se encargó del usuario (warn/kick).
        // Simplemente detenemos el procesamiento de este mensaje.
        return;
    }

    const messageData = {
        text,
        nick: sender.nick,
        role: sender.role,
        isVIP: sender.isVIP,
        roomName
    };

    const stmt = db.prepare('INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(roomName, sender.nick, text, sender.role, sender.isVIP ? 1 : 0, new Date().toISOString(), function(err) {
        if(err) {
            console.error("Error guardando mensaje:", err);
            return;
        }
        messageData.id = this.lastID;
        io.to(roomName).emit('chat message', messageData);
    });
    stmt.finalize();
}

function handlePrivateMessage(io, socket, { to, text }) {
    const sender = socket.userData;
    if (!sender || !sender.nick) return;

    if (sender.nick.toLowerCase() === to.toLowerCase()) {
        return socket.emit('system message', { text: 'No puedes enviarte mensajes a ti mismo.', type: 'error' });
    }

    const targetSocketId = roomService.findSocketIdByNick(to);

    if (targetSocketId) {
        const messagePayload = { text, from: sender.nick, to: to, role: sender.role, isVIP: sender.isVIP };

        const stmt = db.prepare('INSERT INTO private_messages (from_nick, to_nick, text, timestamp) VALUES (?, ?, ?, ?)');
        stmt.run(sender.nick, to, text, new Date().toISOString(), function(err) {
            if (err) {
                console.error("Error guardando mensaje privado:", err);
                return;
            }
            messagePayload.id = this.lastID;

            io.to(targetSocketId).emit('private message', messagePayload);
            socket.emit('private message', messagePayload);
        });
        stmt.finalize();

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

function handleEditMessage(io, socket, { messageId, newText, roomName }) {
    const senderNick = socket.userData.nick;
    if (!messageId || !newText || !roomName) return;

    db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err || !row) return;

        if (row.nick.toLowerCase() === senderNick.toLowerCase()) {
            const stmt = db.prepare('UPDATE messages SET text = ?, editedAt = ? WHERE id = ?');
            stmt.run(newText, new Date().toISOString(), messageId, function(err) {
                if (err) return;
                io.to(roomName).emit('message edited', { messageId, newText, roomName });
            });
            stmt.finalize();
        }
    });
}

function handleDeleteMessage(io, socket, { messageId, roomName }) {
    const senderNick = socket.userData.nick;
    if (!messageId || !roomName) return;

    db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err || !row) return;

        if (row.nick.toLowerCase() === senderNick.toLowerCase()) {
            db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
                if (err) return;
                io.to(roomName).emit('message deleted', { messageId, roomName });
            });
        }
    });
}

function handleDeleteAnyMessage(io, socket, { messageId, roomName }) {
    const sender = socket.userData;
    if (!['owner', 'admin'].includes(sender.role)) {
        return socket.emit('system message', { text: 'No tienes permiso para realizar esta acción.', type: 'error', roomName });
    }

    if (!messageId || !roomName) return;
    db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err || !row) return; 

        const originalAuthor = row.nick;
        db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
            if (err) {
                console.error("Error al borrar mensaje por moderador:", err);
                return;
            }
            io.to(roomName).emit('message deleted', { messageId, roomName });

            const logMessage = `[MOD_DELETE] ${sender.nick} ha borrado un mensaje de ${originalAuthor} en la sala ${roomName}.`;
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: logMessage, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        });
    });
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