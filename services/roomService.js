const permissionService = require('./permissionService');
const db = require('./db-connection');

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

// --- INICIO DE LA MODIFICACIÓN ---
// Este código se ejecuta UNA SOLA VEZ cuando el módulo es requerido por primera vez.
// Esto asegura que las salas SIEMPRE existan en memoria antes de que cualquier otra
// parte del código (como socketManager) pueda acceder a ellas.
console.log("Creando salas por defecto en memoria...");
DEFAULT_ROOMS.forEach(room => {
    rooms[room] = { users: {} };
});
if (!rooms[MOD_LOG_ROOM]) {
    rooms[MOD_LOG_ROOM] = { users: {} };
}
console.log("Salas por defecto listas:", Object.keys(rooms));
// --- FIN DE LA MODIFICACIÓN ---

// ... (el resto de tus funciones como createRoom, findSocketIdByNick, etc. quedan igual) ...

async function createRoom(roomName, io) { /* ... tu código ... */ }
function findSocketIdByNick(nick) { /* ... tu código ... */ }
function isNickInUse(nick) { /* ... tu código ... */ }
async function updateUserList(io, roomName) { /* ... tu código ... */ }
function updateRoomData(io) {
    const roomListArray = Object.keys(rooms).map(roomName => ({
        name: roomName,
        userCount: Object.keys(rooms[roomName].users).length
    }));
    roomListArray.sort((a, b) => b.userCount - a.userCount);
    io.emit('update room data', roomListArray);
}

module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    guestSocketMap,
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList,
    updateRoomData
};