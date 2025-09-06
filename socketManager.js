const roomService = require('./services/roomService');
const userService = require('./services/userService');
const banService = require('./services/banService');
const botService = require('./services/botService');
const vpnCheckService = require('./services/vpnCheckService');
const { handleCommand } = require('./handlers/modHandler');
const permissionService = require('./services/permissionService');
const { v4: uuidv4 } = require('uuid');
const db = require('./services/db-connection');
const fs = require('fs');
const fetch = require('node-fetch');

// Almacenamiento en memoria de sesiones que han sido cerradas.
const closedSessions = new Set();
// Exportamos el set para que otros módulos (como el middleware) puedan acceder a él.
module.exports.closedSessions = closedSessions;

async function generateLinkPreview(text) {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/;
    const match = text.match(urlRegex);
    if (!match) return null;
    const url = match[0];
    const imageRegex = /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i;
    if (imageRegex.test(url)) {
        return { type: 'image', url: url, title: url.split('/').pop(), image: url, description: 'Imagen compartida en el chat' };
    }
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const youtubeMatch = url.match(youtubeRegex);
    if (youtubeMatch && youtubeMatch[1]) {
        try {
            const videoId = youtubeMatch[1];
            const response = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`);
            if (!response.ok) return null;
            const data = await response.json();
            return { type: 'youtube', url: url, title: data.title, image: data.thumbnail_url, description: `Video de YouTube por ${data.author_name}` };
        } catch (error) {
            console.error("Error al obtener datos de YouTube oEmbed:", error);
            return null;
        }
    }
    return null;
}

async function handleChatMessage(io, socket, { text, roomName, replyToId }) {
    if (!socket.userData || !socket.rooms.has(roomName) || !roomService.rooms[roomName] || !roomService.rooms[roomName].users[socket.id]) return;
    const sender = socket.userData;
    if (sender.isMuted && !text.startsWith('/')) return socket.emit('system message', { text: 'Estás silenciado y no puedes enviar mensajes.', type: 'error', roomName });
    if (text.startsWith('/')) return handleCommand(io, socket, text, roomName);
    const MAX_MESSAGE_LENGTH = 2000;
    if (text.length > MAX_MESSAGE_LENGTH) return socket.emit('system message', { text: 'Error: Tu mensaje es demasiado largo.', type: 'error', roomName });
    const isMessageSafe = botService.checkMessage(socket, text);
    if (!isMessageSafe) return;
    const previewData = await generateLinkPreview(text);
    const timestamp = new Date().toISOString();
    const stmt = db.prepare(`INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp, replyToId, preview_type, preview_url, preview_title, preview_description, preview_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const lastId = await new Promise((resolve, reject) => {
        stmt.run(roomName, sender.nick, text, sender.role, sender.isVIP ? 1 : 0, timestamp, replyToId || null, previewData?.type || null, previewData?.url || null, previewData?.title || null, previewData?.description || null, previewData?.image || null, function(err) {
            if (err) return reject(err);
            resolve(this.lastID);
        });
        stmt.finalize();
    });
    if (!lastId) return console.error("Error guardando mensaje: no se obtuvo lastID");
    const messagePayload = { id: lastId, text, nick: sender.nick, role: sender.role, isVIP: sender.isVIP, roomName, timestamp, replyToId, preview: previewData };
    if (replyToId) {
        const originalMessage = await new Promise((resolve, reject) => {
            db.get('SELECT nick, text FROM messages WHERE id = ?', [replyToId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (originalMessage) messagePayload.replyTo = { nick: originalMessage.nick, text: originalMessage.text };
    }
    io.to(roomName).emit('chat message', messagePayload);
}

function handlePrivateMessage(io, socket, { to, text }) {
    const sender = socket.userData;
    if (!sender || !sender.nick) return;
    if (sender.nick.toLowerCase() === to.toLowerCase()) {
        return socket.emit('system message', { text: 'No puedes enviarte mensajes a ti mismo.', type: 'error' });
    }
    const targetSocketId = roomService.findSocketIdByNick(to);
    if (targetSocketId) {
        const timestamp = new Date().toISOString();
        const messagePayload = { text, from: sender.nick, to: to, role: sender.role, isVIP: sender.isVIP, timestamp: timestamp };
        const stmt = db.prepare('INSERT INTO private_messages (from_nick, to_nick, text, timestamp) VALUES (?, ?, ?, ?)');
        stmt.run(sender.nick, to, text, timestamp, function(err) {
            if (err) { console.error("Error guardando mensaje privado:", err); return; }
            messagePayload.id = this.lastID;
            io.to(targetSocketId).emit('private message', messagePayload);
            socket.emit('private message', messagePayload);
        });
        stmt.finalize();
    } else {
        socket.emit('system message', { text: `El usuario '${to}' no se encuentra conectado.`, type: 'error' });
    }
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
    if (!['owner', 'admin'].includes(sender.role)) { return socket.emit('system message', { text: 'No tienes permiso para realizar esta acción.', type: 'error', roomName }); }
    if (!messageId || !roomName) return;
    db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err || !row) return;
        const originalAuthor = row.nick;
        db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
            if (err) { console.error("Error al borrar mensaje por moderador:", err); return; }
            io.to(roomName).emit('message deleted', { messageId, roomName });
            const logMessage = `[MOD_DELETE] ${sender.nick} ha borrado un mensaje de ${originalAuthor} en la sala ${roomName}.`;
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: logMessage, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        });
    });
}

async function checkBanStatus(socket, idToCheck, ip) {
    let banInfo = await banService.isUserBanned(idToCheck);
    if (!banInfo && ip) { banInfo = await banService.isUserBanned(ip); }
    if (banInfo) {
        socket.emit('auth_error', { message: `Estás baneado. Razón: ${banInfo.reason}` });
        socket.emit('system message', { text: `Estás baneado. Razón: ${banInfo.reason}`, type: 'error' });
        socket.disconnect(true);
        return true;
    }
    return false;
}

function logActivity(eventType, userData, details = null) {
    if (!userData || !userData.nick) return;
    const stmt = db.prepare(`INSERT INTO activity_logs (timestamp, event_type, nick, userId, userRole, ip, details) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(new Date().toISOString(), eventType, userData.nick, userData.id, userData.role, userData.ip, details);
    stmt.finalize();
    if (global.io) { global.io.emit('admin panel refresh'); }
}

async function handleJoinRoom(io, socket, { roomName }) {
    if (!socket.userData || !socket.userData.nick || !roomName) return;
    
    if (!roomService.rooms[roomName]) {
        roomService.rooms[roomName] = { users: {} };
    }

    const wasAlreadyInRoom = Object.values(roomService.rooms[roomName].users).some(
        user => user.id === socket.userData.id
    );

    const existingSocketId = Object.keys(roomService.rooms[roomName].users).find(
        sid => roomService.rooms[roomName].users[sid].id === socket.userData.id && sid !== socket.id
    );
    if (existingSocketId) {
        delete roomService.rooms[roomName].users[existingSocketId];
    }
    
    socket.join(roomName);
    if (!socket.joinedRooms) socket.joinedRooms = new Set();
    socket.joinedRooms.add(roomName);
    
    let isAnyStaff = ['owner', 'admin', 'mod', 'operator'].includes(socket.userData.role);
    if (!isAnyStaff && socket.userData.id) {
        const staffRooms = await new Promise((resolve) => {
            db.all('SELECT 1 FROM room_staff WHERE userId = ? LIMIT 1', [socket.userData.id], (err, rows) => {
                if (err) resolve([]);
                resolve(rows);
            });
        });
        if (staffRooms.length > 0) isAnyStaff = true;
    }
    socket.userData.isStaff = isAnyStaff;
    
    roomService.rooms[roomName].users[socket.id] = { ...socket.userData, socketId: socket.id };

    if (socket.userData.isStaff) {
        socket.join(roomService.MOD_LOG_ROOM);
        socket.joinedRooms.add(roomService.MOD_LOG_ROOM);
        if (!roomService.rooms[roomService.MOD_LOG_ROOM]) roomService.rooms[roomService.MOD_LOG_ROOM] = { users: {} };
        roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id] = { ...socket.userData, socketId: socket.id };
    }
    
    if (!wasAlreadyInRoom) {
        logActivity('JOIN_ROOM', socket.userData, `Sala: ${roomName}`);
        socket.to(roomName).emit('system message', { text: `${socket.userData.nick} se ha unido a la sala.`, type: 'join', roomName });
    }

    socket.emit('join_success', { 
        user: socket.userData, 
        roomName: roomName, 
        joinedRooms: Array.from(socket.joinedRooms),
        users: Object.values(roomService.rooms[roomName].users)
    });
    
    roomService.updateUserList(io, roomName);
    
        /*
    db.all('SELECT * FROM messages WHERE roomName = ? ORDER BY timestamp DESC LIMIT 50', [roomName], (err, rows) => {
        if (err) return console.error("Error al cargar historial:", err);
        const history = rows.reverse().map(row => ({ id: row.id, nick: row.nick, text: row.text, role: row.role, isVIP: row.isVIP === 1, roomName: row.roomName, editedAt: row.editedAt, timestamp: row.timestamp, replyToId: row.replyToId, preview: row.preview_type ? { type: row.preview_type, url: row.preview_url, title: row.preview_title, description: row.preview_description, image: row.preview_image } : null }));
        socket.emit('load history', { roomName, history });
    });
    */
    
    roomService.updateRoomData(io);
}

function handleDefinitiveDisconnect(io, socketData) {
    if (!socketData.userData || !socketData.userData.nick) return;

    // Añadimos el ID a la lista de sesiones cerradas
    closedSessions.add(socketData.userData.id);
    // Programamos su borrado para no llenar la memoria
    setTimeout(() => closedSessions.delete(socketData.userData.id), 5 * 60 * 1000); // 5 minutos

    logActivity('DISCONNECT', socketData.userData);
    io.emit('user disconnected', { nick: socketData.userData.nick });

    socketData.joinedRooms.forEach(roomName => {
        if (roomService.rooms[roomName] && roomService.rooms[roomName].users[socketData.id]) {
            delete roomService.rooms[roomName].users[socketData.id];
            io.to(roomName).emit('system message', { text: `${socketData.userData.nick} ha abandonado el chat.`, type: 'leave', roomName });
            roomService.updateUserList(io, roomName);
        }
    });
    
    roomService.updateRoomData(io);

    if (socketData.userData.role === 'guest') {
        roomService.guestSocketMap.delete(socketData.userData.id);
        if (socketData.userData.temp_avatar_path) {
            fs.unlink(socketData.userData.temp_avatar_path, (err) => {
                if (err) console.error(`Error al borrar avatar temporal de ${socketData.userData.nick}:`, err);
            });
        }
    }
}

function initializeSocket(io) {
    global.io = io;
    io.on('connection', async (socket) => {
        
        socket.joinedRooms = new Set();
        const userIP = socket.handshake.address;

        socket.emit('update room data', roomService.getActiveRoomsWithUserCount());
        
        vpnCheckService.isVpn(userIP).catch(err => console.error("Error en VPN Check:", err));

        socket.on('reauthenticate', async (cookieData) => {
            if (closedSessions.has(cookieData.id)) {
                console.log(`Re-autenticación rechazada para ${cookieData.nick} (sesión cerrada).`);
                return socket.emit('reauth_failed');
            }
            
            const userInDb = await userService.findUserById(cookieData.id);
            if (!userInDb || userInDb.nick.toLowerCase() !== cookieData.nick.toLowerCase()) {
                return socket.emit('reauth_failed');
            }
            
            socket.userData = { nick: userInDb.nick, id: userInDb.id, role: userInDb.role, isMuted: userInDb.isMuted === 1, isVIP: userInDb.isVIP === 1, ip: userIP, avatar_url: userInDb.avatar_url || 'image/default-avatar.png', isStaff: ['owner', 'admin', 'mod', 'operator'].includes(userInDb.role), isAFK: false };
            closedSessions.delete(userInDb.id);
            console.log(`Usuario ${userInDb.nick} re-autenticado con éxito.`);
            socket.emit('reauth_success');
        });

        socket.on('guest_join', async (data) => {
            const { nick, roomName, id } = data;
            if (!nick || !roomName) return; 
            if (await checkBanStatus(socket, null, userIP)) return;
            
            socket.userData = { nick, id: id, role: 'guest', isMuted: false, isVIP: false, ip: userIP, avatar_url: 'image/default-avatar.png', isAFK: false };
            roomService.guestSocketMap.set(id, socket.id);
            closedSessions.delete(id);
            logActivity('CONNECT', socket.userData);
            await handleJoinRoom(io, socket, { roomName });
        });

        socket.on('login', async (data) => {
            const { nick, id, roomName } = data;
            if (await checkBanStatus(socket, id, userIP)) return;
            const registeredData = await userService.findUserById(id);
            if (!registeredData || registeredData.nick.toLowerCase() !== nick.toLowerCase()) return;
            
            socket.userData = { nick: registeredData.nick, id: registeredData.id, role: registeredData.role, isMuted: registeredData.isMuted === 1, isVIP: registeredData.isVIP === 1, ip: userIP, avatar_url: registeredData.avatar_url || 'image/default-avatar.png', isStaff: ['owner', 'admin', 'mod', 'operator'].includes(registeredData.role), isAFK: false };
            await userService.updateUserIP(registeredData.nick, userIP);
            closedSessions.delete(id);
            logActivity('CONNECT', socket.userData);
            await handleJoinRoom(io, socket, { roomName });
        });
        
        socket.on('join room', (data) => handleJoinRoom(io, socket, data));
        
        socket.on('leave room', (data) => {
            const { roomName } = data;
            if (!socket.userData || !socket.rooms.has(roomName) || !roomService.rooms[roomName]) return;
            if (roomName === roomService.MOD_LOG_ROOM) return;
            logActivity('LEAVE_ROOM', socket.userData, `Sala: ${roomName}`);
            socket.leave(roomName);
            socket.joinedRooms.delete(roomName);
            if (roomService.rooms[roomName].users[socket.id]) delete roomService.rooms[roomName].users[socket.id];
            socket.emit('leave_success', { roomName, joinedRooms: Array.from(socket.joinedRooms) });
            socket.to(roomName).emit('system message', { text: `${socket.userData.nick} ha abandonado la sala.`, type: 'leave', roomName });
            if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) { delete roomService.rooms[roomName]; } else { roomService.updateUserList(io, roomName); }
            roomService.updateRoomData(io);
        });

        socket.on('logout', () => {
            handleDefinitiveDisconnect(io, {
                id: socket.id,
                userData: socket.userData,
                joinedRooms: Array.from(socket.joinedRooms || [])
            });
            socket.disconnect(true);
        });

        socket.on('disconnect', () => {
            handleDefinitiveDisconnect(io, {
                id: socket.id,
                userData: socket.userData,
                joinedRooms: Array.from(socket.joinedRooms || [])
            });
        });
        
        socket.on('request user list', ({ roomName }) => roomService.updateUserList(io, roomName));
        socket.on('chat message', (data) => handleChatMessage(io, socket, data));
        socket.on('edit message', (data) => handleEditMessage(io, socket, data));
        socket.on('delete message', (data) => handleDeleteMessage(io, socket, data));
        socket.on('delete any message', (data) => handleDeleteAnyMessage(io, socket, data));
        socket.on('private message', (data) => handlePrivateMessage(io, socket, data));
        socket.on('request private chat', ({ targetNick }) => {
            const sender = socket.userData;
            if (!sender || !sender.nick) return;
            const targetSocketId = roomService.findSocketIdByNick(targetNick);
            if (targetSocketId) {
                socket.emit('open private chat', { with: targetNick });
                io.to(targetSocketId).emit('private chat requested', { from: sender.nick });
            } else {
                socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra conectado.`, type: 'error' });
            }
        });
        
        socket.on('request private history', ({ withNick }) => {
            const myNick = socket.userData.nick;
            if (!myNick || !withNick) return;
            const query = `
                SELECT id, from_nick, to_nick, text, timestamp, 
                       preview_type, preview_url, preview_title, preview_description, preview_image 
                FROM private_messages 
                WHERE (from_nick = ? AND to_nick = ?) OR (from_nick = ? AND to_nick = ?) 
                ORDER BY timestamp DESC LIMIT 50`;
            db.all(query, [myNick, withNick, withNick, myNick], (err, rows) => {
                if (err) { console.error("Error al cargar historial privado:", err); return; }
                const history = rows.reverse().map(row => ({ 
                    id: row.id, 
                    text: row.text, 
                    from: row.from_nick, 
                    to: row.to_nick, 
                    timestamp: row.timestamp,
                    preview: row.preview_type ? { type: row.preview_type, url: row.preview_url, title: row.preview_title, description: row.preview_description, image: row.preview_image } : null
                }));
                socket.emit('load private history', { withNick, history });
            });
        });
        
        socket.on('typing', ({ context, to }) => {
            const sender = socket.userData;
            if (!sender || !context || !context.with) return;
            if (context.type === 'room') {
                socket.to(context.with).emit('typing', { nick: sender.nick, context });
            } else if (context.type === 'private' && to) {
                const targetSocketId = roomService.findSocketIdByNick(to);
                if (targetSocketId) { io.to(targetSocketId).emit('typing', { nick: sender.nick, context: { type: 'private', with: sender.nick } }); }
            }
        });
        
        socket.on('stop typing', ({ context, to }) => {
            const sender = socket.userData;
            if (!sender || !context || !context.with) return;
            if (context.type === 'room') {
                socket.to(context.with).emit('stop typing', { nick: sender.nick, context });
            } else if (context.type === 'private' && to) {
                const targetSocketId = roomService.findSocketIdByNick(to);
                if (targetSocketId) { io.to(targetSocketId).emit('stop typing', { nick: sender.nick, context: { type: 'private', with: sender.nick } }); }
            }
        });
        
        socket.on('toggle afk', () => {
            if (!socket.userData) return;
            socket.userData.isAFK = !socket.userData.isAFK;
            io.emit('user_data_updated', { nick: socket.userData.nick, isAFK: socket.userData.isAFK });
            const statusMessage = socket.userData.isAFK ? `${socket.userData.nick} ahora está ausente.` : `${socket.userData.nick} ha vuelto.`;
            socket.joinedRooms.forEach(room => { if (room !== socket.id) { io.to(room).emit('system message', { text: statusMessage, type: 'join', roomName: room }); } });
        });
        
        socket.on('report user', ({ targetNick, reason }) => {
            const reporter = socket.userData;
            if (!reporter || !targetNick) return;
            const reportDetails = `Denuncia de: ${reporter.nick} | Hacia: ${targetNick} | Razón: ${reason}`;
            logActivity('USER_REPORT', reporter, reportDetails);
            const staffMessage = `[DENUNCIA] 📢 ${reporter.nick} ha denunciado a ${targetNick}. Razón: "${reason}"`;
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: staffMessage, type: 'warning', roomName: roomService.MOD_LOG_ROOM });
            socket.emit('system message', { text: `Tu denuncia contra ${targetNick} ha sido enviada al staff. Gracias.`, type: 'highlight' });
            io.emit('admin panel refresh');
        });
    });
}

module.exports = { initializeSocket };