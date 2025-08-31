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

let fileChunks = {};

// --- FUNCIONES AUXILIARES PARA PREVISUALIZACIÓN DE ENLACES ---
async function generateLinkPreview(text) {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/;
    const match = text.match(urlRegex);
    if (!match) return null;

    const url = match[0];

    const imageRegex = /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i;
    if (imageRegex.test(url)) {
        return {
            type: 'image',
            url: url,
            title: url.split('/').pop(),
            image: url,
            description: 'Imagen compartida en el chat'
        };
    }

    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const youtubeMatch = url.match(youtubeRegex);
    if (youtubeMatch && youtubeMatch[1]) {
        try {
            const videoId = youtubeMatch[1];
            const response = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`);
            if (!response.ok) return null;
            
            const data = await response.json();
            return {
                type: 'youtube',
                url: url,
                title: data.title,
                image: data.thumbnail_url,
                description: `Video de YouTube por ${data.author_name}`
            };
        } catch (error) {
            console.error("Error al obtener datos de YouTube oEmbed:", error);
            return null;
        }
    }
    return null;
}

// --- FUNCIONES PARA MANEJO DE MENSAJES Y ARCHIVOS ---

async function handleChatMessage(io, socket, { text, roomName, replyToId }) {
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
    
    const MAX_MESSAGE_LENGTH = 2000;
    if (text.length > MAX_MESSAGE_LENGTH) {
        return socket.emit('system message', { text: 'Error: Tu mensaje es demasiado largo.', type: 'error', roomName });
    }
    
    const isMessageSafe = botService.checkMessage(socket, text);
    if (!isMessageSafe) return;
    
    const previewData = await generateLinkPreview(text);
    const timestamp = new Date().toISOString();
    
    const stmt = db.prepare(`
        INSERT INTO messages 
        (roomName, nick, text, role, isVIP, timestamp, replyToId, preview_type, preview_url, preview_title, preview_description, preview_image) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const lastId = await new Promise((resolve, reject) => {
        stmt.run(
            roomName, sender.nick, text, sender.role, sender.isVIP ? 1 : 0, timestamp, replyToId || null,
            previewData?.type || null, previewData?.url || null, previewData?.title || null,
            previewData?.description || null, previewData?.image || null,
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
        stmt.finalize();
    });

    if (!lastId) {
        console.error("Error guardando mensaje: no se obtuvo lastID");
        return;
    }

    const messagePayload = {
        id: lastId, text, nick: sender.nick, role: sender.role, isVIP: sender.isVIP,
        roomName, timestamp, replyToId, preview: previewData
    };

    if (replyToId) {
        const originalMessage = await new Promise((resolve, reject) => {
            db.get('SELECT nick, text FROM messages WHERE id = ?', [replyToId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (originalMessage) {
            messagePayload.replyTo = { nick: originalMessage.nick, text: originalMessage.text };
        }
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

function handleFileStart(socket, data) { fileChunks[data.id] = { ...data, chunks: [], receivedSize: 0, owner: socket.id }; }
function handlePrivateFileStart(socket, data) { fileChunks[data.id] = { ...data, toNick: data.to, chunks: [], receivedSize: 0, owner: socket.id }; }

async function handleFileChunk(io, socket, data) {
    const fileData = fileChunks[data.id];
    if (!fileData || fileData.owner !== socket.id) return;
    fileData.chunks.push(data.data);
    fileData.receivedSize += data.data.byteLength;
    if (fileData.receivedSize >= fileData.size) {
        const fullFileBuffer = Buffer.concat(fileData.chunks);
        const base64File = `data:${fileData.type};base64,${fullFileBuffer.toString('base64')}`;
        const sender = socket.userData;
        const timestamp = new Date().toISOString();

        if (fileData.roomName) {
            const previewData = {
                type: 'image',
                url: base64File,
                title: fileData.name,
                image: base64File,
                description: 'Imagen subida por el usuario'
            };

            const stmt = db.prepare(`
                INSERT INTO messages 
                (roomName, nick, text, role, isVIP, timestamp, preview_type, preview_url, preview_title, preview_description, preview_image) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const lastId = await new Promise((resolve, reject) => {
                stmt.run(
                    fileData.roomName, sender.nick, `[Imagen: ${fileData.name}]`, sender.role, sender.isVIP ? 1 : 0, timestamp,
                    previewData.type, previewData.url, previewData.title, previewData.description, previewData.image,
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
                stmt.finalize();
            });

            if (lastId) {
                const fileMessagePayload = {
                    id: lastId, text: `[Imagen: ${fileData.name}]`, nick: sender.nick, role: sender.role,
                    isVIP: sender.isVIP, roomName: fileData.roomName, timestamp: timestamp, preview: previewData
                };
                io.to(fileData.roomName).emit('chat message', fileMessagePayload);
            }
        } else if (fileData.toNick) {
            const fileMessagePayload = { file: base64File, type: fileData.type, from: sender.nick, to: fileData.toNick, role: sender.role, isVIP: sender.isVIP, timestamp: timestamp };
            const targetSocketId = roomService.findSocketIdByNick(fileData.toNick);
            if (targetSocketId) { io.to(targetSocketId).emit('private file message', fileMessagePayload); }
            socket.emit('private file message', fileMessagePayload);
        }
        delete fileChunks[data.id];
    }
}

function clearUserFileChunks(socketId) { Object.keys(fileChunks).forEach(fileId => { if (fileChunks[fileId].owner === socketId) { delete fileChunks[fileId]; } }); }

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
    if (socket.rooms.has(roomName)) return;
    if (!roomService.rooms[roomName]) { roomService.rooms[roomName] = { users: {} }; }
    socket.join(roomName);
    socket.joinedRooms.add(roomName);
    let isAnyStaff = ['owner', 'admin', 'mod', 'operator'].includes(socket.userData.role);
    if (!isAnyStaff && socket.userData.id) {
        const staffRooms = await new Promise((resolve, reject) => {
            db.all('SELECT 1 FROM room_staff WHERE userId = ? LIMIT 1', [socket.userData.id], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        if (staffRooms.length > 0) { isAnyStaff = true; }
    }
    socket.userData.isStaff = isAnyStaff;
    roomService.rooms[roomName].users[socket.id] = socket.userData;
    if (socket.userData.isStaff) {
        socket.emit('set admin cookie', { nick: socket.userData.nick, role: socket.userData.role });
        if (!socket.rooms.has(roomService.MOD_LOG_ROOM)) {
            socket.join(roomService.MOD_LOG_ROOM);
            socket.joinedRooms.add(roomService.MOD_LOG_ROOM);
            if (!roomService.rooms[roomService.MOD_LOG_ROOM]) roomService.rooms[roomService.MOD_LOG_ROOM] = { users: {} };
            roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id] = socket.userData;
        }
    }
    logActivity('JOIN_ROOM', socket.userData, `Sala: ${roomName}`);
    
    db.all('SELECT * FROM messages WHERE roomName = ? ORDER BY timestamp DESC LIMIT 50', [roomName], (err, rows) => {
        if (err) { console.error("Error al cargar historial:", err); return; }
        const history = rows.reverse().map(row => ({
            id: row.id, nick: row.nick, text: row.text, role: row.role, isVIP: row.isVIP === 1,
            roomName: row.roomName, editedAt: row.editedAt, timestamp: row.timestamp, replyToId: row.replyToId,
            preview: row.preview_type ? {
                type: row.preview_type, url: row.preview_url, title: row.preview_title,
                description: row.preview_description, image: row.preview_image
            } : null
        }));
        socket.emit('load history', { roomName, history });
        socket.emit('join_success', { 
            user: socket.userData, 
            roomName: roomName, 
            joinedRooms: Array.from(socket.joinedRooms)
        });
        roomService.updateUserList(io, roomName);
    });

    socket.to(roomName).emit('system message', { text: `${socket.userData.nick} se ha unido a la sala.`, type: 'join', roomName });
    roomService.updateRoomData(io);
}


// --- FUNCIÓN PRINCIPAL DE SOCKET.IO ---
function initializeSocket(io) {
    global.io = io;
    io.on('connection', async (socket) => {
        
        console.log(`[SocketManager] Usuario conectado: ${socket.id}`);
        socket.joinedRooms = new Set();
        const userIP = socket.handshake.address;

        try {
            const roomList = roomService.getActiveRoomsWithUserCount();
            socket.emit('update room data', roomList); 
        } catch (error) {
            console.error('[ERROR CRÍTICO] Fallo al obtener o enviar la lista de salas:', error);
            socket.disconnect(true);
            return;
        }
        
        try {
            const isVpnUser = await vpnCheckService.isVpn(userIP);
            if (isVpnUser) {
                console.warn(`[ADVERTENCIA DE VPN/PROXY] La IP ${userIP} fue marcada como sospechosa.`);
            }
        } catch (error) {
            console.error("Error durante la verificación de VPN:", error);
        }

        // --- MANEJADORES DE EVENTOS ---
        socket.on('guest_join', async (data) => {
            const { nick, roomName } = data;
            if (!nick || !roomName) return socket.emit('auth_error', { message: "El nick y la sala son obligatorios." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (!/^[a-zA-Z0-9_-]+$/.test(nick)) { return socket.emit('auth_error', { message: "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_)." }); }
            const existingUser = await userService.findUserByNick(nick);
            if (existingUser) return socket.emit('auth_error', { message: `El nick '${nick}' está registrado. Por favor, inicia sesión.` });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' ya está en uso.` });
            
            const persistentId = uuidv4();
            socket.emit('assign id', persistentId);
            if (await checkBanStatus(socket, persistentId, userIP)) { return; }
            
            socket.userData = { nick, id: persistentId, role: 'guest', isMuted: false, isVIP: false, ip: userIP, avatar_url: 'image/default-avatar.png', isAFK: false };
            roomService.guestSocketMap.set(persistentId, socket.id);
            socket.emit('set session cookie', { id: socket.userData.id, nick: socket.userData.nick, role: socket.userData.role });
            logActivity('CONNECT', socket.userData);
            await handleJoinRoom(io, socket, { roomName });
            socket.emit('system message', { text: '¡Bienvenido! Como invitado, haz clic derecho en tu nick en la lista de usuarios para poner un avatar.', type: 'highlight', roomName: roomName });
        });

        socket.on('register', async (data) => {
            const { nick, email, password } = data;
            if (!nick || !email || !password) return socket.emit('auth_error', { message: "El nick, el correo y la contraseña no pueden estar vacíos." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (!/^[a-zA-Z0-9_-]+$/.test(nick)) { return socket.emit('auth_error', { message: "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_)." }); }
            if (!/\S+@\S+\.\S+/.test(email)) return socket.emit('auth_error', { message: "Formato de correo electrónico inválido." });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está actualmente en uso por un invitado.` });
            
            const existingUserByNick = await userService.findUserByNick(nick);
            if (existingUserByNick) { return socket.emit('auth_error', { message: "Ese nick ya está registrado." }); }
            
            // =========================================================================
            // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
            // =========================================================================
            // Usamos la misma función 'findUserByNick' porque también busca por email.
            const existingUserByEmail = await userService.findUserByNick(email);
            // =========================================================================
            // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
            // =========================================================================
            
            if (existingUserByEmail) { return socket.emit('auth_error', { message: "Ese correo electrónico ya está registrado." }); }
            
            try {
                await userService.createUser(nick, email, password, userIP);
                socket.emit('register_success', { message: `¡Nick '${nick}' registrado con éxito! Ahora puedes entrar.` });
            } catch (error) {
                console.error("Error al registrar:", error);
                socket.emit('auth_error', { message: "Error interno del servidor al registrar." });
            }
        });

        socket.on('login', async (data) => {
            const { nick, password, roomName } = data;
            if (await checkBanStatus(socket, nick.toLowerCase(), userIP)) { return; }
            
            const registeredData = await userService.findUserByNick(nick);
            if (!registeredData) return socket.emit('auth_error', { message: "El nick o email no está registrado." });

            try {
                const match = await userService.verifyPassword(password, registeredData.password);
                if (!match) return socket.emit('auth_error', { message: "Contraseña incorrecta." });
                if (roomService.isNickInUse(registeredData.nick)) return socket.emit('auth_error', { message: `El usuario '${registeredData.nick}' ya está conectado.` });

                socket.userData = { 
                    nick: registeredData.nick, 
                    id: registeredData.id, 
                    role: registeredData.role,
                    isMuted: registeredData.isMuted === 1, 
                    isVIP: registeredData.isVIP === 1, 
                    ip: userIP, 
                    avatar_url: registeredData.avatar_url || 'image/default-avatar.png', 
                    isStaff: ['owner', 'admin', 'mod', 'operator'].includes(registeredData.role), 
                    isAFK: false 
                };

                await userService.updateUserIP(registeredData.nick, userIP);
                socket.emit('assign id', registeredData.id);
                socket.emit('set session cookie', { id: socket.userData.id, nick: socket.userData.nick, role: socket.userData.role });
                logActivity('CONNECT', socket.userData);
                await handleJoinRoom(io, socket, { roomName });
            } catch (error) {
                console.error("Error en login:", error);
                socket.emit('auth_error', { message: "Error interno del servidor al iniciar sesión." });
            }
        });
        
        socket.on('join room', (data) => handleJoinRoom(io, socket, data));
        
        socket.on('leave room', (data) => {
            const { roomName } = data;
            if (!socket.rooms.has(roomName) || !roomService.rooms[roomName]) return;
            if (roomName === roomService.MOD_LOG_ROOM) return;
            logActivity('LEAVE_ROOM', socket.userData, `Sala: ${roomName}`);
            socket.leave(roomName);
            socket.joinedRooms.delete(roomName);
            if (roomService.rooms[roomName].users[socket.id]) { delete roomService.rooms[roomName].users[socket.id]; }
            socket.emit('leave_success', { roomName, joinedRooms: Array.from(socket.joinedRooms) });
            socket.to(roomName).emit('system message', { text: `${socket.userData.nick} ha abandonado la sala.`, type: 'leave', roomName });
            if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) { delete roomService.rooms[roomName]; } else { roomService.updateUserList(io, roomName); }
            roomService.updateRoomData(io);
        });

        socket.on('disconnect', () => {
            const userData = socket.userData;
            if (!userData || !userData.nick) return;
            if (userData.role === 'guest') {
                roomService.guestSocketMap.delete(userData.id);
                if (userData.temp_avatar_path) {
                    fs.unlink(userData.temp_avatar_path, (err) => {
                        if (err) { console.error(`Error al borrar avatar temporal de ${userData.nick}:`, err); }
                    });
                }
            }
            logActivity('DISCONNECT', userData);
            io.emit('user disconnected', { nick: userData.nick });
            const roomsUserWasIn = Array.from(socket.joinedRooms || []);
            roomsUserWasIn.forEach(roomName => {
                if (roomService.rooms[roomName] && roomService.rooms[roomName].users[socket.id]) {
                    if (!socket.kicked) { io.to(roomName).emit('system message', { text: `${userData.nick} ha abandonado el chat.`, type: 'leave', roomName }); }
                    delete roomService.rooms[roomName].users[socket.id];
                    roomService.updateUserList(io, roomName);
                    if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) { delete roomService.rooms[roomName]; }
                }
            });
            clearUserFileChunks(socket.id);
            roomService.updateRoomData(io);
            console.log('Un usuario se ha desconectado:', socket.id, userData.nick);
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
            const query = `SELECT id, from_nick, to_nick, text, timestamp FROM private_messages WHERE (from_nick = ? AND to_nick = ?) OR (from_nick = ? AND to_nick = ?) ORDER BY timestamp DESC LIMIT 50`;
            db.all(query, [myNick, withNick, withNick, myNick], (err, rows) => {
                if (err) { console.error("Error al cargar historial privado:", err); return; }
                const history = rows.reverse().map(row => ({ id: row.id, text: row.text, from: row.from_nick, to: row.to_nick, timestamp: row.timestamp }));
                socket.emit('load private history', { withNick, history });
            });
        });

        socket.on('file-start', (data) => handleFileStart(socket, data));
        socket.on('private-file-start', (data) => handlePrivateFileStart(socket, data));
        socket.on('file-chunk', (data) => handleFileChunk(io, socket, data));
        
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