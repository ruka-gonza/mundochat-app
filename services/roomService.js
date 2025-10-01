const permissionService = require('./permissionService');
const db = require('./db-connection').getInstance(); // Obtiene la instancia de la BD

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const INCOGNITO_ROOM = '#Incognito';
const guestSocketMap = new Map();

function updateUserDataInAllRooms(socket) {
    if (!socket || !socket.userData || !socket.joinedRooms) {
        console.warn('[SYNC_WARNING] Se intentó actualizar datos de usuario sin un socket válido.');
        return;
    }

    socket.joinedRooms.forEach(roomName => {
        if (rooms[roomName] && rooms[roomName].users[socket.id]) {
            rooms[roomName].users[socket.id] = socket.userData;
        }
    });
}

function initializeRooms() {
    const dbInstance = require('./db-connection').getInstance();
    if (!dbInstance) {
        console.error("La base de datos no está inicializada. No se pueden cargar las salas.");
        return;
    }
    console.log("Creando salas por defecto en memoria...");
    DEFAULT_ROOMS.forEach(roomName => {
        if (!rooms[roomName]) {
            rooms[roomName] = { users: {} };
        }
    });
    if (!rooms[MOD_LOG_ROOM]) {
        rooms[MOD_LOG_ROOM] = { users: {} };
    }
    if (!rooms[INCOGNITO_ROOM]) {
        rooms[INCOGNITO_ROOM] = { users: {} };
    }

    dbInstance.all('SELECT name FROM rooms', [], (err, rows) => {
        if (err) {
            console.error("Error al cargar salas desde la base de datos:", err.message);
            return;
        }
        rows.forEach(row => {
            if (!rooms[row.name]) {
                rooms[row.name] = { users: {} };
                console.log(`Sala '${row.name}' cargada desde la base de datos.`);
            }
        });
        console.log("Salas por defecto y de BD listas:", Object.keys(rooms));
    });
}

function getActiveRoomsWithUserCount() {
    const roomListArray = Object.keys(rooms)
        .filter(roomName => roomName !== MOD_LOG_ROOM && roomName !== INCOGNITO_ROOM)
        .map(roomName => ({
            name: roomName,
            userCount: Object.keys(rooms[roomName]?.users || {}).length
        }));
    roomListArray.sort((a, b) => b.userCount - a.userCount);
    return roomListArray;
}

function updateRoomData(io) {
    const roomList = getActiveRoomsWithUserCount();
    io.emit('update room data', roomList);
}

function findSocketIdByNick(nick) {
    for (const room of Object.values(rooms)) {
        for (const socketId in room.users) {
            if (room.users[socketId].nick.toLowerCase() === nick.toLowerCase()) {
                return socketId;
            }
        }
    }
    const guestSocketId = guestSocketMap.get(nick);
    if(guestSocketId) return guestSocketId;
    return null;
}

function findSocketIdByUserId(userId) {
    if (!userId) return null;
    for (const room of Object.values(rooms)) {
        for (const socketId in room.users) {
            if (room.users[socketId].id === userId) {
                return socketId;
            }
        }
    }
    return null;
}

function isNickInUse(nick) { return !!findSocketIdByNick(nick); }

async function createRoom(roomName, creator, io) {
    if (rooms[roomName]) {
        return false;
    }
    const dbInstance = require('./db-connection').getInstance();

    return new Promise((resolve, reject) => {
        const roomStmt = dbInstance.prepare('INSERT OR IGNORE INTO rooms (name, creatorId, creatorNick, createdAt) VALUES (?, ?, ?, ?)');
        roomStmt.run(roomName, creator.id, creator.nick, new Date().toISOString(), function(err) {
            roomStmt.finalize();
            if (err) {
                console.error("Error al guardar la sala en la BD:", err);
                return reject(err);
            }
            if (this.changes === 0) {
                if (!rooms[roomName]) {
                    rooms[roomName] = { users: {} };
                }
                return resolve(false);
            }

            rooms[roomName] = { users: {} };
            updateRoomData(io);
            resolve(true);
        });
    });
}


