const userService = require('../services/userService');
const banService = require('../services/banService');
const roomService = require('../services/roomService');
const permissionService = require('../services/permissionService');
const db = require('../services/db-connection').getInstance();
const fetch = require('node-fetch');
const config = require('../config');
const ms = require('ms');

function obfuscateIP(ip) {
    if (!ip) return 'N/A';
    if (ip === '::1' || ip === '127.0.0.1') return ip;
    if (ip.includes(':')) {
        const parts = ip.split(':');
        return parts.length > 4 ? parts.slice(0, 4).join(':') + ':xxxx:xxxx' : ip;
    }
    if (ip.includes('.')) {
        const parts = ip.split('.');
        return parts.length === 4 ? parts.slice(0, 2).join('.') + '.x.x' : ip;
    }
    return 'IP Inválida';
}


async function handleCommand(io, socket, text, currentRoom) {
    const args = text.split(' ');
    const command = args[0].toLowerCase();
    const sender = socket.userData;

    if (command === '/avatar') {
        const avatarUrl = args[1];

        if (sender.role !== 'guest') {
            return socket.emit('system message', { text: 'Los usuarios registrados deben cambiar su avatar desde el panel "Mi Perfil".', type: 'error' });
        }

        if (!avatarUrl) {
            return socket.emit('system message', { text: 'Uso: /avatar <URL de la imagen>', type: 'error' });
        }

        const urlRegex = /^(https?:\/\/[^\s]+(\.jpg|\.jpeg|\.png|\.gif|\.webp))$/i;
        if (!urlRegex.test(avatarUrl)) {
            return socket.emit('system message', { text: 'La URL proporcionada no parece ser una imagen válida (debe terminar en .jpg, .png, .gif, etc.).', type: 'error' });
        }

        socket.userData.avatar_url = avatarUrl;
        
        // --- AÑADIDO: Sincronizar estado del avatar en el servidor ---
        roomService.updateUserDataInAllRooms(socket);

        io.emit('user_data_updated', {
            nick: sender.nick,
            avatar_url: avatarUrl
        });

        socket.emit('system message', { text: '¡Tu avatar ha sido actualizado!', type: 'highlight' });

        io.to(roomService.MOD_LOG_ROOM).emit('system message', {
            text: `[AVATAR] El invitado ${sender.nick} ha establecido un nuevo avatar.`,
            type: 'mod-log',
            roomName: roomService.MOD_LOG_ROOM
        });
        
        return;
    }

    if (command === '/staff') {
        const staffOnline = {};
        const allSockets = await io.fetchSockets();
        const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'guest': 5 };
        for (const sock of allSockets) {
            if (!sock.userData || !sock.userData.id) continue;
            let highestRole = sock.userData.role;
            let staffInRooms = new Set();
            for (const room of sock.joinedRooms) {
                if (room === sock.id || room === roomService.MOD_LOG_ROOM) continue;
                const effectiveRole = await permissionService.getUserEffectiveRole(sock.userData.id, room);
                if (['owner', 'admin', 'mod', 'operator'].includes(effectiveRole)) {
                    staffInRooms.add(room);
                    if (roleOrder[effectiveRole] < roleOrder[highestRole]) {
                        highestRole = effectiveRole;
                    }
                }
            }
            if (['owner', 'admin', 'mod', 'operator'].includes(sock.userData.role)) {
                 sock.joinedRooms.forEach(room => {
                    if (room !== sock.id && room !== roomService.MOD_LOG_ROOM) {
                        staffInRooms.add(room);
                    }
                });
            }
            if (staffInRooms.size > 0) {
                const nick = sock.userData.nick;
                staffOnline[nick] = {
                    role: highestRole,
                    rooms: Array.from(staffInRooms)
                };
            }
        }
        let staffMessage = '\n--- Staff Conectado ---\n';
        const staffList = Object.keys(staffOnline);
        if (staffList.length === 0) {
            staffMessage += 'No hay miembros del staff conectados en este momento.';
        } else {
            staffList.sort((a, b) => {
                const roleA = roleOrder[staffOnline[a].role];
                const roleB = roleOrder[staffOnline[b].role];
                return roleA - roleB || a.localeCompare(b);
            });
            staffList.forEach(nick => {
                const staffInfo = staffOnline[nick];
                const rooms = staffInfo.rooms.join(', ');
                const displayRole = { 'owner': 'Owner', 'admin': 'Admin', 'mod': 'Moderador', 'operator': 'Operador' }[staffInfo.role] || 'Staff';
                staffMessage += `▪️ ${nick} (${displayRole}) - En salas: ${rooms || 'Ninguna'}\n`;
            });
        }
        
        db.all('SELECT name, creatorNick FROM rooms', [], (err, createdRooms) => {
            if (err) {
                console.error("Error al obtener salas creadas:", err);
                socket.emit('system message', { text: staffMessage, type: 'highlight', roomName: currentRoom });
                return;
            }

            if (createdRooms.length > 0) {
                staffMessage += '\n\n--- Salas Creadas por Usuarios ---\n';
                createdRooms.forEach(room => {
                    staffMessage += `▪️ Sala: ${room.name} - Creador: ${room.creatorNick}\n`;
                });
            }
            
            socket.emit('system message', { text: staffMessage, type: 'highlight', roomName: currentRoom });
        });
        return;
    }

    if (command === '/nick') {
        // --- INICIO DE LA CORRECCIÓN COMPLETA ---
        const newNick = args[1];
        if (sender.role !== 'guest') {
            return socket.emit('system message', { text: 'Los usuarios registrados deben cambiar su nick desde el panel "Mi Perfil".', type: 'error' });
        }
        if (!newNick || newNick.length < 3 || newNick.length > 15 || !/^[a-zA-Z0-9_-]+$/.test(newNick)) {
             return socket.emit('system message', { text: 'Nick inválido. Debe tener entre 3 y 15 caracteres y solo puede contener letras, números, guiones y guiones bajos.', type: 'error' });
        }
        if (newNick.toLowerCase() === sender.nick.toLowerCase()) {
            return socket.emit('system message', { text: 'Ya estás usando ese nick.', type: 'error' });
        }
        const isRegistered = await userService.findUserByNick(newNick);
        if (isRegistered) {
            return socket.emit('system message', { text: `El nick '${newNick}' está registrado. No puedes usarlo.`, type: 'error' });
        }
        if (roomService.isNickInUse(newNick)) {
            return socket.emit('system message', { text: `El nick '${newNick}' ya está en uso por otro usuario.`, type: 'error' });
        }
        const oldNick = sender.nick;
        
        // 1. Actualizar el estado principal del socket
        socket.userData.nick = newNick;
        
        // 2. Sincronizar el estado actualizado en todas las salas del servidor
        roomService.updateUserDataInAllRooms(socket);
        
        // 3. Enviar evento para que el cliente actualice su cookie
        socket.emit('set session cookie', { id: socket.userData.id, nick: newNick, role: socket.userData.role });
        
        // 4. Anunciar el cambio a todos
        io.emit('system message', { text: `${oldNick} ahora es conocido como ${newNick}.`, type: 'highlight' });
        
        // 5. Emitir evento global para cambios cosméticos
        io.emit('user_data_updated', { oldNick: oldNick, nick: newNick });
        
        // 6. Forzar la re-emisión de la lista de usuarios en todas las salas del usuario
        socket.joinedRooms.forEach(room => {
            if (room !== socket.id) {
                roomService.updateUserList(io, room);
            }
        });
        // --- FIN DE LA CORRECCIÓN COMPLETA ---
        return;
    }

    if (command === '/crear') {
        if (sender.role === 'guest') {
            return socket.emit('system message', { text: 'Solo los usuarios registrados pueden crear salas.', type: 'error', roomName: currentRoom });
        }
        const newRoomName = args[1];
        if (!newRoomName || !/^[a-zA-Z0-9\-_#]{3,20}$/.test(newRoomName)) {
            return socket.emit('system message', { text: 'Nombre de sala inválido. Debe tener entre 3-20 caracteres y solo letras, números, -, _, #.', type: 'error', roomName: currentRoom });
        }

        const wasCreated = await roomService.createRoom(newRoomName, sender, io);
        if (!wasCreated) {
            return socket.emit('system message', { text: `La sala '${newRoomName}' ya existe. Intenta unirte a ella.`, type: 'error', roomName: currentRoom });
        }

        const operatorStmt = db.prepare('INSERT OR IGNORE INTO room_staff (userId, roomName, role, assignedBy, assignedAt) VALUES (?, ?, ?, ?, ?)');
        operatorStmt.run(sender.id, newRoomName, 'operator', sender.nick, new Date().toISOString());
        operatorStmt.finalize();

        io.to(currentRoom).emit('system message', { text: `¡${sender.nick} ha creado una nueva sala: ${newRoomName}!`, type: 'highlight', roomName: currentRoom });
        socket.emit('join room', { roomName: newRoomName });
        socket.emit('room_created_success');
        io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[SALA CREADA] ${sender.nick} ha creado la sala: ${newRoomName}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        return;
    }
    
    const targetNick = args[1];
    const senderEffectiveRole = await permissionService.getUserEffectiveRole(sender.id, currentRoom);
    const commandPermissions = {
        '/help': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/help - Muestra esta lista de comandos.' },
        '/kick': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/kick <nick> [razón] - Expulsa a un usuario de la sala actual.' },
        '/ban': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/ban <nick> [razón] - Banea permanentemente a un usuario.' },
        '/mute': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/mute <nick> - Silencia o des-silencia a un usuario en el chat.' },
        '/whois': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/whois <nick> - Muestra información detallada de un usuario.' },
        '/unban': { roles: ['owner', 'admin', 'mod', 'operator'], description: '/unban <nick> - Quita el ban a un usuario.' },
        '/vip': { roles: ['owner', 'admin'], description: '/vip <nick> - Otorga o quita el estatus VIP a un usuario registrado.' },
        '/promote': { roles: ['owner', 'admin'], description: '/promote <nick> <rol> [sala] - Asciende a un usuario a mod/admin/operator (global o en sala).' },
        '/demote': { roles: ['owner', 'admin'], description: '/demote <nick> [sala] - Degrada a un usuario a rol normal (global o en sala).' },
        '/delsala': { roles: ['owner', 'admin'], description: '/delsala <nombre-sala> - Elimina una sala del chat.' },
        '/global': { roles: ['owner', 'admin'], description: '/global <mensaje> - Envía un anuncio a todas las salas activas.' }
    };

    if (!commandPermissions[command]) {
        return socket.emit('system message', { text: `Comando '${command}' no reconocido.`, type: 'error', roomName: currentRoom });
    }
    if (!commandPermissions[command].roles.includes(senderEffectiveRole)) {
        return socket.emit('system message', { text: 'No tienes permiso para usar este comando.', type: 'error', roomName: currentRoom });
    }
    
    const requiresTarget = !['/help', '/global'].includes(command);
    if (requiresTarget && !targetNick) {
        return socket.emit('system message', { text: `Uso incorrecto. Sintaxis: ${commandPermissions[command].description}`, type: 'error', roomName: currentRoom });
    }
    if (targetNick && sender.nick.toLowerCase() === targetNick.toLowerCase()) {
        return socket.emit('system message', { text: 'No puedes aplicarte un comando a ti mismo.', type: 'error', roomName: currentRoom });
    }
    
    const targetSocketId = targetNick ? roomService.findSocketIdByNick(targetNick) : null;
    let targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;
    if (!targetSocket && targetNick) {
        const allSockets = await io.fetchSockets();
        for (const sock of allSockets) {
            if (sock.userData && sock.userData.nick.toLowerCase() === targetNick.toLowerCase()) {
                targetSocket = sock;
                break;
            }
        }
    }
    
    switch (command) {
        case '/help': {
            let helpMessage = 'Comandos disponibles para tu rol:\n\n';
            helpMessage += '▪️ /staff - Muestra el staff conectado.\n';
            helpMessage += '▪️ /nick <nuevo-nick> - Cambia tu nick (solo para invitados).\n';
            helpMessage += '▪️ /crear <nombre-sala> - Crea una nueva sala de chat.\n'
            for (const cmd in commandPermissions) {
                if (commandPermissions[cmd].roles.includes(senderEffectiveRole)) {
                    helpMessage += `▪️ ${commandPermissions[cmd].description}\n`;
                }
            }
            socket.emit('system message', { text: helpMessage, type: 'highlight', roomName: currentRoom });
            break;
        }

        case '/global': {
            if (sender.role !== 'owner' && sender.role !== 'admin') {
                return socket.emit('system message', { text: 'No tienes permiso para usar este comando.', type: 'error', roomName: currentRoom });
            }

            const message = args.slice(1).join(' ');
            if (!message) {
                return socket.emit('system message', { text: 'Uso: /global <mensaje>', type: 'error', roomName: currentRoom });
            }

            const announcement = `[📢 ANUNCIO GLOBAL de ${sender.nick}]: ${message}`;

            io.emit('system message', {
                text: announcement,
                type: 'highlight' 
            });

            io.to(roomService.MOD_LOG_ROOM).emit('system message', {
                text: `[GLOBAL] ${sender.nick} envió un anuncio global: "${message}"`,
                type: 'mod-log',
                roomName: roomService.MOD_LOG_ROOM
            });

            socket.emit('system message', { text: 'Tu anuncio global ha sido enviado correctamente.', type: 'highlight', roomName: currentRoom });

            return;
        }

        case '/delsala': {
            const roomToDelete = args[1];
            if (!roomToDelete || !roomService.rooms[roomToDelete] || roomService.DEFAULT_ROOMS.includes(roomToDelete)) {
                return socket.emit('system message', { text: 'Uso: /delsala <nombre-sala-existente-y-no-default>', type: 'error', roomName: currentRoom });
            }
            const reason = args.slice(2).join(' ') || 'Sala eliminada por un administrador.';
            io.to(roomToDelete).emit('system message', { text: `Esta sala ha sido eliminada por ${sender.nick}. Razón: ${reason}`, type: 'error'});
            io.in(roomToDelete).socketsLeave(roomToDelete);
            delete roomService.rooms[roomToDelete];
            db.run('DELETE FROM rooms WHERE name = ?', [roomToDelete]);
            roomService.updateRoomData(io);
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[SALA ELIMINADA] ${sender.nick} eliminó la sala '${roomToDelete}'. Razón: ${reason}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            socket.emit('system message', { text: `Sala '${roomToDelete}' eliminada correctamente.`, type: 'highlight' });
            break;
        }
            
        case '/whois': {
            let whoisData = null;
            let isOnline = !!targetSocket;
            if (targetSocket) {
                whoisData = targetSocket.userData;
            } else {
                const dbUser = await userService.findUserByNick(targetNick);
                if (dbUser) {
                    whoisData = {
                        id: dbUser.id,
                        nick: dbUser.nick,
                        role: dbUser.role,
                        isVIP: dbUser.isVIP === 1,
                        ip: dbUser.lastIP
                    };
                }
            }
            if (!whoisData) {
                const lastLog = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM activity_logs WHERE nick = ? ORDER BY timestamp DESC LIMIT 1", [targetNick], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    });
                });
                if (lastLog) {
                    whoisData = {
                        id: lastLog.userId,
                        nick: lastLog.nick,
                        role: lastLog.userRole,
                        isVIP: false,
                        ip: lastLog.ip
                    };
                }
            }
            if (!whoisData) {
                 return socket.emit('system message', { text: `No se encontró información para '${targetNick}'.`, type: 'error', roomName: currentRoom });
            }
            async function getGeoLocation(ip) {
                if (!config.proxyCheckApiKey || !ip || ip.startsWith('192.168') || ip.startsWith('10.') || ip === '127.0.0.1' || ip === '::1') {
                    return null;
                }
                try {
                    const response = await fetch(`https://proxycheck.io/v2/${ip}?key=${config.proxyCheckApiKey}&asn=1`);
                    const data = await response.json();
                    if (data.status === 'ok' && data[ip]) {
                        return { country: data[ip].country || 'Desconocido', continent: data[ip].continent || 'Desconocido' };
                    }
                    return null;
                } catch (error) {
                    return null;
                }
            }
            const [lastConnectLog, lastDisconnectLog, banInfo, geoData] = await Promise.all([
                new Promise(resolve => db.get("SELECT timestamp FROM activity_logs WHERE nick = ? AND event_type = 'CONNECT' ORDER BY timestamp DESC LIMIT 1", [whoisData.nick], (e, r) => resolve(r))),
                new Promise(resolve => db.get("SELECT timestamp FROM activity_logs WHERE nick = ? AND event_type = 'DISCONNECT' ORDER BY timestamp DESC LIMIT 1", [whoisData.nick], (e, r) => resolve(r))),
                banService.isUserBanned(whoisData.role === 'guest' ? whoisData.id : whoisData.nick.toLowerCase()),
                getGeoLocation(whoisData.ip)
            ]);
            const ipToShow = ['owner', 'admin'].includes(sender.role) ? whoisData.ip : obfuscateIP(whoisData.ip);
            let whoisMsg = `\n--- Información de ${whoisData.nick} ---\n`;
            whoisMsg += `ID: ${whoisData.id}\n`;
            whoisMsg += `Rol: ${whoisData.role || 'user'}\n`;
            whoisMsg += `Estado: ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
            if (lastConnectLog) whoisMsg += `Última conexión: ${new Date(lastConnectLog.timestamp).toLocaleString('es-ES')}\n`;
            if (!isOnline && lastDisconnectLog) {
                const timeAgo = ms(Date.now() - new Date(lastDisconnectLog.timestamp).getTime(), { long: true });
                whoisMsg += `Desconectado hace: ${timeAgo}\n`;
            }
            whoisMsg += `Última IP: ${ipToShow}\n`;
            if (geoData) whoisMsg += `País: ${geoData.country} (${geoData.continent})\n`;
            whoisMsg += `Baneado: ${banInfo ? `Sí (por ${banInfo.by})` : 'No'}\n`;
            if (banInfo) whoisMsg += `Razón del ban: ${banInfo.reason}\n`;
            socket.emit('system message', { text: whoisMsg, type: 'highlight', roomName: currentRoom });
            break;
        }
        
        default: {
           
            const dbUser = await userService.findUserByNick(targetNick);
            if (!dbUser && !targetSocket) {
                return socket.emit('system message', { text: `No se encontró al usuario '${targetNick}'.`, type: 'error', roomName: currentRoom });
            }
            const rolesOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'vip': 4, 'guest': 5 };
            const targetEffectiveRole = dbUser ? await permissionService.getUserEffectiveRole(dbUser.id, currentRoom) : (targetSocket ? 'guest' : 'user');
            if (rolesOrder[senderEffectiveRole] >= rolesOrder[targetEffectiveRole]) {
                return socket.emit('system message', { text: 'No puedes ejecutar acciones sobre un usuario de tu mismo rango o superior en esta sala.', type: 'error', roomName: currentRoom });
            }
            if (command === '/kick') {
                if (!targetSocket) return socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra conectado.`, type: 'error', roomName: currentRoom });
                if (!targetSocket.rooms.has(currentRoom)) return socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra en esta sala.`, type: 'error', roomName: currentRoom });
                const kickReason = args.slice(2).join(' ') || 'No se especificó una razón.';
                const kickPayload = { roomName: currentRoom, by: sender.nick, reason: kickReason };
                targetSocket.emit('kicked_from_room', kickPayload);
                targetSocket.leave(currentRoom);
                if (targetSocket.joinedRooms) {
                    targetSocket.joinedRooms.delete(currentRoom);
                }
                targetSocket.emit('leave_success', { roomName: currentRoom, joinedRooms: Array.from(targetSocket.joinedRooms || []) });
                if (roomService.rooms[currentRoom] && roomService.rooms[currentRoom].users[targetSocket.id]) {
                    delete roomService.rooms[currentRoom].users[targetSocket.id];
                }
                io.to(currentRoom).emit('system message', { text: `${targetNick} ha sido expulsado de la sala por ${sender.nick}. Razón: ${kickReason}`, type: 'warning', roomName: currentRoom });
                roomService.updateUserList(io, currentRoom);
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[KICK] ${sender.nick} expulsó a ${targetNick} de la sala ${currentRoom}. Razón: ${kickReason}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            }

            if (command === '/ban') {
                const userToBan = targetSocket ? targetSocket.userData : dbUser;
                const reasonBan = args.slice(2).join(' ') || 'No se especificó una razón.';
                const isGuest = userToBan.role === 'guest';
                const banId = isGuest ? userToBan.id : userToBan.nick.toLowerCase();
                const banNick = userToBan.nick;
                const banIp = userToBan.ip || (dbUser ? dbUser.lastIP : null);
                await banService.banUser(banId, banNick, banIp, reasonBan, sender.nick);
                if (isGuest && banIp) {
                    await banService.banUser(banIp, banNick, banIp, `(Baneo por IP) ${reasonBan}`, sender.nick);
                }
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[BAN] ${sender.nick} BANEÓ a ${banNick}. Razón: ${reasonBan}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                if (targetSocket) {
                    targetSocket.joinedRooms.forEach(room => {
                        if (room !== targetSocket.id) {
                            io.to(room).emit('system message', { text: `${targetNick} ha sido BANEADO permanentemente por ${sender.nick}.`, type: 'error', roomName: room });
                        }
                    });
                    targetSocket.emit('system message', { text: `Has sido baneado permanentemente. Razón: ${reasonBan}`, type: 'error' });
                    targetSocket.disconnect(true);
                } else {
                    io.emit('system message', { text: `${banNick} ha sido BANEADO permanentemente por ${sender.nick}.`, type: 'error' });
                }
                io.emit('admin panel refresh');
            }
            
            if (command === '/unban') {
                await banService.unbanUser(targetNick.toLowerCase());
                await banService.unbanUser(targetNick);
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[UNBAN] ${sender.nick} DESBANEÓ a ${targetNick}.`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                io.emit('system message', { text: `${targetNick} ha sido DESBANEADO por ${sender.nick}.`, type: 'highlight' });
                io.emit('admin panel refresh');
            }

            if (command === '/mute') {
                if (!targetSocket) return socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra conectado.`, type: 'error', roomName: currentRoom });
                const targetIsRegistered = targetSocket.userData.role !== 'guest';
                const newMuteStatus = !targetSocket.userData.isMuted;
                targetSocket.userData.isMuted = newMuteStatus;
                targetSocket.userData.mutedBy = newMuteStatus ? sender.nick : null;
                if (targetIsRegistered) {
                    await userService.setMuteStatus(targetNick, newMuteStatus, sender.nick);
                }
                const actionTextMute = newMuteStatus ? 'silenciado' : 'des-silenciado';
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[MUTE] ${sender.nick} ha ${actionTextMute} a ${targetNick}.`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                io.emit('system message', { text: `${targetNick} ha sido ${actionTextMute} por un moderador.`, type: 'warning' });
                targetSocket.emit('system message', { text: `Has sido ${actionTextMute} por ${sender.nick}.`, type: 'warning' });
                io.emit('admin panel refresh');
            }

            if (command === '/vip') {
                if (!dbUser) return socket.emit('system message', { text: `Solo los usuarios registrados pueden ser VIP.`, type: 'error', roomName: currentRoom });
                const newVipStatus = !(dbUser.isVIP === 1);
                await userService.setVipStatus(dbUser.nick, newVipStatus);
                const actionTextVip = newVipStatus ? 'AHORA ES VIP' : 'YA NO ES VIP';
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[VIP] ${dbUser.nick} ${actionTextVip} (por ${sender.nick})`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                io.emit('system message', { text: `El usuario ${dbUser.nick} ${actionTextVip}.`, type: 'highlight' });
                if (targetSocket) {
                    targetSocket.userData.isVIP = newVipStatus;
                    io.emit('user_data_updated', { nick: dbUser.nick, isVIP: newVipStatus });
                }
            }

            if (command === '/promote') {
                const newRole = (args[2] || '').toLowerCase();
                const specificRoom = args[3];
                if (!dbUser) return socket.emit('system message', { text: `El usuario '${targetNick}' debe estar registrado.`, type: 'error', roomName: currentRoom });
                if (!['admin', 'mod', 'operator'].includes(newRole)) return socket.emit('system message', { text: `Rol '${newRole}' no válido. Roles permitidos: admin, mod, operator.`, type: 'error', roomName: currentRoom });
                if (newRole === 'admin' && sender.role !== 'owner') return socket.emit('system message', { text: 'Solo el Owner puede nombrar administradores.', type: 'error', roomName: currentRoom });
                if (specificRoom) {
                    if (!roomService.rooms[specificRoom]) return socket.emit('system message', { text: `La sala '${specificRoom}' no existe.`, type: 'error', roomName: currentRoom });
                    const stmt = db.prepare('INSERT OR REPLACE INTO room_staff (userId, roomName, role, assignedBy, assignedAt) VALUES (?, ?, ?, ?, ?)');
                    stmt.run(dbUser.id, specificRoom, newRole, sender.nick, new Date().toISOString());
                    stmt.finalize();
                    const successMsg = `${targetNick} ha sido promovido a ${newRole} en la sala ${specificRoom} por ${sender.nick}.`;
                    io.to(currentRoom).emit('system message', { text: successMsg, type: 'highlight' });
                    io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[PROMOTE-SALA] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                } else {
                    if (newRole === 'admin') {
                        if (targetSocket) {
                            console.log(`[DEBUG] Found target socket for ${targetNick}. Socket ID: ${targetSocket.id}`);
                            const agreementText = `ACUERDO DE CONFIDENCIALIDAD

Entre: Owner (mundochat) y el usuario interesado (nuevo Admin)

Ambas partes acuerdan lo siguiente:

1. Toda la información compartida entre las partes de manera escrita o por cualquier medio (audio o imágenes), relacionada con el chat o con el resto de usuarios/as de las diferentes salas, será considerada confidencial.

2. No se podrá divulgar, compartir ni utilizar dicha información para fines distintos que no sean los relacionados con el chat.

3. El compromiso de confidencialidad permanecerá vigente mientras dure la actividad de dicho usuario (nuevo Admin) en el chat.

4. En caso de incumplimiento, será cesado de su rol de Admin y expulsado inmediatamente dando por finalizada cualquier relación que tuviera en dicho chat.

5. Y para que quede constancia de la aceptación de dicho contrato, si está de acuerdo, acepte las condiciones más abajo.`;
                            io.emit('admin_agreement_required', {
                                text: agreementText,
                                targetNick: targetNick,
                                senderNick: sender.nick
                            });
                            console.log(`[DEBUG] Emitted 'admin_agreement_required' to ${targetNick}.`);
                            socket.emit('system message', { text: `Se ha enviado una solicitud de confirmación a ${targetNick} para el rol de admin.`, type: 'highlight' });
                        } else {
                            console.log(`[DEBUG] Could not find target socket for ${targetNick}.`);
                            socket.emit('system message', { text: `El usuario ${targetNick} no está conectado para aceptar el acuerdo de confidencialidad.`, type: 'error' });
                        }
                    } else {
                        await userService.setUserRole(targetNick, newRole);
                        const successMsg = `${targetNick} ha sido promovido a ${newRole} (global) por ${sender.nick}.`;
                        io.emit('system message', { text: successMsg, type: 'highlight' });
                        io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[PROMOTE-GLOBAL] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                        if (targetSocket) {
                            targetSocket.userData.role = newRole;
                            io.emit('user_data_updated', { nick: dbUser.nick, role: newRole });
                        }
                    }
                }
            }

            if (command === '/demote') {
                const roomToDemote = args[2];
                if (!dbUser) return socket.emit('system message', { text: `El usuario '${targetNick}' debe estar registrado.`, type: 'error', roomName: currentRoom });
                if (roomToDemote) {
                    if (!roomService.rooms[roomToDemote]) return socket.emit('system message', { text: `La sala '${roomToDemote}' no existe.`, type: 'error', roomName: currentRoom });
                    db.run('DELETE FROM room_staff WHERE userId = ? AND roomName = ?', [dbUser.id, roomToDemote]);
                    const successMsg = `Los permisos de ${targetNick} en la sala ${roomToDemote} han sido revocados por ${sender.nick}.`;
                    io.to(currentRoom).emit('system message', { text: successMsg, type: 'warning' });
                    io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[DEMOTE-SALA] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                } else {
                    if (dbUser.role === 'user') return socket.emit('system message', { text: `${targetNick} ya es un usuario normal.`, type: 'error' });
                    await userService.setUserRole(targetNick, 'user');
                    const successMsg = `${targetNick} ha sido degradado a usuario normal (global) por ${sender.nick}.`;
                    io.emit('system message', { text: successMsg, type: 'warning' });
                    io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[DEMOTE-GLOBAL] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                    if (targetSocket) {
                        targetSocket.userData.role = 'user';
                        io.emit('user_data_updated', { nick: dbUser.nick, role: 'user' });
                    }
                }
            }
            break;
        }
    }
}

module.exports = { handleCommand };