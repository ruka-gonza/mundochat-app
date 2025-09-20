const permissionService = require('./permissionService');
const db = require('./db-connection').getInstance(); // Obtiene la instancia de la BD

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

function updateUserDataInAllRooms(socket) {
    if (!socket || !socket.userData || !socket.joinedRooms) {
        console.warn('[SYNC_WARNING] Se intentó actualizar datos de usuario sin un socket válido.');
        return;
    }

    socket.joinedRooms.forEach(roomName => {
        if (rooms[roomName] && rooms[roomName].users[socket.id]) {
            rooms[roomName].users[socket.id] = { 
                ...rooms[roomName].users[socket.id],
                ...socket.userData
            };
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
    const roomListArray = Object.keys(rooms).map(roomName => ({
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


// --- INICIO DE LA CORRECCIÓN CLAVE ---
// La función ahora es `async` para poder usar `await` dentro.
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

        // 1. Creamos un array de promesas para calcular el rol efectivo de CADA usuario en esta sala.
        const rolePromises = usersToProcess.map(user => 
            permissionService.getUserEffectiveRole(user.id, roomName)
        );
        
        // 2. Esperamos a que todas las promesas se resuelvan.
        const effectiveRoles = await Promise.all(rolePromises);

        // 3. Creamos la lista final de usuarios, reemplazando el rol global por el rol efectivo.
        const userListWithEffectiveRoles = usersToProcess.map((user, index) => {
            return {
                ...user, // Copiamos todos los datos del usuario (nick, avatar, isAFK, etc.)
                role: effectiveRoles[index] // Sobrescribimos la propiedad 'role' con la correcta para esta sala.
            };
        });

        // 4. Ordenamos la lista final usando los roles efectivos.
        userListWithEffectiveRoles.sort((a, b) => {
            const roleA = permissionService.getRolePriority(a.role);
            const roleB = permissionService.getRolePriority(b.role);
            if (roleA !== roleB) {
                return roleA - roleB;
            }
            return a.nick.localeCompare(b.nick);
        });

        // 5. Enviamos la lista corregida al cliente.
        io.to(roomName).emit('update user list', { roomName, users: userListWithEffectiveRoles });
        
        console.log(`[UPDATE_USER_LIST] Sala ${roomName}: ${userListWithEffectiveRoles.length} usuarios activos`);
    }
}
// --- FIN DE LA CORRECCIÓN CLAVE ---


module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    guestSocketMap,
    initializeRooms,
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList,
    updateRoomData,
    getActiveRoomsWithUserCount,
    updateUserDataInAllRooms
};