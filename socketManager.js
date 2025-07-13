// socketManager.js (CORREGIDO: Sistema de baneos robusto al inicio de la conexión)

// Services
const roomService = require('./services/roomService');
const userService = require('./services/userService');
const banService = require('./services/banService');
const vpnCheckService = require('./services/vpnCheckService');

// Handlers de lógica pura
const { handleChatMessage, handlePrivateMessage, handleFileStart, handlePrivateFileStart, handleFileChunk, clearUserFileChunks, handleEditMessage, handleDeleteMessage, handleDeleteAnyMessage } = require('./handlers/chatHandler');
const { handleCommand } = require('./handlers/modHandler');

// Otras dependencias
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);


// =========================================================================
// INICIO DE LA FUNCIÓN DE AYUDA (NUEVA)
// =========================================================================
// Esta función centraliza la comprobación de baneos por múltiples criterios.
async function checkBanStatus(socket, idToCheck, ip) {
    // 1. Comprobar por ID (nick en minúsculas para registrados, UUID para invitados)
    let banInfo = await banService.isUserBanned(idToCheck);
    
    // 2. Si no se encuentra por ID, comprobar por IP (crucial para invitados)
    if (!banInfo && ip) {
        banInfo = await banService.isUserBanned(ip);
    }

    if (banInfo) {
        // Emitimos el mensaje de error directamente a la pantalla de login/registro.
        socket.emit('auth_error', { message: `Estás baneado. Razón: ${banInfo.reason}` });
        // También enviamos un mensaje de sistema por si acaso logra pasar a la vista de chat.
        socket.emit('system message', { text: `Estás baneado. Razón: ${banInfo.reason}`, type: 'error' });
        // Desconectamos al usuario.
        socket.disconnect(true);
        return true; // Retornamos true para indicar que el usuario está baneado.
    }
    
    return false; // El usuario no está baneado.
}
// =========================================================================
// FIN DE LA FUNCIÓN DE AYUDA
// =========================================================================


