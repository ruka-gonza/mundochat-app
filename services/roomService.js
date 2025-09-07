const permissionService = require('./permissionService');
const db = require('./db-connection'); // Usa la conexión compartida

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

// --- Inicialización en Memoria ---
console.log("Creando salas por defecto en memoria...");
DEFAULT_ROOMS.forEach(room => {
    rooms[room] = { users: {} };
});
if (!rooms[MOD_LOG_ROOM]) {
    rooms[MOD_LOG_ROOM] = { users: {} };
}
console.log("Salas por defecto listas:", Object.keys(rooms));


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
async function createRoom(roomName, io) {
    if (rooms[roomName]) {
        return false; // La sala ya existe
    }
    rooms[roomName] = { users: {} };
    updateRoomData(io); // Notifica a todos los clientes sobre la nueva sala
    return true;
}

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
/**
 * Calcula la lista de usuarios actualizada para una sala y la emite a todos en esa sala.
 * @param {object} io - La instancia del servidor de Socket.IO.
 * @param {string} roomName - El nombre de la sala a actualizar.
 */
const permissionService = require('./permissionService');
const db = require('./db-connection'); // Usa la conexión compartida

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

// --- Inicialización en Memoria y desde BD ---
function initializeRooms() {
    console.log("Creando salas por defecto en memoria...");
    DEFAULT_ROOMS.forEach(roomName => {
        if (!rooms[roomName]) {
            rooms[roomName] = { users: {} };
        }
    });
    if (!rooms[MOD_LOG_ROOM]) {
        rooms[MOD_LOG_ROOM] = { users: {} };
    }

    db.all('SELECT name FROM rooms', [], (err, rows) => {
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

initializeRooms(); // Llama a la función al iniciar el módulo

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

    return new Promise((resolve, reject) => {
        // Usamos INSERT OR IGNORE para máxima seguridad anti-crash
        const roomStmt = db.prepare('INSERT OR IGNORE INTO rooms (name, creatorId, creatorNick, createdAt) VALUES (?, ?, ?, ?)');
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

// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================


module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    guestSocketMap,
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList, // <-- ¡Ahora esta función tiene lógica!
    updateRoomData,
    getActiveRoomsWithUserCount
};