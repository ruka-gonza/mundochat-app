// handlers/modHandler.js (LIMPIADO: Eliminado require de sqlite3)
const userService = require('../services/userService');
const banService = require('../services/banService');
const roomService = require('../services/roomService');
// La siguiente línea se elimina porque ya no usamos sqlite3 directamente aquí.
// const sqlite3 = require('sqlite3').verbose(); 

// No necesitamos la conexión a la DB aquí porque los servicios ya la manejan.

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
    // ... el resto del archivo es idéntico y no cambia
    const args = text.split(' ');
    const command = args[0].toLowerCase();

    if (command === '/crear') {
        const sender = socket.userData;
        if (sender.role === 'guest') {
            return socket.emit('system message', { text: 'Solo los usuarios registrados pueden crear salas.', type: 'error', roomName: currentRoom });
        }
        
        const newRoomName = args[1];
        
        if (!newRoomName) {
            return socket.emit('system message', { text: 'Uso: /crear <nombre-de-la-sala>', type: 'error', roomName: currentRoom });
        }

        if (!/^[a-zA-Z0-9\-_#]{3,20}$/.test(newRoomName)) {
            return socket.emit('system message', { text: 'El nombre de la sala solo puede contener letras, números, guiones (-), guiones bajos (_) y el símbolo #. Debe tener entre 3 y 20 caracteres.', type: 'error', roomName: currentRoom });
        }

        const wasCreated = roomService.createRoom(newRoomName, io);

        if (!wasCreated) {
            return socket.emit('system message', { text: `La sala '${newRoomName}' ya existe. Intenta unirte a ella.`, type: 'error', roomName: currentRoom });
        }
        
        const announcementRoom = currentRoom; 
        const announcementText = `¡${sender.nick} ha creado una nueva sala: ${newRoomName}!`;
        io.to(announcementRoom).emit('system message', { 
            text: announcementText, 
            type: 'highlight',
            roomName: announcementRoom 
        });

        socket.emit('join room', { roomName: newRoomName });
        
        io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[SALA CREADA] ${sender.nick} ha creado la sala: ${newRoomName}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        
        return;
    }

    const targetNick = args[1];
    const reasonOrRole = args.slice(2).join(' ') || 'No se especificó una razón.';

    const sender = socket.userData;
    const senderRole = sender.role;
    const rolesOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'user': 3, 'vip': 3, 'guest': 4 };

    const commandPermissions = {
        '/help': { roles: ['owner', 'admin', 'mod'], description: '/help - Muestra esta lista de comandos.' },
        '/kick': { roles: ['owner', 'admin', 'mod'], description: '/kick <nick> [razón] - Expulsa a un usuario del chat.' },
        '/ban': { roles: ['owner', 'admin', 'mod'], description: '/ban <nick> [razón] - Banea permanentemente a un usuario.' },
        '/mute': { roles: ['owner', 'admin', 'mod'], description: '/mute <nick> - Silencia o des-silencia a un usuario en el chat.' },
        '/whois': { roles: ['owner', 'admin', 'mod'], description: '/whois <nick> - Muestra información detallada de un usuario.' },
        '/unban': { roles: ['owner', 'admin'], description: '/unban <nick> - Quita el ban a un usuario.' },
        '/vip': { roles: ['owner', 'admin'], description: '/vip <nick> - Otorga o quita el estatus VIP a un usuario registrado.' },
        '/promote': { roles: ['owner', 'admin'], description: '/promote <nick> <rol> - Asciende a un usuario (roles: admin, mod).' },
        '/demote': { roles: ['owner', 'admin'], description: '/demote <nick> - Degrada a un admin o mod a usuario normal.' },
        '/delsala': { roles: ['owner', 'admin'], description: '/delsala <nombre-sala> - Elimina una sala del chat.' }
    };
    
    if (!commandPermissions[command]) {
        return socket.emit('system message', { text: `Comando '${command}' no reconocido. Usa /help para ver la lista.`, type: 'error', roomName: currentRoom });
    }
    if (!commandPermissions[command].roles.includes(senderRole)) {
        return socket.emit('system message', { text: 'No tienes permiso para usar este comando.', type: 'error', roomName: currentRoom });
    }

    if (command === '/delsala') {
        const roomToDelete = args[1];
        if (!roomToDelete) {
            return socket.emit('system message', { text: 'Uso: /delsala <nombre-de-la-sala>', type: 'error', roomName: currentRoom });
        }
        if (!roomService.rooms[roomToDelete]) {
            return socket.emit('system message', { text: `La sala '${roomToDelete}' no existe.`, type: 'error', roomName: currentRoom });
        }
        if (roomService.DEFAULT_ROOMS.includes(roomToDelete)) {
            return socket.emit('system message', { text: 'No puedes eliminar una sala por defecto.', type: 'error', roomName: currentRoom });
        }

        const reason = args.slice(2).join(' ') || 'Sala eliminada por un administrador.';
        
        io.to(roomToDelete).emit('system message', { text: `Esta sala ha sido eliminada por ${sender.nick}. Razón: ${reason}`, type: 'error'});
        io.in(roomToDelete).socketsLeave(roomToDelete);

        delete roomService.rooms[roomToDelete];
        roomService.updateRoomData(io);

        const logMsg = `[SALA ELIMINADA] ${sender.nick} eliminó la sala '${roomToDelete}'. Razón: ${reason}`;
        io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: logMsg, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        socket.emit('system message', { text: `Sala '${roomToDelete}' eliminada correctamente.`, type: 'highlight' });
        return;
    }

    const requiresTarget = !['/help'].includes(command);
    if (requiresTarget && !targetNick) {
        return socket.emit('system message', { text: `Uso incorrecto. Sintaxis: ${commandPermissions[command].description}`, type: 'error', roomName: currentRoom });
    }
    if (targetNick && sender.nick.toLowerCase() === targetNick.toLowerCase()) {
        return socket.emit('system message', { text: 'No puedes aplicarte un comando a ti mismo.', type: 'error', roomName: currentRoom });
    }
    
    const targetSocketId = targetNick ? roomService.findSocketIdByNick(targetNick) : null;
    const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;
    const dbUser = targetNick ? await userService.findUserByNick(targetNick) : null;
    const targetRole = targetSocket ? targetSocket.userData.role : (dbUser ? (dbUser.role || 'user') : 'guest');
    
    if (requiresTarget && !dbUser && targetRole === 'guest' && !['/kick', '/ban', '/mute', '/whois'].includes(command)) {
        return socket.emit('system message', { text: `La acción solo puede realizarse sobre usuarios registrados. '${targetNick}' es un invitado.`, type: 'error', roomName: currentRoom });
    }
    
    if (requiresTarget && rolesOrder[senderRole] >= rolesOrder[targetRole]) {
         return socket.emit('system message', { text: 'No puedes ejecutar acciones sobre un usuario de tu mismo rango o superior.', type: 'error', roomName: currentRoom });
    }

    switch (command) {
        case '/help':
            let helpMessage = 'Comandos disponibles para tu rol:\n\n';
            helpMessage += '▪️ /crear <nombre-sala> - Crea una nueva sala de chat.\n'
            for (const cmd in commandPermissions) {
                if (commandPermissions[cmd].roles.includes(senderRole)) {
                    helpMessage += `▪️ ${commandPermissions[cmd].description}\n`;
                }
            }
            socket.emit('system message', { text: helpMessage, type: 'highlight', roomName: currentRoom });
            break;

        case '/kick':
            if (!targetSocket) return socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra conectado.`, type: 'error', roomName: currentRoom });
            
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[KICK] ${sender.nick} expulsó a ${targetNick}. Razón: ${reasonOrRole}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            
            const roomsToUpdateKick = Array.from(targetSocket.rooms);
            roomsToUpdateKick.forEach(room => {
                if(room !== targetSocket.id) {
                    io.to(room).emit('system message', { text: `${targetNick} fue expulsado por ${sender.nick}. Razón: ${reasonOrRole}`, type: 'warning', roomName: room });
                    delete roomService.rooms[room].users[targetSocket.id];
                    roomService.updateUserList(io, room);
                }
            });
            targetSocket.emit('system message', { text: `Has sido expulsado por ${sender.nick}. Razón: ${reasonOrRole}`, type: 'error' });
            targetSocket.disconnect(true);
            break;
        
        case '/ban':
            const userToBan = targetSocket ? targetSocket.userData : dbUser;
            if (!userToBan) return socket.emit('system message', { text: `No se encontró al usuario '${targetNick}'.`, type: 'error', roomName: currentRoom });
            
            const isGuest = userToBan.role === 'guest';
            const banId = isGuest ? userToBan.id : userToBan.nick.toLowerCase();
            const banNick = userToBan.nick;
            const banIp = userToBan.ip || (dbUser ? dbUser.lastIP : null);

            await banService.banUser(banId, banNick, banIp, reasonOrRole, sender.nick);

            if (isGuest && banIp) {
                await banService.banUser(banIp, banNick, banIp, `(Baneo por IP) ${reasonOrRole}`, sender.nick);
            }
            
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[BAN] ${sender.nick} BANEÓ a ${banNick}. Razón: ${reasonOrRole}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            
            if (targetSocket) {
                const roomsToUpdateBan = Array.from(targetSocket.rooms);
                roomsToUpdateBan.forEach(room => {
                    if(room !== targetSocket.id) {
                        io.to(room).emit('system message', { text: `${targetNick} ha sido BANEADO permanentemente por ${sender.nick}.`, type: 'error', roomName: room });
                        delete roomService.rooms[room].users[targetSocket.id];
                        roomService.updateUserList(io, room);
                    }
                });
                targetSocket.emit('system message', { text: `Has sido baneado permanentemente. Razón: ${reasonOrRole}`, type: 'error' });
                targetSocket.disconnect(true);
            } else {
                 io.emit('system message', { text: `${banNick} ha sido BANEADO permanentemente por ${sender.nick}.`, type: 'error' });
            }
            
            io.emit('admin panel refresh');
            break;

        case '/unban':
            const unbanned = await banService.unbanUser(targetNick.toLowerCase());
            if (!unbanned) {
                 await banService.unbanUser(targetNick);
            }
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[UNBAN] ${sender.nick} DESBANEÓ a ${targetNick}.`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            io.emit('system message', { text: `${targetNick} ha sido DESBANEADO por ${sender.nick}.`, type: 'highlight' });
            io.emit('admin panel refresh');
            break;
        
        case '/mute':
            if (!targetSocket) {
                return socket.emit('system message', { text: `El usuario '${targetNick}' no se encuentra conectado.`, type: 'error', roomName: currentRoom });
            }

            const targetIsRegistered = targetSocket.userData.role !== 'guest';
            const currentMuteStatus = targetSocket.userData.isMuted;
            const newMuteStatus = !currentMuteStatus;
            
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
            break;

        case '/vip':
            if (!dbUser) return socket.emit('system message', { text: `Solo los usuarios registrados pueden ser VIP.`, type: 'error', roomName: currentRoom });
            const newVipStatus = !(dbUser.isVIP === 1);
            await userService.setVipStatus(dbUser.nick, newVipStatus);
            const actionTextVip = newVipStatus ? 'AHORA ES VIP' : 'YA NO ES VIP';
            io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[VIP] El estatus de ${dbUser.nick} cambió: ${actionTextVip} (por ${sender.nick})`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            io.emit('system message', { text: `El usuario ${dbUser.nick} ${actionTextVip}.`, type: 'highlight' });
            if (targetSocket) {
                targetSocket.userData.isVIP = newVipStatus;
                targetSocket.rooms.forEach(room => { if (room !== targetSocket.id) { roomService.updateUserList(io, room); } });
            }
            break;
            
        case '/whois':
            const isOnline = !!targetSocket;
            const whoisUserData = targetSocket ? targetSocket.userData : dbUser;
            if (!whoisUserData) {
                 return socket.emit('system message', { text: `No se encontró información para '${targetNick}'.`, type: 'error', roomName: currentRoom });
            }
            
            const whoisIsGuest = whoisUserData.role === 'guest';
            const whoisBanId = whoisIsGuest ? whoisUserData.id : whoisUserData.nick.toLowerCase();
            let banInfo = await banService.isUserBanned(whoisBanId);
            const userIP = targetSocket ? targetSocket.userData.ip : (dbUser ? dbUser.lastIP : 'N/A');

            if (!banInfo && userIP) {
                banInfo = await banService.isUserBanned(userIP);
            }
            
            const ipToShow = ['owner', 'admin'].includes(sender.role) ? userIP : obfuscateIP(userIP);
            
            let whoisMsg = `\n--- Información de ${whoisUserData.nick} ---\n`;
            whoisMsg += `Estado: ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
            whoisMsg += `IP: ${ipToShow}\n`;
            whoisMsg += `Rol: ${targetRole}\n`;
            const isMuted = targetSocket ? targetSocket.userData.isMuted : (dbUser ? (dbUser.isMuted === 1) : false);
            
            let mutedByInfo = 'No';
            if (isMuted) {
                const muter = targetSocket?.userData?.mutedBy || dbUser?.mutedBy;
                mutedByInfo = `Sí 🔇 (por ${muter || 'Sistema/Desconocido'})`;
            }
            whoisMsg += `Silenciado: ${mutedByInfo}\n`;

            if (dbUser) {
                whoisMsg += `Registrado: ${new Date(dbUser.registeredAt).toLocaleString('es-ES')}\n`;
            } else {
                whoisMsg += `Registrado: No (Invitado)\n`;
            }
            if (isOnline) {
                const userRooms = Array.from(targetSocket.rooms).filter(r => r !== targetSocket.id);
                whoisMsg += `Salas actuales: ${userRooms.join(', ') || 'Ninguna'}\n`;
            }
            whoisMsg += `Baneado: ${banInfo ? `Sí (por ${banInfo.by})` : 'No'}\n`;
            if (banInfo) {
                whoisMsg += `Razón del ban: ${banInfo.reason}\n`;
            }
            whoisMsg += `------------------------------`;
            socket.emit('system message', { text: whoisMsg, type: 'highlight', roomName: currentRoom });
            break;

        case '/promote':
            const newRole = args[2] ? args[2].toLowerCase() : '';
            if (!newRole) {
                return socket.emit('system message', { text: `Debes especificar un rol (admin o mod).`, type: 'error', roomName: currentRoom });
            }

            if (newRole === 'admin' && senderRole !== 'owner') {
                return socket.emit('system message', { text: 'Solo el Owner puede nombrar administradores.', type: 'error', roomName: currentRoom });
            }
            if (!['admin', 'mod'].includes(newRole)) {
                return socket.emit('system message', { text: `Rol '${newRole}' no válido. Roles permitidos: admin, mod.`, type: 'error', roomName: currentRoom });
            }
            if (rolesOrder[senderRole] >= rolesOrder[newRole]) {
                return socket.emit('system message', { text: `No puedes promover a un rol igual o superior al tuyo.`, type: 'error', roomName: currentRoom });
            }

            try {
                await userService.setUserRole(targetNick, newRole);
                const successMsg = `${targetNick} ha sido promovido a ${newRole} por ${sender.nick}.`;
                io.emit('system message', { text: successMsg, type: 'highlight' });
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[PROMOTE] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                
                if (targetSocket) {
                    targetSocket.userData.role = newRole;
                    targetSocket.rooms.forEach(room => roomService.updateUserList(io, room));
                    targetSocket.emit('system message', { text: `¡Has sido ascendido a ${newRole}!`, type: 'highlight' });
                }
            } catch (err) {
                socket.emit('system message', { text: `Error al promover: ${err.message}`, type: 'error', roomName: currentRoom });
            }
            break;

        case '/demote':
            if (targetRole === 'user' || targetRole === 'guest') {
                return socket.emit('system message', { text: `${targetNick} ya es un usuario normal.`, type: 'error', roomName: currentRoom });
            }
             if (targetRole === 'owner') {
                return socket.emit('system message', { text: `No se puede degradar al Owner.`, type: 'error', roomName: currentRoom });
            }
            
            try {
                await userService.setUserRole(targetNick, 'user');
                const successMsg = `${targetNick} ha sido degradado a usuario normal por ${sender.nick}.`;
                io.emit('system message', { text: successMsg, type: 'warning' });
                io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[DEMOTE] ${successMsg}`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
                
                if (targetSocket) {
                    targetSocket.userData.role = 'user';
                    targetSocket.rooms.forEach(room => roomService.updateUserList(io, room));
                    targetSocket.emit('system message', { text: `Has sido degradado a usuario.`, type: 'warning' });
                }
            } catch (err) {
                socket.emit('system message', { text: `Error al degradar: ${err.message}`, type: 'error', roomName: currentRoom });
            }
            break;
    }
}

module.exports = { handleCommand };