async function updateUserList(io, roomName) {
    if (rooms[roomName]) {
        const uniqueUsers = {};
        const activeSocketIds = new Set();
        
        if (global.io && global.io.sockets && global.io.sockets.sockets) {
            global.io.sockets.sockets.forEach((socket, socketId) => {
                activeSocketIds.add(socketId);
            });
        }
        
        const socketsToRemove = [];
        for (const socketId in rooms[roomName].users) {
            if (!activeSocketIds.has(socketId)) {
                socketsToRemove.push(socketId);
            }
        }
        
        socketsToRemove.forEach(socketId => {
            console.log(`[CLEANUP] Eliminando socket fantasma ${socketId} de la sala ${roomName}`);
            delete rooms[roomName].users[socketId];
        });
        
        for (const socketId in rooms[roomName].users) {
            const user = rooms[roomName].users[socketId];
            if (!user || !user.nick) {
                delete rooms[roomName].users[socketId];
                continue;
            }
            if (!uniqueUsers[user.nick.toLowerCase()]) {
                uniqueUsers[user.nick.toLowerCase()] = user;
            }
        }

        const usersToProcess = Object.values(uniqueUsers);

        const rolePromises = usersToProcess.map(user => 
            permissionService.getUserEffectiveRole(user.id, roomName)
        );
        
        const effectiveRoles = await Promise.all(rolePromises);

        // =========================================================================
        // ===                    INICIO DE LA CORRECCIÓN DEFINITIVA               ===
        // =========================================================================
        
        // 1. Construir la lista final de usuarios con la lógica de rol correcta
        const userListFinal = usersToProcess.map((user, index) => {
            const finalUser = { ...user }; // Copiamos el usuario de la sesión actual
            
            finalUser.isActuallyStaffIncognito = !!user.isIncognito;

            // Si el usuario está en modo incógnito, su rol para la lista SIEMPRE será 'user'.
            if (finalUser.isActuallyStaffIncognito) {
                finalUser.role = 'user';
            } else {
                // Si no, usamos el rol efectivo que calculamos (para mods de sala, etc.).
                finalUser.role = effectiveRoles[index];
            }
            
            return finalUser;
        });

        // 2. Ordenar la lista. Ahora `a.role` y `b.role` tendrán el valor correcto ('user' para incógnitos).
        userListFinal.sort((a, b) => {
            const priorityA = permissionService.getRolePriority(a.role);
            const priorityB = permissionService.getRolePriority(b.role);
        
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            // Si la prioridad es la misma, ordenar alfabéticamente.
            return a.nick.localeCompare(b.nick);
        });
        
        // =========================================================================
        // ===                     FIN DE LA CORRECCIÓN DEFINITIVA                 ===
        // =========================================================================

        const socketsInRoom = await io.in(roomName).fetchSockets();

        for (const recipientSocket of socketsInRoom) {
            const recipientUserId = recipientSocket.userData ? recipientSocket.userData.id : null;
            const recipientRole = recipientUserId ? await permissionService.getUserEffectiveRole(recipientUserId, roomName) : 'guest';
            const canSeeIncognito = recipientRole === 'owner' || recipientRole === 'admin';

            const userListForRecipient = userListFinal.map(user => {
                // Esta lógica ya era correcta: se ocultan los datos a los no-staff.
                if (user.isActuallyStaffIncognito && !canSeeIncognito) {
                    const { role, isVIP, ...rest } = user;
                    return { ...rest, isActuallyStaffIncognito: false, role: 'user' }; // Forzamos rol user para el cliente
                }
                return user;
            });

            recipientSocket.emit('update user list', { roomName, users: userListForRecipient });
        }
    }
}


module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    INCOGNITO_ROOM,
    guestSocketMap,
    initializeRooms,
    createRoom,
    findSocketIdByNick,
    findSocketIdByUserId,
    isNickInUse,
    updateUserList,
    updateRoomData,
    getActiveRoomsWithUserCount,
    updateUserDataInAllRooms
};