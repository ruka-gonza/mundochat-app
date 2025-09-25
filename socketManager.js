const roomService = require('./services/roomService');
const userService = require('./services/userService');
const banService = require('./services/banService');
const botService = require('./services/botService');
const vpnCheckService = require('./services/vpnCheckService');
const { handleCommand } = require('./handlers/modHandler');
const permissionService = require('./services/permissionService');
const { v4: uuidv4 } = require('uuid');
const db = require('./services/db-connection').getInstance();
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

    const fetchWithTimeout = (url, options, timeout = 2000) => {
        return Promise.race([
            fetch(url, options),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), timeout)
            )
        ]);
    };

    try {
        const response = await fetchWithTimeout(url);

        if (!response.ok) return null;

        const contentType = response.headers.get('content-type');

        // 1. If it's an image content-type, treat as direct image
        if (contentType && contentType.startsWith('image/')) {
             return { type: 'image', url: url, title: url.split('/').pop(), image: url, description: 'Imagen compartida en el chat' };
        }

        // 2. If it's a YouTube link (check before fetching html)
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const youtubeMatch = url.match(youtubeRegex);
        if (youtubeMatch && youtubeMatch[1]) {
            const videoId = youtubeMatch[1];
            // Use the oembed endpoint
            const oembedRes = await fetchWithTimeout(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`);
            if (!oembedRes.ok) return null;
            const data = await oembedRes.json();
            return { type: 'youtube', url: url, title: data.title, image: data.thumbnail_url, description: `Video de YouTube por ${data.author_name}` };
        }

        // 3. If it's HTML, parse for metadata
        if (contentType && contentType.includes('text/html')) {
            const html = await response.text();
            const titleMatch = html.match(/<title>(.*?)<\/title>/);
            const title = titleMatch ? titleMatch[1] : url;

            const descriptionMatch = html.match(/<meta\s+(?:name=[^'"']"description"['"]|property=[^'"']"og:description"['"])\s+content=[^'"']"(.*?)"['"]\s*\/?>/i);
            const description = descriptionMatch ? descriptionMatch[1] : '';

            const imageMatch = html.match(/<meta\s+property=[^'"']"og:image"['"]\s+content=[^'"']"(.*?)"['"]\s*\/?>/i);
            const image = imageMatch ? imageMatch[1] : null;

            if (image) {
                // If the found image is a GIF, embed it directly
                if (/\.gif(\?.*)?$/i.test(image)) {
                    return { type: 'image', url: url, title: title, image: image, description: description };
                }
                // For other images, create a standard preview card
                return { type: 'link', url: url, title: title, image: image, description: description };
            }
            
            // If no og:image, but we have a title, return a simple card
            if(title !== url) {
                return { type: 'link', url: url, title: title, description: description, image: null };
            }
        }
    } catch (error) {
        // Ignore fetch errors (like timeouts or invalid URLs)
        if (error.message !== 'timeout') {
            console.error("Error al generar previsualización de enlace:", error);
        }
        return null;
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
    const stmt = db.prepare(`INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp, replyToId, preview_type, preview_url, preview_title, preview_description, preview_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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

async function handlePrivateMessage(io, socket, { to, text }) {
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
        await new Promise((resolve, reject) => {
            stmt.run(sender.nick, to, text, timestamp, function(err) {
                if (err) { console.error("Error guardando mensaje privado:", err); return reject(err); }
                messagePayload.id = this.lastID;
                io.to(targetSocketId).emit('private message', messagePayload);
                socket.emit('private message', messagePayload);
                resolve();
            });
            stmt.finalize();
        });
    } else {
        socket.emit('system message', { text: `El usuario '${to}' no se encuentra conectado.`, type: 'error' });
    }
}

async function handleEditMessage(io, socket, { messageId, newText, roomName }) {
    const senderNick = socket.userData.nick;
    if (!messageId || !newText || !roomName) return;
    const row = await new Promise((resolve, reject) => {
        db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (row && row.nick.toLowerCase() === senderNick.toLowerCase()) {
        await new Promise((resolve, reject) => {
            const stmt = db.prepare('UPDATE messages SET text = ?, editedAt = ? WHERE id = ?');
            stmt.run(newText, new Date().toISOString(), messageId, function(err) {
                if (err) return reject(err);
                io.to(roomName).emit('message edited', { messageId, newText, roomName });
                resolve();
            });
            stmt.finalize();
        });
    }
}

async function handleDeleteMessage(io, socket, { messageId, roomName }) {
    const senderNick = socket.userData.nick;
    if (!messageId || !roomName) return;
    const row = await new Promise((resolve, reject) => {
        db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (row && row.nick.toLowerCase() === senderNick.toLowerCase()) {
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
                if (err) return reject(err);
                io.to(roomName).emit('message deleted', { messageId, roomName });
                resolve();
            });
        });
    }
}

async function handleDeleteAnyMessage(io, socket, { messageId, roomName }) {
    const sender = socket.userData;
    if (!['owner', 'admin'].includes(sender.role)) { 
        return socket.emit('system message', { text: 'No tienes permiso para realizar esta acción.', type: 'error', roomName }); 
    }
    if (!messageId || !roomName) return;
    const row = await new Promise((resolve, reject) => {
        db.get('SELECT nick FROM messages WHERE id = ?', [messageId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (row) {
        const originalAuthor = row.nick;
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
                if (err) { console.error("Error al borrar mensaje por moderador:", err); return reject(err); }
                io.to(roomName).emit('message deleted', { messageId, roomName });
                const logMessage = `[MOD_DELETE] ${sender.nick} ha borrado un mensaje de ${originalAuthor} en la sala ${roomName}.`;
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: logMessage, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                resolve();
            });
        });
    }
}

// --- INICIO DE LA CORRECCIÓN CLAVE ---
async function checkBanStatus(socket, idToCheck, ip) {
    // Llamamos a la nueva función de servicio con AMBOS datos a la vez.
    // El servicio se encarga de la lógica de buscar por ID o por IP.
    const banInfo = await banService.isUserBanned(idToCheck, ip);
    
    if (banInfo) {
        socket.emit('auth_error', { message: `Estás baneado. Razón: ${banInfo.reason}` });
        socket.emit('system message', { text: `Estás baneado. Razón: ${banInfo.reason}`, type: 'error' });
        socket.disconnect(true);
        return true;
    }
    return false;
}
// --- FIN DE LA CORRECCIÓN CLAVE ---

function logActivity(eventType, userData, details = null) {
    if (!userData || !userData.nick) return;
    const stmt = db.prepare(`INSERT INTO activity_logs (timestamp, event_type, nick, userId, userRole, ip, details) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    stmt.run(new Date().toISOString(), eventType, userData.nick, userData.id, userData.role, userData.ip, details);
    stmt.finalize();
    if (global.io) { global.io.emit('admin panel refresh'); }
}

async function handleJoinRoom(io, socket, { roomName }) {
    if (!socket.userData || !socket.userData.nick || !roomName) return;

    const lowerCaseRoomName = roomName.toLowerCase();
    const isModLog = lowerCaseRoomName === roomService.MOD_LOG_ROOM.toLowerCase();
    const isIncognito = lowerCaseRoomName === roomService.INCOGNITO_ROOM.toLowerCase();

    if (isModLog || isIncognito) {
        const allowedRoles = ['owner', 'admin'];
        if (!allowedRoles.includes(socket.userData.role)) {
            socket.emit('system message', { text: 'No tienes permiso para entrar a esta sala.', type: 'error' });
            return;
        }
    }
    
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
        const oldSocket = io.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
            oldSocket.emit('system message', { text: 'Has iniciado sesión en otra ubicación. Esta sesión se cerrará.', type: 'error', roomName });
            oldSocket.disconnect(true);
        } else {
            delete roomService.rooms[roomName].users[existingSocketId];
        }
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

    if (['owner', 'admin'].includes(socket.userData.role)) {
        // Auto-join Staff-Logs
        if (!socket.joinedRooms.has(roomService.MOD_LOG_ROOM)) {
            socket.join(roomService.MOD_LOG_ROOM);
            socket.joinedRooms.add(roomService.MOD_LOG_ROOM);
            if (!roomService.rooms[roomService.MOD_LOG_ROOM]) roomService.rooms[roomService.MOD_LOG_ROOM] = { users: {} };
        }
        roomService.rooms[roomService.MOD_LOG_ROOM].users[socket.id] = { ...socket.userData, socketId: socket.id };
        roomService.updateUserList(io, roomService.MOD_LOG_ROOM);

        // Auto-join Incognito
        if (!socket.joinedRooms.has(roomService.INCOGNITO_ROOM)) {
            socket.join(roomService.INCOGNITO_ROOM);
            socket.joinedRooms.add(roomService.INCOGNITO_ROOM);
            if (!roomService.rooms[roomService.INCOGNITO_ROOM]) roomService.rooms[roomService.INCOGNITO_ROOM] = { users: {} };
        }
        roomService.rooms[roomService.INCOGNITO_ROOM].users[socket.id] = { ...socket.userData, socketId: socket.id };
        roomService.updateUserList(io, roomService.INCOGNITO_ROOM);
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
    
    roomService.updateRoomData(io);
}

function handleDefinitiveDisconnect(io, socketData) {
    if (!socketData.userData || !socketData.userData.nick) return;

    closedSessions.add(socketData.userData.id);
    setTimeout(() => closedSessions.delete(socketData.userData.id), 5 * 60 * 1000);

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
    io.on('connection', (socket) => {
        
        socket.joinedRooms = new Set();
        const userIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

        console.log(`[CONEXIÓN ENTRANTE] IP registrada: ${userIP}`);

        socket.emit('update room data', roomService.getActiveRoomsWithUserCount());
        
        (async () => {
            try {
                const isVpn = await vpnCheckService.isVpn(userIP);
                if (isVpn) {
                    console.log(`[VPN DETECTADO] Conexión rechazada para la IP: ${userIP}`);
                    socket.emit('auth_error', { message: 'El uso de VPNs o proxies no está permitido.' });
                    return socket.disconnect(true);
                }
            } catch (err) {
                console.error("Error en VPN Check:", err);
            }
        })();

        socket.on('admin_agreement_accepted', async ({ targetNick, senderNick }) => {
            try {
                if (socket.userData.nick.toLowerCase() !== targetNick.toLowerCase()) {
                    return;
                }

                await userService.setUserRole(targetNick, 'admin');

                const successMsg = `${targetNick} ha sido promovido a admin (global) por ${senderNick}.`;
                io.emit('system message', { text: successMsg, type: 'highlight' });
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[PROMOTE-GLOBAL] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });

                const targetSocket = io.sockets.sockets.get(socket.id);
                if (targetSocket) {
                    targetSocket.userData.role = 'admin';
                    io.emit('user_data_updated', { nick: targetNick, role: 'admin' });
                }
            } catch (error) {
                console.error(`Error en el evento 'admin_agreement_accepted':`, error);
            }
        });

        socket.on('reauthenticate', async (cookieData) => {
            try {
                if (closedSessions.has(cookieData.id)) {
                    return socket.emit('reauth_failed');
                }
                
                const userInDb = await userService.findUserById(cookieData.id);
                if (!userInDb || userInDb.nick.toLowerCase() !== cookieData.nick.toLowerCase()) {
                    return socket.emit('reauth_failed');
                }
                
                socket.userData = { nick: userInDb.nick, id: userInDb.id, role: userInDb.role, isMuted: userInDb.isMuted === 1, isVIP: userInDb.isVIP === 1, ip: userIP, avatar_url: userInDb.avatar_url || 'image/default-avatar.png', isStaff: ['owner', 'admin', 'mod', 'operator'].includes(userInDb.role), isAFK: false };
                closedSessions.delete(userInDb.id);
                socket.emit('reauth_success');
            } catch (error) {
                console.error(`Error en el evento 'reauthenticate':`, error);
            }
        });

        socket.on('guest_join', async (data) => {
            try {
                const { nick, roomName, id } = data;
                if (!nick || !roomName) return; 
                if (await checkBanStatus(socket, id, userIP)) return;
                
                socket.userData = { nick, id: id, role: 'guest', isMuted: false, isVIP: false, ip: userIP, avatar_url: 'image/default-avatar.png', isStaff: false, isAFK: false };
                roomService.guestSocketMap.set(id, socket.id);
                closedSessions.delete(id);
                logActivity('CONNECT', socket.userData);
                await handleJoinRoom(io, socket, { roomName });
            } catch (error) {
                console.error(`Error en el evento 'guest_join':`, error);
                socket.emit('system message', { text: 'Ocurrió un error al intentar unirte como invitado.', type: 'error' });
            }
        });

        socket.on('login', async (data) => {
            try {
                let { nick, id, roomName } = data;
                if (await checkBanStatus(socket, id, userIP)) return;
                const registeredData = await userService.findUserById(id);
                if (!registeredData || registeredData.nick.toLowerCase() !== nick.toLowerCase()) return;
                
                if (['owner', 'admin'].includes(registeredData.role)) {
                    roomName = roomService.MOD_LOG_ROOM;
                }

                socket.userData = { nick: registeredData.nick, id: registeredData.id, role: registeredData.role, isMuted: registeredData.isMuted === 1, isVIP: registeredData.isVIP === 1, ip: userIP, avatar_url: registeredData.avatar_url || 'image/default-avatar.png', isStaff: ['owner', 'admin', 'mod', 'operator'].includes(registeredData.role), isAFK: false };
                await userService.updateUserIP(registeredData.nick, userIP);
                closedSessions.delete(id);
                logActivity('CONNECT', socket.userData);
                await handleJoinRoom(io, socket, { roomName });
            } catch (error) {
                console.error(`Error en el evento 'login':`, error);
                socket.emit('auth_error', { message: 'Ocurrió un error interno al iniciar sesión.' });
            }
        });
        
        socket.on('join room', async (data) => {
            try {
                await handleJoinRoom(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'join room':`, error);
                socket.emit('system message', { text: 'Ocurrió un error al unirte a la sala.', type: 'error' });
            }
        });
        
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
            roomService.updateUserList(io, roomName);
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
        
        socket.on('chat message', async (data) => {
            try {
                await handleChatMessage(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'chat message':`, error);
                socket.emit('system message', { text: 'Ocurrió un error al procesar tu mensaje.', type: 'error', roomName: data.roomName || '' });
            }
        });

        socket.on('edit message', async (data) => {
            try {
                await handleEditMessage(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'edit message':`, error);
            }
        });

        socket.on('delete message', async (data) => {
            try {
                await handleDeleteMessage(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'delete message':`, error);
            }
        });

        socket.on('delete any message', async (data) => {
            try {
                await handleDeleteAnyMessage(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'delete any message':`, error);
            }
        });

        socket.on('private message', async (data) => {
            try {
                await handlePrivateMessage(io, socket, data);
            } catch (error) {
                console.error(`Error en el evento 'private message':`, error);
                socket.emit('system message', { text: 'Ocurrió un error al enviar tu mensaje privado.', type: 'error' });
            }
        });

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
            try {
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
            } catch (error) {
                console.error(`Error en el evento 'request private history':`, error);
            }
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

            roomService.updateUserDataInAllRooms(socket);

            socket.emit('user_data_updated', { 
                nick: socket.userData.nick, 
                isAFK: socket.userData.isAFK 
            });

            socket.joinedRooms.forEach(room => {
                if (room !== socket.id) {
                    roomService.updateUserList(io, room);
                }
            });
            
            const statusMessage = socket.userData.isAFK ? `${socket.userData.nick} ahora está ausente.` : `${socket.userData.nick} ha vuelto.`;
            socket.joinedRooms.forEach(room => {
                if (room !== socket.id) {
                    io.to(room).emit('system message', { text: statusMessage, type: 'join', roomName: room });
                }
            });
        });

        socket.on('toggle incognito', async ({ newNick }) => {
            if (!socket.userData) return;

            const oldNick = socket.userData.nick;
            let nickChanged = false;
            let originalNickToRestore = null; // Para almacenar el nick original si se cambia

            if (socket.userData.isIncognito) { // Si ya está en incognito y lo va a desactivar
                if (socket.userData.original_nick) {
                    originalNickToRestore = socket.userData.original_nick;
                }
            }

            if (newNick && newNick !== oldNick) {
                // Validar el nuevo nick (ej: longitud, caracteres permitidos, no en uso)
                // Por ahora, una validación básica
                if (newNick.length < 3 || newNick.length > 15 || !/^[a-zA-Z0-9_-]+$/.test(newNick)) {
                    return socket.emit('system message', { text: 'Nick inválido. Usa entre 3 y 15 caracteres alfanuméricos, guiones o guiones bajos.', type: 'error' });
                }
                if (roomService.isNickInUse(newNick)) {
                    return socket.emit('system message', { text: `El nick "${newNick}" ya está en uso.`, type: 'error' });
                }

                // Si se proporciona un newNick, guardar el oldNick para restaurar si no se estaba en incognito
                if (!socket.userData.isIncognito && !socket.userData.original_nick) {
                    socket.userData.original_nick = oldNick;
                }
                
                socket.userData.nick = newNick;
                nickChanged = true;

                // Si es un usuario registrado, actualizar en la BD
                if (socket.userData.id && socket.userData.role !== 'guest') {
                    await userService.updateUserNick(oldNick, newNick); // Usar oldNick para buscar en la BD
                }
            } else if (originalNickToRestore) { // Si no se proporcionó newNick y hay un original para restaurar
                socket.userData.nick = originalNickToRestore;
                delete socket.userData.original_nick;
                nickChanged = true; // El nick ha cambiado de vuelta al original

                // Si es un usuario registrado, actualizar en la BD
                if (socket.userData.id && socket.userData.role !== 'guest') {
                    await userService.updateUserNick(oldNick, originalNickToRestore);
                }
            }

            socket.userData.isIncognito = !socket.userData.isIncognito;

            if (socket.userData.isIncognito) {
                // Guardar el avatar original y establecer el por defecto
                socket.userData.original_avatar_url = socket.userData.avatar_url;
                socket.userData.avatar_url = 'image/default-avatar.png'; // Ruta al avatar por defecto
            } else {
                // Restaurar el avatar original
                if (socket.userData.original_avatar_url) {
                    socket.userData.avatar_url = socket.userData.original_avatar_url;
                    delete socket.userData.original_avatar_url;
                }
            }

            // Si el nick cambió, necesitamos actualizar allUsersData en el cliente
            // Y también la cookie de sesión para que el middleware isCurrentUser no falle
            if (nickChanged) {
                socket.emit('user_data_updated', {
                    oldNick: oldNick,
                    nick: socket.userData.nick,
                    isIncognito: socket.userData.isIncognito,
                    avatar_url: socket.userData.avatar_url // Incluir el avatar actualizado
                });
                // Actualizar la cookie de sesión con el nick actual
                socket.emit('set session cookie', {
                    id: socket.userData.id,
                    nick: socket.userData.nick, // Usar el nick actual (incognito o restaurado)
                    role: socket.userData.role
                });
            } else {
                socket.emit('user_data_updated', {
                    nick: socket.userData.nick,
                    isIncognito: socket.userData.isIncognito,
                    avatar_url: socket.userData.avatar_url // Incluir el avatar actualizado
                });
                // Si no hubo cambio de nick, pero el estado de incognito cambió,
                // la cookie ya debería tener el nick correcto.
                // No es estrictamente necesario emitir 'set session cookie' aquí
                // a menos que el cliente necesite la cookie actualizada por alguna razón.
                // Pero para simplificar y asegurar consistencia, lo haremos.
                socket.emit('set session cookie', {
                    id: socket.userData.id,
                    nick: socket.userData.nick,
                    role: socket.userData.role
                });
            }
            
            roomService.updateUserDataInAllRooms(socket);

            socket.joinedRooms.forEach(room => {
                if (room !== socket.id) {
                    roomService.updateUserList(io, room);
                }
            });
            // No system message for incognito to keep it discreet
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