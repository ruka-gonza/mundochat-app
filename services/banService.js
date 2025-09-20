const db = require('./db-connection').getInstance();

// --- INICIO DE LA CORRECCIÓN CLAVE ---
/**
 * Comprueba si un usuario está baneado, verificando tanto su ID como su dirección IP.
 * @param {string} idToCheck - El ID del usuario (nick en minúsculas o UUID de invitado).
 * @param {string} ipToCheck - La dirección IP del usuario.
 * @returns {Promise<object|null>} - El registro del baneo si se encuentra, o null si no.
 */
function isUserBanned(idToCheck, ipToCheck) {
    return new Promise((resolve, reject) => {
        // Construimos la consulta y los parámetros dinámicamente para manejar casos donde no hay ID o IP.
        let query = 'SELECT * FROM banned_users WHERE ';
        const params = [];
        const conditions = [];

        if (idToCheck) {
            conditions.push('id = ?');
            params.push(idToCheck);
        }
        
        // Solo añadimos la condición de IP si es una IP válida (no null, undefined, etc.)
        if (ipToCheck) {
            conditions.push('ip = ?');
            params.push(ipToCheck);
        }

        // Si no hay ni ID ni IP, no hay nada que buscar.
        if (conditions.length === 0) {
            return resolve(null);
        }

        query += conditions.join(' OR ');
        query += ' LIMIT 1'; // Solo necesitamos saber si existe al menos un baneo.

        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}
// --- FIN DE LA CORRECCIÓN CLAVE ---


function banUser(persistentId, nick, ip, reason, by) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT INTO banned_users (id, nick, ip, reason, by, at) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(persistentId, nick, ip, reason, by, new Date().toISOString(), function(err) {
            if (err) return reject(err);
            resolve({ id: persistentId });
        });
        stmt.finalize();
    });
}

function unbanUser(persistentId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM banned_users WHERE id = ?', [persistentId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

module.exports = { isUserBanned, banUser, unbanUser };