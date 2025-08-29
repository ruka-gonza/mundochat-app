const db = require('./db-connection'); // <-- USA LA CONEXIÓN COMPARTIDA
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config');
const ms = require('ms');

function generateSecureToken() {
    const rawToken = uuidv4() + crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, hashedToken };
}

async function createResetToken(userId) {
    const { rawToken, hashedToken } = generateSecureToken();
    const expiresAt = new Date(Date.now() + ms(config.resetTokenExpiresIn)).toISOString();
    const createdAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
        db.run('DELETE FROM password_reset_tokens WHERE userId = ?', [userId], (err) => {
            if (err) {
                console.error("Error al limpiar tokens antiguos:", err);
                return reject(err);
            }
            const stmt = db.prepare('INSERT INTO password_reset_tokens (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)');
            stmt.run(hashedToken, userId, expiresAt, createdAt, function(err) {
                if (err) return reject(err);
                resolve(rawToken);
            });
            stmt.finalize();
        });
    });
}

async function validateResetToken(rawToken) {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM password_reset_tokens WHERE token = ?', [hashedToken], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            const now = new Date();
            const expires = new Date(row.expiresAt);
            if (now > expires) {
                db.run('DELETE FROM password_reset_tokens WHERE token = ?', [hashedToken]);
                return resolve(null);
            }
            resolve(row);
        });
    });
}

async function invalidateResetToken(rawToken) {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM password_reset_tokens WHERE token = ?', [hashedToken], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

module.exports = {
    createResetToken,
    validateResetToken,
    invalidateResetToken
};