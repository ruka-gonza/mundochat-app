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
async function updateUserList(io, roomName) { /* tu código existente aquí si tienes más lógica */ }
async function createRoom(roomName, io) { /* tu código existente aquí si tienes más lógica */ }


module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    guestSocketMap,
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList,
    updateRoomData,
    getActiveRoomsWithUserCount // Exportamos la nueva función
};