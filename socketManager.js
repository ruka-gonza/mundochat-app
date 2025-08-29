const roomService = require('./services/roomService');
const userService = require('./services/userService');
const banService = require('./services/banService');
const botService = require('./services/botService');
const vpnCheckService = require('./services/vpnCheckService');
const { handleCommand } = require('./handlers/modHandler');
const permissionService = require('./services/permissionService');
const { v4: uuidv4 } = require('uuid');
const db = require('./services/db-connection');
const fs = require('fs'); // <-- AÑADIR IMPORTACIÓN DE FILE SYSTEM

let fileChunks = {};

// ... (Las funciones handleChatMessage, handlePrivateMessage, etc., no cambian)
// ... (Copiar y pegar desde tu archivo existente hasta llegar a initializeSocket)

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
    const isMessageSafe = botService.checkMessage(socket, text);
    if (!isMessageSafe) {
        return;
    }
    
    const timestamp = new Date().toISOString(); // Creamos la hora una sola vez
    
    const stmt = db.prepare('INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp, replyToId) VALUES (?, ?, ?, ?, ?, ?, ?)');
    
    const lastId = await new Promise((resolve, reject) => {
        stmt.run(roomName, sender.nick, text, sender.role, sender.isVIP ? 1 : 0, timestamp, replyToId || null, function(err) {
            if (err) return reject(err);
            resolve(this.lastID);
        });
        stmt.finalize();
    });

    if (!lastId) {
        console.error("Error guardando mensaje: no se obtuvo lastID");
        return;
    }

    const messageData = { id: lastId, text, nick: sender.nick, role: sender.role, isVIP: sender.isVIP, roomName, timestamp: timestamp };

    if (replyToId) {
        const originalMessage = await new Promise((resolve, reject) => {
            db.get('SELECT nick, text FROM messages WHERE id = ?', [replyToId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (originalMessage) {
            messageData.replyTo = {
                nick: originalMessage.nick,
                text: originalMessage.text
            };
        }
    }
    
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
        const timestamp = new Date().toISOString();
        const messagePayload = { text, from: sender.nick, to: to, role: sender.role, isVIP: sender.isVIP, timestamp: timestamp };

        const stmt = db.prepare('INSERT INTO private_messages (from_nick, to_nick, text, timestamp) VALUES (?, ?, ?, ?)');
        stmt.run(sender.nick, to, text, timestamp, function(err) {
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

        const fileMessagePayload = {
            file: base64File,
            type: fileData.type,
            nick: sender.nick,
            from: sender.nick,
            to: fileData.toNick,
            role: sender.role,
            isVIP: sender.isVIP,
            timestamp: timestamp
        };

        if (fileData.roomName) {
            fileMessagePayload.roomName = fileData.roomName;
            
            const stmt = db.prepare('INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
            
            const lastId = await new Promise((resolve, reject) => {
                stmt.run(fileData.roomName, sender.nick, base64File, sender.role, sender.isVIP ? 1 : 0, timestamp, function(err) {
                    if (err) return reject(err);
                    resolve(this.lastID);
                });
                stmt.finalize();
            });

            if (lastId) {
                fileMessagePayload.id = lastId;
            }

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

async function checkBanStatus(socket, idToCheck, ip) {
    let banInfo = await banService.isUserBanned(idToCheck);
    if (!banInfo && ip) {
        banInfo = await banService.isUserBanned(ip);
    }
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
    if (global.io) {
        global.io.emit('admin panel refresh');
    }
}

async function handleJoinRoom(io, socket, { roomName }) {
    if (!socket.userData || !socket.userData.nick || !roomName) return;
    if (socket.rooms.has(roomName)) return;
    if (!roomService.rooms[roomName]) {
        roomService.rooms[roomName] = { users: {} };
    }
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
        if (staffRooms.length > 0) {
            isAnyStaff = true;
        }
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

    const usersInRoom = Object.values(roomService.rooms[roomName].users);
    const userListPromises = usersInRoom.map(async (u) => {
        const effectiveRole = await permissionService.getUserEffectiveRole(u.id, roomName);
        return { 
            id: u.id, nick: u.nick, role: effectiveRole, 
            isVIP: u.isVIP, avatar_url: u.avatar_url,
            isAFK: u.isAFK // Incluir estado AFK en la lista de usuarios
        };
    });
    const initialUserList = await Promise.all(userListPromises);
    
    const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'guest': 5 };
    initialUserList.sort((a, b) => {
        const roleA = roleOrder[a.role] ?? 99;
        const roleB = roleOrder[b.role] ?? 99;
        if (roleA < roleB) return -1; if (roleA > roleB) return 1;
        return a.nick.localeCompare(b.nick);
    });

    db.all('SELECT * FROM messages WHERE roomName = ? ORDER BY timestamp DESC LIMIT 50', [roomName], (err, rows) => {
        if (err) { console.error("Error al cargar historial:", err); return; }
        
        const history = rows.reverse().map(row => {
            const baseMessage = {
                id: row.id,
                nick: row.nick,
                role: row.role,
                isVIP: row.isVIP === 1,
                roomName: row.roomName,
                editedAt: row.editedAt,
                timestamp: row.timestamp
            };
            
            if (row.text.startsWith('data:')) {
                return {
                    ...baseMessage,
                    file: row.text,
                    type: row.text.substring(5, row.text.indexOf(';')),
                    text: null
                };
            }
            
            return {
                ...baseMessage,
                text: row.text
            };
        });

        socket.emit('load history', { roomName, history });
        socket.emit('join_success', { 
            user: socket.userData, 
            roomName: roomName, 
            joinedRooms: Array.from(socket.joinedRooms),
            users: initialUserList
        });
    });
    
    socket.to(roomName).emit('system message', { text: `${socket.userData.nick} se ha unido a la sala.`, type: 'join', roomName });
    socket.broadcast.to(roomName).emit('update user list', { roomName, initialUserList });

    if (roomService.rooms[roomService.MOD_LOG_ROOM] && roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id]) {
        roomService.updateUserList(io, roomService.MOD_LOG_ROOM);
    }
    roomService.updateRoomData(io);
}


function initializeSocket(io) {
    global.io = io;
    io.on('connection', async (socket) => {
        socket.joinedRooms = new Set();
        const userIP = socket.handshake.address;
        console.log(`Un usuario se ha conectado: ${socket.id} desde la IP: ${userIP}`);
        try {
            const isVpnUser = await vpnCheckService.isVpn(userIP);
            if (isVpnUser) {
                console.warn(`[ADVERTENCIA DE VPN/PROXY] La IP ${userIP} fue marcada como sospechosa, pero se le ha permitido la conexión.`);
            }
        } catch (error) {
            console.error("Error crítico durante la verificación de VPN:", error);
        }
        roomService.updateRoomData(io);

        socket.on('guest_join', async (data) => {
            const { nick, roomName } = data;
            if (!nick || !roomName) return socket.emit('auth_error', { message: "El nick y la sala son obligatorios." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (!/^[a-zA-Z0-9_-]+$/.test(nick)) {
                return socket.emit('auth_error', { message: "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_)." });
            }
            if (await userService.findUserByNick(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está registrado. Por favor, inicia sesión.` });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' ya está en uso.` });
            const persistentId = uuidv4();
            socket.emit('assign id', persistentId);
            if (await checkBanStatus(socket, persistentId, userIP)) {
                return;
            }
            
            socket.userData = { nick, id: persistentId, role: 'guest', isMuted: false, isVIP: false, ip: userIP, avatar_url: 'image/default-avatar.png', isAFK: false };
            
            roomService.guestSocketMap.set(persistentId, socket.id);
            
            socket.emit('set session cookie', { id: socket.userData.id, nick: socket.userData.nick, role: socket.userData.role });
            logActivity('CONNECT', socket.userData);
            await handleJoinRoom(io, socket, { roomName });
            
            socket.emit('system message', {
                text: '¡Bienvenido! Como invitado, haz clic en tu nick en la lista de usuarios para poner un avatar.',
                type: 'highlight',
                roomName: roomName
            });
        });

        socket.on('register', async (data) => {
            const { nick, email, password } = data;
            if (!nick || !email || !password) return socket.emit('auth_error', { message: "El nick, el correo y la contraseña no pueden estar vacíos." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (!/^[a-zA-Z0-9_-]+$/.test(nick)) {
                return socket.emit('auth_error', { message: "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_)." });
            }
            if (!/\S+@\S+\.\S+/.test(email)) return socket.emit('auth_error', { message: "Formato de correo electrónico inválido." });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está actualmente en uso por un invitado.` });
            const existingUserByNick = await userService.findUserByNick(nick);
            if (existingUserByNick && existingUserByNick.nick.toLowerCase() === nick.toLowerCase()) {
                return socket.emit('auth_error', { message: "Ese nick ya está registrado." });
            }
            const existingUserByEmail = await userService.findUserByNick(email);
            if (existingUserByEmail && existingUserByEmail.email && existingUserByEmail.email.toLowerCase() === email.toLowerCase()) {
                return socket.emit('auth_error', { message: "Ese correo electrónico ya está registrado." });
            }
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
            const lowerCaseIdentifier = nick.toLowerCase();
            const currentUserIP = socket.handshake.address;
            if (await checkBanStatus(socket, lowerCaseIdentifier, currentUserIP)) {
                return;
            }
            const registeredData = await userService.findUserByNick(lowerCaseIdentifier);
            if (!registeredData) return socket.emit('auth_error', { message: "El nick o email no está registrado." });
            try {
                const match = await userService.verifyPassword(password, registeredData.password);
                if (!match) return socket.emit('auth_error', { message: "Contraseña incorrecta." });
                if (roomService.isNickInUse(registeredData.nick)) return socket.emit('auth_error', { message: `El usuario '${registeredData.nick}' ya está conectado.` });
                
                socket.userData = {
                    nick: registeredData.nick,
                    id: registeredData.id,
                    role: userService.getRole(registeredData.nick),
                    isMuted: registeredData.isMuted === 1,
                    isVIP: registeredData.isVIP === 1,
                    ip: currentUserIP,
                    avatar_url: registeredData.avatar_url || 'image/default-avatar.png',
                    isStaff: ['owner', 'admin', 'mod', 'operator'].includes(userService.getRole(registeredData.nick)),
                    isAFK: false
                };
                
                await userService.updateUserIP(registeredData.nick, currentUserIP);
                socket.emit('assign id', registeredData.nick.toLowerCase());
                socket.emit('set session cookie', { id: socket.userData.id, nick: socket.userData.nick, role: socket.userData.role });
                logActivity('CONNECT', socket.userData);
                await handleJoinRoom(io, socket, { roomName });
            } catch (error) {
                console.error("Error en login:", error);
                socket.emit('auth_error', { message: "Error interno del servidor al iniciar sesión." });
            }
        });

        socket.on('join room', async (data) => await handleJoinRoom(io, socket, data));
        
        socket.on('leave room', (data) => {
            const { roomName } = data;
            if (!socket.rooms.has(roomName) || !roomService.rooms[roomName]) return;
            if (roomName === roomService.MOD_LOG_ROOM) return;
            logActivity('LEAVE_ROOM', socket.userData, `Sala: ${roomName}`);
            socket.leave(roomName);
            socket.joinedRooms.delete(roomName);
            if (roomService.rooms[roomName].users[socket.id]) {
                delete roomService.rooms[roomName].users[socket.id];
            }
            socket.emit('leave_success', { roomName, joinedRooms: Array.from(socket.joinedRooms) });
            socket.to(roomName).emit('system message', { text: `${socket.userData.nick} ha abandonado la sala.`, type: 'leave', roomName });
            if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) {
                delete roomService.rooms[roomName];
            } else {
                roomService.updateUserList(io, roomName);
            }
            roomService.updateRoomData(io);
        });

        socket.on('disconnect', () => {
            const userData = socket.userData;
            if (!userData || !userData.nick) return;

            if (userData.role === 'guest') {
                roomService.guestSocketMap.delete(userData.id);
                if (userData.temp_avatar_path) {
                    fs.unlink(userData.temp_avatar_path, (err) => {
                        if (err) {
                            console.error(`Error al borrar avatar temporal de ${userData.nick}:`, err);
                        } else {
                            console.log(`Avatar temporal de ${userData.nick} borrado.`);
                        }
                    });
                }
            }

            logActivity('DISCONNECT', userData);
            io.emit('user disconnected', { nick: userData.nick });
            const roomsUserWasIn = Array.from(socket.joinedRooms || []);
            roomsUserWasIn.forEach(roomName => {
                if (roomService.rooms[roomName] && roomService.rooms[roomName].users[socket.id]) {
                    if (!socket.kicked) {
                       io.to(roomName).emit('system message', { text: `${userData.nick} ha abandonado el chat.`, type: 'leave', roomName });
                    }
                    delete roomService.rooms[roomName].users[socket.id];
                    roomService.updateUserList(io, roomName);
                    if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) {
                        delete roomService.rooms[roomName];
                    }
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
                if (targetSocketId) {
                    io.to(targetSocketId).emit('typing', { nick: sender.nick, context: { type: 'private', with: sender.nick } });
                }
            }
        });
        socket.on('stop typing', ({ context, to }) => {
            const sender = socket.userData;
            if (!sender || !context || !context.with) return;
            if (context.type === 'room') {
                socket.to(context.with).emit('stop typing', { nick: sender.nick, context });
            } else if (context.type === 'private' && to) {
                const targetSocketId = roomService.findSocketIdByNick(to);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('stop typing', { nick: sender.nick, context: { type: 'private', with: sender.nick } });
                }
            }
        });

        socket.on('toggle afk', () => {
            if (!socket.userData) return;

            socket.userData.isAFK = !socket.userData.isAFK;

            const nick = socket.userData.nick;
            const isAFK = socket.userData.isAFK;
            
            io.emit('user_data_updated', { nick, isAFK });

            const statusMessage = isAFK ? `${nick} ahora está ausente.` : `${nick} ha vuelto.`;
            socket.joinedRooms.forEach(room => {
                if (room !== socket.id) {
                    io.to(room).emit('system message', { text: statusMessage, type: 'join', roomName: room });
                }
            });
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