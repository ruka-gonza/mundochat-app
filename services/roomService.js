const permissionService = require('./permissionService'); 
// --- FIN DE LA CORRECCIÓN ---

const db = require('./db-connection');

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map();

function initializeDefaultRooms() {
    console.log("Inicializando salas por defecto en memoria...");
    DEFAULT_ROOMS.forEach(room => {
        if (!rooms[room]) {
            rooms[room] = { users: {} };
        }
    });
    if (!rooms[MOD_LOG_ROOM]) {
        rooms[MOD_LOG_ROOM] = { users: {} };
    }
    console.log("Salas por defecto listas.");
}

async function createRoom(roomName, io) {
    if (rooms[roomName]) {
        return false;
    }
    const existingRoomInDb = await new Promise((resolve, reject) => {
        db.get('SELECT 1 FROM rooms WHERE name = ?', [roomName], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
    if (existingRoomInDb) {
        rooms[roomName] = { users: {} };
        console.log(`[SALA] Se ha recargado la sala desde la BD: ${roomName}`);
        updateRoomData(io);
        return false;
    }
    rooms[roomName] = { users: {} };
    console.log(`[SALA] Se ha creado la sala: ${roomName}`);
    updateRoomData(io); 
    return true;
}

function findSocketIdByNick(nick) {
    for (const rName in rooms) {
        const foundSocketId = Object.keys(rooms[rName].users).find(
            id => rooms[rName].users[id].nick.toLowerCase() === nick.toLowerCase()
        );
        if (foundSocketId) return foundSocketId;
    }
    return null;
}

function isNickInUse(nick) {
    return !!findSocketIdByNick(nick);
}

async function updateUserList(io, roomName) {
    if (!rooms[roomName]) return;
    const usersInRoom = Object.values(rooms[roomName].users);
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
    const userList = await Promise.all(userListPromises);
    const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'guest': 5 };
    userList.sort((a, b) => {
        const roleA = roleOrder[a.role] ?? 99;
        const roleB = roleOrder[b.role] ?? 99;
        if (roleA < roleB) return -1; if (roleA > roleB) return 1;
        return a.nick.localeCompare(b.nick);
    });
    io.to(roomName).emit('update user list', { roomName, users: userList });
}

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
    updateRoomData,
    initializeDefaultRooms
};