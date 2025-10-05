const bcrypt = require('bcrypt');
const config = require('../config');

// --- INICIO DE LA CORRECCIÓN CLAVE ---

// ELIMINADO: Se quitan las listas estáticas de admins y mods.
// let admins = ["Basajaun", "namor"];
// let mods = ["Mod1"];

// SIMPLIFICADO: La función getRole ahora solo se usa para asignar el rol de 'owner'
// al nick especificado en la configuración, o 'user' por defecto.
// Ya no asigna 'admin' o 'mod' desde aquí.
function getRole(nick) {
    if (nick.toLowerCase() === config.ownerNick.toLowerCase()) {
        return 'owner';
    }
    return 'user';
}

function findUserByNick(nick) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const lowerCaseNick = nick.toLowerCase();
        db.get('SELECT * FROM users WHERE lower(nick) = ?', [lowerCaseNick], (err, row) => {
            if (err) return reject(err);
            // ELIMINADO: Se quita la lógica que sobrescribía el rol de la base de datos.
            // Ahora simplemente devolvemos lo que la base de datos nos da.
            resolve(row);
        });
    });
}

function findUserByEmail(email) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const lowerCaseEmail = email.toLowerCase();
        db.get('SELECT * FROM users WHERE lower(email) = ?', [lowerCaseEmail], (err, row) => {
            if (err) return reject(err);
            // ELIMINADO: Se quita la lógica que sobrescribía el rol.
            resolve(row);
        });
    });
}

function findUserById(id) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
            if (err) return reject(err);
            // ELIMINADO: Se quita la lógica que sobrescribía el rol.
            resolve(row);
        });
    });
}
// --- FIN DE LA CORRECCIÓN CLAVE ---


async function createUser(nick, email, password, ip) {
    const db = require('./db-connection').getInstance();
    const hashedPassword = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        // Al crear un usuario, se le asigna 'owner' si coincide, o 'user' en cualquier otro caso.
        // Los roles de admin/mod/oper se asignan con comandos, no al registrarse.
        const initialRole = getRole(nick);
        const stmt = db.prepare('INSERT INTO users (nick, email, password, registeredAt, isVIP, role, isMuted, lastIP) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run(nick, email, hashedPassword, new Date().toISOString(), 0, initialRole, 0, ip, function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, nick, email });
        });
        stmt.finalize();
    });
}

function updateUserNick(oldNick, newNick) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET nick = ? WHERE lower(nick) = ?', [newNick, oldNick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function updateUserIP(nick, ip) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET lastIP = ? WHERE lower(nick) = ?', [ip, nick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

function setVipStatus(nick, isVIP) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET isVIP = ? WHERE lower(nick) = ?', [isVIP ? 1 : 0, nick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function setMuteStatus(nick, isMuted, moderatorNick = null) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const mutedBy = isMuted ? moderatorNick : null;
        const stmt = db.prepare('UPDATE users SET isMuted = ?, mutedBy = ? WHERE lower(nick) = ?');
        stmt.run(isMuted ? 1 : 0, mutedBy, nick.toLowerCase(), function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
        stmt.finalize();
    });
}

function setAvatarUrl(userId, avatarUrl) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function setUserRole(nick, role) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const validRoles = ['admin', 'mod', 'operator', 'user'];
        if (!validRoles.includes(role)) {
            return reject(new Error('Rol no válido.'));
        }
        db.run('UPDATE users SET role = ? WHERE lower(nick) = ?', [role, nick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function getAllStaff() {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const staffRoles = ['owner', 'admin', 'mod', 'operator'];
        const placeholders = staffRoles.map(() => '?').join(',');
        const query = `SELECT id, nick, role, isVIP, avatar_url FROM users WHERE role IN (${placeholders})`;

        db.all(query, staffRoles, (err, rows) => {
            if (err) {
                console.error("Error fetching staff from database:", err);
                return reject(err);
            }
            resolve(rows);
        });
    });
}

function getTotalRegisteredUsers() {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) AS count FROM users WHERE role != \'guest\'', (err, row) => {
            if (err) return reject(err);
            resolve(row.count);
        });
    });
}

function getAllRegisteredUsers() {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.all('SELECT id, nick, email, role, registeredAt, lastIP, isVIP, isMuted FROM users WHERE role != "guest"', (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

module.exports = {
    // getRole se mantiene pero ahora es de uso interno
    findUserByNick,
    findUserByEmail,
    findUserById,
    createUser,
    verifyPassword,
    setVipStatus,
    setMuteStatus,
    updateUserIP,
    setAvatarUrl,
    updateUserNick,
    setUserRole,
    getAllStaff,
    getTotalRegisteredUsers,
    getAllRegisteredUsers
};
