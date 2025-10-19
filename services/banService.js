const db = require('./db-connection').getInstance();

/**
 * Comprueba si un usuario está baneado, primero globalmente y luego para una sala específica.
 * También limpia los baneos globales expirados.
 * @param {string} userId - El ID del usuario (nick en minúsculas o UUID de invitado).
 * @param {string} ip - La dirección IP del usuario.
 * @param {string} roomName - El nombre de la sala a la que intenta unirse.
 * @returns {Promise<object|null>} El registro del baneo si se encuentra, o null si no.
 */
async function isUserBanned(userId, ip, roomName) {
    // 1. Comprobar baneo global
    const globalBan = await new Promise((resolve, reject) => {
        let query = 'SELECT * FROM global_bans WHERE ';
        const params = [];
        const conditions = [];

        if (userId) {
            conditions.push('id = ?');
            params.push(userId);
        }
        if (ip) {
            conditions.push('ip = ?');
            params.push(ip);
        }
        if (conditions.length === 0) return resolve(null);

        query += conditions.join(' OR ') + ' LIMIT 1';

        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });

    if (globalBan) {
        if (globalBan.expiresAt && new Date(globalBan.expiresAt) < new Date()) {
            // El baneo ha expirado, lo eliminamos y permitimos el acceso
            await removeGlobalBan(globalBan.id);
            return null;
        }
        // Baneo global activo encontrado
        return { ...globalBan, scope: 'global' };
    }
    
    // 2. Si no hay baneo global y el usuario está registrado, comprobar baneo de sala
    if (roomName && !isNaN(parseInt(userId))) {
        const roomBan = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM room_bans WHERE userId = ? AND roomName = ?', [userId, roomName], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (roomBan) {
            return { ...roomBan, scope: 'room' };
        }
    }

    // 3. No se encontró ningún baneo
    return null;
}

/**
 * Añade un baneo global (permanente o temporal).
 */
function addGlobalBan(id, nick, ip, reason, by, expiresAt = null) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT INTO global_bans (id, nick, ip, reason, by, at, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(id, nick, ip, reason, by, new Date().toISOString(), expiresAt, function(err) {
            if (err) return reject(err);
            resolve({ id });
        });
        stmt.finalize();
    });
}

/**
 * Añade un baneo específico para una sala.
 */
function addRoomBan(userId, roomName, reason, by) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT INTO room_bans (userId, roomName, reason, by, at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(userId, roomName, reason, by, new Date().toISOString(), function(err) {
            if (err) return reject(err);
            resolve(true);
        });
        stmt.finalize();
    });
}

/**
 * Elimina un baneo global.
 */
function removeGlobalBan(banId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM global_bans WHERE id = ?', [banId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

/**
 * Elimina un baneo de sala.
 */
function removeRoomBan(userId, roomName) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM room_bans WHERE userId = ? AND roomName = ?', [userId, roomName], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}


module.exports = { 
    isUserBanned, 
    addGlobalBan, 
    addRoomBan,
    removeGlobalBan,
    removeRoomBan
};