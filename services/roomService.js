const permissionService = require('./permissionService');
const db = require('./db-connection').getInstance(); // Obtiene la instancia de la BD

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

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

function updateUserList(io, roomName) {
    if (rooms[roomName]) {
        const uniqueUsers = {};
        // Recorremos todos los sockets en la sala
        for (const socketId in rooms[roomName].users) {
            const user = rooms[roomName].users[socketId];
            // Si el usuario ya está en nuestra lista de únicos, no hacemos nada.
            // Esto previene duplicados si un usuario tiene múltiples conexiones.
            if (!uniqueUsers[user.nick]) {
                uniqueUsers[user.nick] = user;
            }
        }

        // Convertimos el objeto de usuarios únicos a un array y lo ordenamos
        const userList = Object.values(uniqueUsers).sort((a, b) => {
            const roleA = permissionService.getRolePriority(a.role);
            const roleB = permissionService.getRolePriority(b.role);
            if (roleA !== roleB) {
                return roleA - roleB; // Ordena por prioridad de rol
            }
            return a.nick.localeCompare(b.nick); // Luego por orden alfabético
        });

        // Mensaje de depuración temporal
        io.to(roomName).emit('system message', { 
            text: `[DEBUG] Actualizando lista para ${userList.length} usuarios en ${roomName}.`,
            type: 'info',
            roomName
        });

        // Emitimos la lista de usuarios limpia y ordenada
        io.to(roomName).emit('update user list', { roomName, users: userList });
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
    getActiveRoomsWithUserCount
};