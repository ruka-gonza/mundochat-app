// services/roomService.js (MODIFICADO: updateRoomData ahora envía un array ordenado)
let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';

DEFAULT_ROOMS.forEach(room => {
    rooms[room] = { users: {} };
});
if (!rooms[MOD_LOG_ROOM]) {
    rooms[MOD_LOG_ROOM] = { users: {} };
}

function createRoom(roomName, io) {
    if (rooms[roomName]) {
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

function updateUserList(io, roomName) {
    if (!rooms[roomName]) return;
    
    const userList = Object.values(rooms[roomName].users).map(u => ({ 
        id: u.id,
        nick: u.nick, 
        role: u.role, 
        isVIP: u.isVIP,
        avatar_url: u.avatar_url
    }));

    const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'user': 3, 'guest': 4 };

    userList.sort((a, b) => {
        const roleA = roleOrder[a.role] ?? 99;
        const roleB = roleOrder[b.role] ?? 99;
        if (roleA < roleB) return -1;
        if (roleA > roleB) return 1;
        return a.nick.localeCompare(b.nick);
    });

    io.to(roomName).emit('update user list', { roomName, users: userList });
}

// --- FUNCIÓN MODIFICADA ---
function updateRoomData(io) {
    // 1. Convertir el objeto de salas en un array de objetos
    const roomListArray = Object.keys(rooms).map(roomName => ({
        name: roomName,
        userCount: Object.keys(rooms[roomName].users).length
    }));

    // 2. Ordenar el array de mayor a menor número de usuarios
    roomListArray.sort((a, b) => b.userCount - a.userCount);
    
    // 3. Emitir el array ordenado
    io.emit('update room data', roomListArray);
}
// --- FIN FUNCIÓN MODIFICADA ---


module.exports = {
    rooms,
    DEFAULT_ROOMS,
    MOD_LOG_ROOM,
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList,
    updateRoomData
};