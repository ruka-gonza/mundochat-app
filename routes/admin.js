// routes/admin.js (CORREGIDO: Ruta de DB dinámica y corrección en /muted)
const express = require('express');
const router = express.Router();
const banService = require('../services/banService');
const userService = require('../services/userService');
const roomService = require('../services/roomService');
const sqlite3 = require('sqlite3').verbose();

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);

const isStaff = (req, res, next) => {
    try {
        const adminUser = req.cookies.adminUser ? JSON.parse(req.cookies.adminUser) : null;
        if (adminUser && ['owner', 'admin', 'mod'].includes(adminUser.role)) {
            req.moderator = adminUser;
            return next();
        }
        res.status(403).send('Acceso denegado');
    } catch (e) {
        res.status(403).send('Acceso denegado. Cookie inválida.');
    }
};

function obfuscateIP(ip) {
    if (!ip) return 'N/A';
    if (ip === '::1' || ip === '127.0.0.1') return ip;
    if (ip.includes(':')) {
        const parts = ip.split(':');
        return parts.length > 4 ? parts.slice(0, 4).join(':') + ':xxxx:xxxx' : ip;
    }
    if (ip.includes('.')) {
        const parts = ip.split('.');
        return parts.length === 4 ? parts.slice(0, 2).join('.') + '.x.x' : ip;
    }
    return 'IP Inválida';
}

router.get('/banned', isStaff, async (req, res) => {
    try {
        db.all('SELECT * FROM banned_users ORDER BY at DESC', [], (err, rows) => {
            if (err) {
                console.error("Error al obtener baneados:", err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            if (req.moderator.role === 'mod') {
                rows.forEach(user => { user.ip = obfuscateIP(user.ip); });
            }
            res.json(rows);
        });
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.get('/muted', isStaff, async (req, res) => {
    const io = req.io;
    try {
        const dbMutedUsersPromise = new Promise((resolve, reject) => {
            db.all('SELECT nick, role, isVIP, lastIP, mutedBy FROM users WHERE isMuted = 1', [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        let mutedUsers = await dbMutedUsersPromise;
        const mutedRegisteredNicks = new Set(mutedUsers.map(u => u.nick.toLowerCase()));
        
        const allSockets = await io.fetchSockets();
        for (const socket of allSockets) {
            const userData = socket.userData;
            if (userData && userData.isMuted && !mutedRegisteredNicks.has(userData.nick.toLowerCase())) {
                mutedUsers.push({
                    nick: userData.nick,
                    role: 'invitado',
                    isVIP: false,
                    lastIP: userData.ip,
                    mutedBy: userData.mutedBy || 'Moderador'
                });
            }
        }
        
        if (req.moderator.role === 'mod') {
            mutedUsers.forEach(user => {
                user.lastIP = obfuscateIP(user.lastIP);
            });
        }

        res.json(mutedUsers);

    } catch (error) {
        console.error("Error al obtener muteados:", error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.get('/online-users', isStaff, async (req, res) => {
    try {
        const io = req.io;
        const onlineUsers = [];
        const allSockets = await io.fetchSockets();

        for (const socket of allSockets) {
            try {
                if (socket.userData) {
                    const user = { ...socket.userData };
                    user.rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
                    if (req.moderator && req.moderator.role === 'mod') {
                        user.ip = obfuscateIP(user.ip);
                    }
                    onlineUsers.push(user);
                }
            } catch (e) {
                console.error(`Error procesando socket ${socket.id}:`, e.message);
            }
        }
        res.json(onlineUsers);
    } catch (error) {
        console.error("Error grave en la ruta /online-users:", error);
        res.status(500).json({ error: 'Error del servidor al obtener usuarios online.' });
    }
});

router.get('/activity-logs', isStaff, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = (parseInt(req.query.page) || 0) * limit;

    db.all('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
        if (err) {
            console.error("Error al obtener logs de actividad:", err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        if (req.moderator.role === 'mod') {
            rows.forEach(log => { log.ip = obfuscateIP(log.ip); });
        }
        res.json(rows);
    });
});

router.post('/unban', isStaff, async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'Se requiere el ID del usuario.' });
    }

    if (req.moderator.role === 'mod') {
        return res.status(403).json({ error: 'Los moderadores no pueden quitar baneos.' });
    }

    try {
        const success = await banService.unbanUser(userId.toLowerCase());
        if (success) {
            req.io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[UNBAN] ${req.moderator.nick} ha desbaneado a '${userId}' desde el panel.`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
            res.json({ message: `Usuario '${userId}' desbaneado con éxito.` });
        } else {
            res.status(404).json({ error: `Usuario '${userId}' no encontrado en la lista de baneados.` });
        }
    } catch (error) {
        console.error("Error en /api/admin/unban:", error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

router.post('/unmute', isStaff, async (req, res) => {
    const { nick } = req.body;
    if (!nick) {
        return res.status(400).json({ error: 'Se requiere el nick del usuario.' });
    }

    const io = req.io;

    try {
        await userService.setMuteStatus(nick, false);

        const targetSocketId = roomService.findSocketIdByNick(nick);
        if (targetSocketId) {
            const sockets = await io.fetchSockets();
            const targetSocket = sockets.find(s => s.id === targetSocketId);
            if (targetSocket && targetSocket.userData) {
                targetSocket.userData.isMuted = false;
                targetSocket.userData.mutedBy = null;
                targetSocket.emit('system message', { text: `Has sido des-silenciado por ${req.moderator.nick} desde el panel.`, type: 'warning' });
            }
        }
        
        io.to(roomService.MOD_LOG_ROOM).emit('system message', { text: `[UNMUTE] ${req.moderator.nick} ha quitado el silencio a '${nick}' desde el panel.`, type: 'mod-log', roomName: roomService.MOD_LOG_ROOM });
        res.json({ message: `Silencio quitado a '${nick}' con éxito.` });

    } catch (error) {
        console.error("Error en /api/admin/unmute:", error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;