function logActivity(eventType, userData, details = null) {
    if (!userData || !userData.nick) return;

    const stmt = db.prepare(`
        INSERT INTO activity_logs (timestamp, event_type, nick, userId, userRole, ip, details) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        new Date().toISOString(),
        eventType,
        userData.nick,
        userData.id,
        userData.role,
        userData.ip,
        details
    );
    stmt.finalize();
    
    if (global.io) {
        global.io.emit('admin panel refresh');
    }
}

function handleJoinRoom(io, socket, { roomName }) {
    if (!socket.userData || !socket.userData.nick || !roomName) return;
    if (socket.rooms.has(roomName)) return;

    if (!roomService.rooms[roomName]) {
        roomService.rooms[roomName] = { users: {} };
    }

    if (['owner', 'admin', 'mod'].includes(socket.userData.role)) {
        socket.emit('set admin cookie', {
            nick: socket.userData.nick,
            role: socket.userData.role
        });
        
        if (!socket.rooms.has(roomService.MOD_LOG_ROOM)) {
            socket.join(roomService.MOD_LOG_ROOM);
            if (!roomService.rooms[roomService.MOD_LOG_ROOM]) roomService.rooms[roomService.MOD_LOG_ROOM] = { users: {} };
            roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id] = socket.userData;
        }
    }
    
    socket.join(roomName);
    roomService.rooms[roomName].users[socket.id] = socket.userData;
    
    logActivity('JOIN_ROOM', socket.userData, `Sala: ${roomName}`);

    db.all('SELECT * FROM messages WHERE roomName = ? ORDER BY timestamp DESC LIMIT 50', [roomName], (err, rows) => {
        if (err) {
            console.error("Error al cargar historial:", err);
            return;
        }
        const history = rows.reverse().map(row => ({
            id: row.id, 
            text: row.text, nick: row.nick, role: row.role, isVIP: row.isVIP === 1, roomName: row.roomName, editedAt: row.editedAt
        }));
        socket.emit('load history', { roomName, history });
    });

    socket.emit('join_success', { user: socket.userData, roomName: roomName, joinedRooms: Array.from(socket.rooms).filter(r => r !== socket.id) });
    socket.to(roomName).emit('system message', { text: `${socket.userData.nick} se ha unido a la sala.`, type: 'join', roomName });

    roomService.updateUserList(io, roomName);
    if (roomService.rooms[roomService.MOD_LOG_ROOM] && roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id]) {
        roomService.updateUserList(io, roomService.MOD_LOG_ROOM);
    }
    roomService.updateRoomData(io);
}

function initializeSocket(io) {
    global.io = io; 

    io.on('connection', async (socket) => {
        const userIP = socket.handshake.address;
        console.log(`Un usuario se ha conectado: ${socket.id} desde la IP: ${userIP}`);

        try {
            const isVpnUser = await vpnCheckService.isVpn(userIP);
            if (isVpnUser) {
                console.log(`Conexión rechazada para ${userIP} por uso de VPN/Proxy.`);
                socket.emit('auth_error', { message: 'El uso de VPN o proxies no está permitido en este chat. Por favor, desactívalo e intenta de nuevo.' });
                return socket.disconnect(true);
            }
        } catch (error) {
            console.error("Error crítico durante la verificación de VPN:", error);
        }

        roomService.updateRoomData(io);

        socket.on('guest_join', async (data) => {
            const { nick, roomName } = data;
            if (!nick || !roomName) return socket.emit('auth_error', { message: "El nick y la sala son obligatorios." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (await userService.findUserByNick(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está registrado. Por favor, inicia sesión.` });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' ya está en uso.` });

            const persistentId = uuidv4();
            socket.emit('assign id', persistentId);
            
            // Chequeo de Ban para Invitados (por ID y por IP)
            if (await checkBanStatus(socket, persistentId, userIP)) {
                return; // La función ya manejó el error y la desconexión.
            }
            
            socket.userData = { 
                nick, 
                id: persistentId, 
                role: 'guest',
                isMuted: false, 
                isVIP: false, 
                ip: userIP,
                avatar_url: 'image/default-avatar.png'
            };
            
            logActivity('CONNECT', socket.userData);
            handleJoinRoom(io, socket, { roomName });
        });
        
        socket.on('register', async (data) => {
            const { nick, password } = data;
            if (!nick || !password) return socket.emit('auth_error', { message: "El nick y la contraseña no pueden estar vacíos." });
            if (nick.length < 3 || nick.length > 15) return socket.emit('auth_error', { message: "El nick debe tener entre 3 y 15 caracteres." });
            if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El nick '${nick}' está actualmente en uso por un invitado.` });
            if (await userService.findUserByNick(nick)) return socket.emit('auth_error', { message: "Ese nick ya está registrado." });

            try {
                await userService.createUser(nick, password, userIP);
                socket.emit('register_success', { message: `¡Nick '${nick}' registrado con éxito! Ahora puedes entrar.` });
            } catch (error) {
                console.error("Error al registrar:", error);
                socket.emit('auth_error', { message: "Error interno del servidor al registrar." });
            }
        });

        socket.on('login', async (data) => {
            const { nick, password, roomName } = data;
            const lowerCaseNick = nick.toLowerCase();
            
            // Chequeo de Ban para Registrados (por nick y por IP)
            if (await checkBanStatus(socket, lowerCaseNick, userIP)) {
                return; // La función ya manejó el error y la desconexión.
            }

            const registeredData = await userService.findUserByNick(lowerCaseNick);
            if (!registeredData) return socket.emit('auth_error', { message: "El nick no está registrado." });

            try {
                const match = await userService.verifyPassword(password, registeredData.password);
                if (!match) return socket.emit('auth_error', { message: "Contraseña incorrecta." });
                if (roomService.isNickInUse(nick)) return socket.emit('auth_error', { message: `El usuario '${nick}' ya está conectado.` });
                
                await userService.updateUserIP(nick, userIP);

                socket.emit('assign id', lowerCaseNick);
                
                socket.userData = { 
                    nick: registeredData.nick, 
                    id: lowerCaseNick, 
                    role: userService.getRole(registeredData.nick), 
                    isMuted: registeredData.isMuted === 1,
                    isVIP: registeredData.isVIP === 1,
                    ip: userIP,
                    avatar_url: registeredData.avatar_url || 'image/default-avatar.png'
                };
                
                logActivity('CONNECT', socket.userData);
                handleJoinRoom(io, socket, { roomName });
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
             if (roomService.rooms[roomName].users[socket.id]) {
                 delete roomService.rooms[roomName].users[socket.id];
             }
             socket.emit('leave_success', { roomName, joinedRooms: Array.from(socket.rooms).filter(r => r !== socket.id) });
             io.to(roomName).emit('system message', { text: `${socket.userData.nick} ha abandonado la sala.`, type: 'leave', roomName });
             if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) {
                 delete roomService.rooms[roomName];
             } else {
                 roomService.updateUserList(io, roomName);
             }
             roomService.updateRoomData(io);
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
                SELECT id, from_nick, to_nick, text, timestamp 
                FROM private_messages
                WHERE (from_nick = ? AND to_nick = ?) OR (from_nick = ? AND to_nick = ?)
                ORDER BY timestamp DESC
                LIMIT 50
            `;

            db.all(query, [myNick, withNick, withNick, myNick], (err, rows) => {
                if (err) {
                    console.error("Error al cargar historial privado:", err);
                    return;
                }
                const history = rows.reverse().map(row => ({
                    id: row.id,
                    text: row.text,
                    from: row.from_nick,
                    to: row.to_nick
                }));
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

        socket.on('report user', ({ targetNick, reason }) => {
            const reporter = socket.userData;
            if (!reporter || !targetNick) return;

            const reportDetails = `Denuncia de: ${reporter.nick} | Hacia: ${targetNick} | Razón: ${reason}`;
            console.log(`[DENUNCIA] ${reportDetails}`);

            logActivity('USER_REPORT', reporter, reportDetails);

            const staffMessage = `[DENUNCIA] 📢 ${reporter.nick} ha denunciado a ${targetNick}. Razón: "${reason}"`;
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { 
                text: staffMessage, 
                type: 'warning',
                roomName: roomService.MOD_LOG_ROOM
            });

            socket.emit('system message', {
                text: `Tu denuncia contra ${targetNick} ha sido enviada al staff. Gracias.`,
                type: 'highlight'
            });
            
            io.emit('admin panel refresh');
        });

        socket.on('disconnect', () => {
            const userData = socket.userData;
            if (userData) {
                logActivity('DISCONNECT', userData);
            }
            const userNick = userData ? userData.nick : null;
            if (!userNick) return;

            // Notificar a otros usuarios si tenían un chat privado activo con la persona que se va.
            io.fetchSockets().then(allSockets => {
                allSockets.forEach(otherSocket => {
                    if (otherSocket.id !== socket.id) {
                         otherSocket.emit('user disconnected', { nick: userNick });
                    }
                });
            });

            const roomsUserIsIn = Array.from(socket.rooms);

            roomsUserIsIn.forEach(roomName => {
                if (roomName === socket.id) return;

                if (roomService.rooms[roomName] && roomService.rooms[roomName].users[socket.id]) {
                    delete roomService.rooms[roomName].users[socket.id];
                    
                    if (socket.disconnected) {
                        // El mensaje de "expulsado/baneado" ya se envió desde modHandler.
                    } else {
                        io.to(roomName).emit('system message', { text: `${userNick} ha abandonado el chat.`, type: 'leave', roomName });
                    }

                    if (Object.keys(roomService.rooms[roomName].users).length === 0 && !roomService.DEFAULT_ROOMS.includes(roomName) && roomName !== roomService.MOD_LOG_ROOM) {
                        delete roomService.rooms[roomName];
                    } else {
                        roomService.updateUserList(io, roomName);
                    }
                }
            });

            clearUserFileChunks(socket.id);
            roomService.updateRoomData(io);
            console.log('Un usuario se ha desconectado:', socket.id, userNick);
        });
    });
}

module.exports = { initializeSocket };