const permissionService = require('./permissionService');
const db = require('./db-connection').getInstance(); // Obtiene la instancia de la BD

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

// --- INICIO DE LA MODIFICACIÓN: Nueva función de sincronización ---

/**
 * Actualiza los datos de un usuario en todas las listas de sala en las que se encuentra.
 * Esta función es CRÍTICA para mantener la consistencia del estado del servidor.
 * @param {object} socket - El objeto socket del usuario cuyos datos han cambiado.
 */
function updateUserDataInAllRooms(socket) {
    if (!socket || !socket.userData || !socket.joinedRooms) {
        console.warn('[SYNC_WARNING] Se intentó actualizar datos de usuario sin un socket válido.');
        return;
    }

    socket.joinedRooms.forEach(roomName => {
        // Asegurarse de que la sala y el usuario existen en el registro
        if (rooms[roomName] && rooms[roomName].users[socket.id]) {
            // Actualiza la copia de los datos del usuario en la sala con los datos más recientes de socket.userData
            rooms[roomName].users[socket.id] = { 
                ...rooms[roomName].users[socket.id], // Mantiene datos específicos de la sala si los hubiera
                ...socket.userData // Sobrescribe con los datos más recientes
            };
        }
    });
}
// --- FIN DE LA MODIFICACIÓN ---


// --- Inicialización en Memoria y desde BD ---
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

// --- Funciones de Gestión de Salas ---

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
        return false; // La sala ya existe en memoria
    }
    const dbInstance = require('./db-connection').getInstance();

    return new Promise((resolve, reject) => {
        // Usamos INSERT OR IGNORE para máxima seguridad anti-crash
        const roomStmt = dbInstance.prepare('INSERT OR IGNORE INTO rooms (name, creatorId, creatorNick, createdAt) VALUES (?, ?, ?, ?)');
        roomStmt.run(roomName, creator.id, creator.nick, new Date().toISOString(), function(err) {
            roomStmt.finalize();
            if (err) {
                console.error("Error al guardar la sala en la BD:", err);
                return reject(err);
            }
            if (this.changes === 0) {
                // La sala ya existía en la BD pero no en memoria (caso raro), la cargamos
                if (!rooms[roomName]) {
                    rooms[roomName] = { users: {} };
                }
                return resolve(false); // Indicamos que no se creó porque ya existía
            }

            // Si se insertó correctamente, la creamos en memoria y notificamos
            rooms[roomName] = { users: {} };
            updateRoomData(io);
            resolve(true); // Indicamos que se creó con éxito
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
                console.log(`[CLEANUP] Usuario sin nick encontrado en ${roomName}, eliminando...`);
                delete rooms[roomName].users[socketId];
                continue;
            }
            
            if (!uniqueUsers[user.nick.toLowerCase()]) {
                uniqueUsers[user.nick.toLowerCase()] = user;
            } else {
                console.log(`[CLEANUP] Usuario duplicado encontrado: ${user.nick}, manteniendo conexión más reciente`);
            }
        }

        const userList = Object.values(uniqueUsers).sort((a, b) => {
            const roleA = permissionService.getRolePriority(a.role);
            const roleB = permissionService.getRolePriority(b.role);
            if (roleA !== roleB) {
                return roleA - roleB;
            }
            return a.nick.localeCompare(b.nick);
        });

        io.to(roomName).emit('update user list', { roomName, users: userList });
        
        console.log(`[UPDATE_USER_LIST] Sala ${roomName}: ${userList.length} usuarios activos`);
    }
}

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
    updateUserDataInAllRooms // <-- Exportar la nueva función
};