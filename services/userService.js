const db = require('./db-connection').getInstance();
const bcrypt = require('bcrypt');
const config = require('../config');

let admins = ["Basajaun", "namor"];
let mods = ["Mod1"];

function getRole(nick) {
    if (nick.toLowerCase() === config.ownerNick.toLowerCase()) return 'owner';
    if (admins.map(a => a.toLowerCase()).includes(nick.toLowerCase())) return 'admin';
    if (mods.map(m => m.toLowerCase()).includes(nick.toLowerCase())) return 'mod';
    return 'user';
}

function findUserByNick(identifier) {
    return new Promise((resolve, reject) => {
        const lowerCaseIdentifier = identifier.toLowerCase();
        db.get('SELECT * FROM users WHERE lower(nick) = ? OR lower(email) = ?', [lowerCaseIdentifier, lowerCaseIdentifier], (err, row) => {
            if (err) return reject(err);
            if (row) {
                row.role = getRole(row.nick);
            }
            resolve(row);
        });
    });
}

function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
            if (err) return reject(err);
            if (row) {
                row.role = getRole(row.nick);
            }
            resolve(row);
        });
    });
}

async function createUser(nick, email, password, ip) {
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
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET nick = ? WHERE lower(nick) = ?', [newNick, oldNick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function updateUserIP(nick, ip) {
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
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET isVIP = ? WHERE lower(nick) = ?', [isVIP ? 1 : 0, nick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function setMuteStatus(nick, isMuted, moderatorNick = null) {
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
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

function setUserRole(nick, role) {
    return new Promise((resolve, reject) => {
        const validRoles = ['admin', 'mod', 'user'];
        if (!validRoles.includes(role)) {
            return reject(new Error('Rol no válido.'));
        }
        db.run('UPDATE users SET role = ? WHERE lower(nick) = ?', [role, nick.toLowerCase()], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

module.exports = {
    getRole,
    findUserByNick,
    findUserById,
    createUser,
    verifyPassword,
    setVipStatus,
    setMuteStatus,
    updateUserIP,
    setAvatarUrl,
    updateUserNick,
    setUserRole
};