const permissionService = require('./permissionService');
const db = require('./db-connection'); // <-- AÑADIDO: Importamos la conexión a la DB

let rooms = {};
const DEFAULT_ROOMS = ["#General", "Juegos", "Música", "Amistad", "Sexo", "Romance", "Chile", "Argentina", "Brasil", "España", "México"];
const MOD_LOG_ROOM = '#Staff-Logs';
const guestSocketMap = new Map(); // <-- AÑADIR ESTA LÍNEA

DEFAULT_ROOMS.forEach(room => {
    rooms[room] = { users: {} };
});
if (!rooms[MOD_LOG_ROOM]) {
    rooms[MOD_LOG_ROOM] = { users: {} };
}

// --- INICIO DE LA MODIFICACIÓN ---
// La función createRoom ahora es asíncrona y consulta la BD
async function createRoom(roomName, io) {
    // 1. Verificar si ya existe en memoria
    if (rooms[roomName]) {
        return false;
    }

    // 2. Verificar si ya existe en la base de datos
    const existingRoomInDb = await new Promise((resolve, reject) => {
        db.get('SELECT 1 FROM rooms WHERE name = ?', [roomName], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });

    if (existingRoomInDb) {
        // Si existe en la BD pero no en memoria (ej. tras reinicio), la cargamos
        rooms[roomName] = { users: {} };
        console.log(`[SALA] Se ha recargado la sala desde la BD: ${roomName}`);
        updateRoomData(io);
        return false; // Indicamos que no se "creó" de nuevo, sino que se cargó.
    }
    
    // 3. Si no existe en ningún lado, la creamos
    rooms[roomName] = { users: {} };
    console.log(`[SALA] Se ha creado la sala: ${roomName}`);
    updateRoomData(io); 
    return true; // Indicamos que la creación fue exitosa.
}
// --- FIN DE LA MODIFICACIÓN ---


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
            isAFK: u.isAFK // Incluir estado AFK
        };
    });

    const userList = await Promise.all(userListPromises);

    const roleOrder = { 'owner': 0, 'admin': 1, 'mod': 2, 'operator': 3, 'user': 4, 'guest': 5 };

    userList.sort((a, b) => {
        const roleA = roleOrder[a.role] ?? 99;
        const roleB = roleOrder[b.role] ?? 99;
        if (roleA < roleB) return -1;
        if (roleA > roleB) return 1;
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
    guestSocketMap, // <-- AÑADIR ESTA LÍNEA
    createRoom,
    findSocketIdByNick,
    isNickInUse,
    updateUserList,
    updateRoomData
};