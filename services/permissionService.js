const userService = require('./userService');
const db = require('./db-connection').getInstance(); // <-- USA LA CONEXIÓN COMPARTIDA

/**
 * Determina el rol efectivo de un usuario en una sala específica.
 * Prioriza el rol global de 'owner' y 'admin'.
 * Luego, busca un rol específico para la sala en la tabla 'room_staff'.
 * Si no hay rol de sala, devuelve el rol global del usuario.
 * @param {number} userId - El ID del usuario.
 * @param {string} roomName - El nombre de la sala.
 * @returns {Promise<string>} El rol efectivo del usuario ('owner', 'admin', 'mod', 'user').
 */
async function getUserEffectiveRole(userId, roomName) {
    if (!userId || !roomName) {
        // Si no tenemos datos, asumimos el rol más bajo para evitar fallos.
        const user = await userService.findUserById(userId);
        return user ? user.role : 'guest';
    }

    const user = await userService.findUserById(userId);
    if (!user) return 'guest';

    // 1. Los roles globales de Owner y Admin tienen poder en todas partes.
    if (user.role === 'owner' || user.role === 'admin') {
        return user.role;
    }

    // 2. Buscar un rol específico para esta sala en la nueva tabla.
    const roomRole = await new Promise((resolve, reject) => {
        db.get('SELECT role FROM room_staff WHERE userId = ? AND roomName = ?', [userId, roomName], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.role : null);
        });
    });

    // 3. Si se encontró un rol de sala, ese es su rol efectivo.
    if (roomRole) {
        return roomRole;
    }

    // 4. Si no, su rol efectivo es su rol global.
    return user.role;
}

// --- INICIO DE LA CORRECCIÓN CLAVE: Nueva jerarquía de roles ---
const rolePriorities = {
    owner: 0,
    admin: 1,
    operator: 2, // Operador ahora es más que moderador
    mod: 3,      // Moderador ahora es el primer nivel de staff
    vip: 4,
    user: 5,
    guest: 6
};
// --- FIN DE LA CORRECCIÓN CLAVE ---

function getRolePriority(role) {
    return rolePriorities[role] !== undefined ? rolePriorities[role] : 99;
}

module.exports = { getUserEffectiveRole, getRolePriority };