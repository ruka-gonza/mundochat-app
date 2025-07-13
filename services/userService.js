// services/userService.js (MODIFICADO: Ruta de DB dinámica y mutedBy)
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const config = require('../config');

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);

// NOTA: Estas listas ahora servirán como una "caché" inicial,
// pero la fuente de la verdad será la base de datos.
let admins = ["Basajaun", "namor"];
let mods = ["Mod1"];

function getRole(nick) {
    if (nick.toLowerCase() === config.ownerNick.toLowerCase()) return 'owner';
    // La lógica de roles se simplificará, ya que se leerá de la DB.
    // Dejamos esto como fallback o para la asignación inicial.
    if (admins.map(a => a.toLowerCase()).includes(nick.toLowerCase())) return 'admin';
    if (mods.map(m => m.toLowerCase()).includes(nick.toLowerCase())) return 'mod';
    return 'user';
}

function findUserByNick(nick) {
    return new Promise((resolve, reject) => {
        // Obtenemos el rol directamente desde la DB para mayor precisión
        db.get('SELECT *, role as userRole FROM users WHERE lower(nick) = ?', [nick.toLowerCase()], (err, row) => {
            if (err) return reject(err);
            if (row) {
                 // Si el rol en la DB es 'user', comprobamos si es el owner
                if(row.userRole === 'user' && nick.toLowerCase() === config.ownerNick.toLowerCase()) {
                    row.role = 'owner';
                } else {
                    row.role = row.userRole; // Usamos el rol de la DB
                }
            }
            resolve(row);
        });
    });
}

async function createUser(nick, password, ip) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        const initialRole = getRole(nick); // Rol inicial al registrarse
        const stmt = db.prepare('INSERT INTO users (nick, password, registeredAt, isVIP, role, isMuted, lastIP) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(nick, hashedPassword, new Date().toISOString(), 0, initialRole, 0, ip, function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, nick });
        });
        stmt.finalize();
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
        // Si se está silenciando, guardamos quién lo hizo. Si se quita el silencio, limpiamos el campo.
        const mutedBy = isMuted ? moderatorNick : null;
        const stmt = db.prepare('UPDATE users SET isMuted = ?, mutedBy = ? WHERE lower(nick) = ?');
        stmt.run(isMuted ? 1 : 0, mutedBy, nick.toLowerCase(), function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
        stmt.finalize();
    });
}

function setAvatarUrl(nick, avatarUrl) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET avatar_url = ? WHERE lower(nick) = ?', [avatarUrl, nick.toLowerCase()], function(err) {
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
    createUser, 
    verifyPassword, 
    setVipStatus,
    setMuteStatus,
    updateUserIP,
    setAvatarUrl,
    setUserRole
};