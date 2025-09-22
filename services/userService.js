const bcrypt = require('bcrypt');
const config = require('../config');

let admins = ["Basajaun", "namor"];
let mods = ["Mod1"];

function getRole(nick) {
    const db = require('./db-connection').getInstance();
    if (nick.toLowerCase() === config.ownerNick.toLowerCase()) return 'owner';
    if (admins.map(a => a.toLowerCase()).includes(nick.toLowerCase())) return 'admin';
    if (mods.map(m => m.toLowerCase()).includes(nick.toLowerCase())) return 'mod';
    return 'user';
}

function findUserByNick(nick) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        const lowerCaseNick = nick.toLowerCase();
        db.get('SELECT * FROM users WHERE lower(nick) = ?', [lowerCaseNick], (err, row) => {
            if (err) return reject(err);
            if (row) {
                const dbRole = row.role;
                const hardcodedRole = getRole(row.nick);

                if (['owner', 'admin', 'mod', 'operator'].includes(dbRole)) {
                    row.role = dbRole;
                } else {
                    row.role = hardcodedRole;
                }
            }
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
            if (row) {
                const dbRole = row.role;
                const hardcodedRole = getRole(row.nick);

                if (['owner', 'admin', 'mod', 'operator'].includes(dbRole)) {
                    row.role = dbRole;
                } else {
                    row.role = hardcodedRole;
                }
            }
            resolve(row);
        });
    });
}

function findUserById(id) {
    const db = require('./db-connection').getInstance();
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
            if (err) return reject(err);
            if (row) {
                const dbRole = row.role;
                const hardcodedRole = getRole(row.nick);

                if (['owner', 'admin', 'mod', 'operator'].includes(dbRole)) {
                    row.role = dbRole;
                } else {
                    row.role = hardcodedRole;
                }
            }
            resolve(row);
        });
    });
}

async function createUser(nick, email, password, ip) {
    const db = require('./db-connection').getInstance();
    const hashedPassword = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
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
        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Añadimos 'operator' a la lista de roles válidos para una promoción global.
        const validRoles = ['admin', 'mod', 'operator', 'user'];
        // --- FIN DE LA CORRECCIÓN CLAVE ---
        
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
    getRole,
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
