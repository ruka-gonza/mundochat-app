// services/banService.js (MODIFICADO: Ruta de DB dinámica y guardado de nick/ip)
const sqlite3 = require('sqlite3').verbose();

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);

function isUserBanned(persistentId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM banned_users WHERE id = ?', [persistentId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// Modificado para aceptar más datos
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