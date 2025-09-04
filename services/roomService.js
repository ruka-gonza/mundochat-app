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
async function updateUserList(io, roomName) {
    if (!rooms[roomName]) {
        return; // No hacer nada si la sala ya no existe
    }

    const usersInRoom = Object.values(rooms[roomName].users);
    
    // Obtenemos los datos completos y el rol efectivo de cada usuario en la sala
    const userListPromises = usersInRoom.map(async (u) => {
        const effectiveRole = await permissionService.getUserEffectiveRole(u.id, roomName);
        return {
            id: u.id,
            nick: u.nick,
            role: effectiveRole,
            isVIP: u.isVIP,
            avatar_url: u.avatar_url,
            isAFK: u.isAFK 
        };
    });

    const finalUserList = await Promise.all(userListPromises);

    // Ordenar la lista: primero por rol, luego alfabéticamente
    const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'guest': 5 };
    finalUserList.sort((a, b) => {
        const roleA = roleOrder[a.role] ?? 99;
        const roleB = roleOrder[b.role] ?? 99;
        if (roleA < roleB) return -1;
        if (roleA > roleB) return 1;
        return a.nick.localeCompare(b.nick);
    });

    // Enviar la lista actualizada a todos los clientes en esa sala específica
    io.to(roomName).emit('update user list', { roomName, users: finalUserList });
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