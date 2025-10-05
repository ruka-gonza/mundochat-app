const express = require('express');
const path = require('path');
const router = express.Router();
const banService = require('../services/banService');
const userService = require('../services/userService');
const roomService = require('../services/roomService');

// Middleware para verificar si el usuario es parte del staff (cualquier nivel)
const isStaff = async (req, res, next) => {
    try {
        const userAuthCookie = req.cookies.user_auth ? JSON.parse(req.cookies.user_auth) : null;
        
        if (!userAuthCookie || !userAuthCookie.nick) {
            return res.status(403).json({ error: 'Acceso denegado: Cookie de sesión no encontrada.' });
        }

        const user = await userService.findUserByNick(userAuthCookie.nick);
        if (!user) {
            return res.status(403).json({ error: 'Acceso denegado: Usuario no encontrado.' });
        }

        // Permitimos el acceso a cualquier rol de staff
        const isGlobalStaff = ['owner', 'admin', 'mod', 'operator'].includes(user.role);
        
        if (!isGlobalStaff) {
            return res.status(403).json({ error: 'Acceso denegado: No tienes permisos de moderación.' });
        }

        // Adjuntamos los datos del moderador a la petición para usarlo después
        req.moderator = { nick: user.nick, role: user.role };
        return next();

    } catch (e) {
        console.error("Error en middleware isStaff:", e);
        res.status(500).json({ error: 'Error interno del servidor al verificar permisos.' });
    }
};

// --- INICIO DE LA LÓGICA DE SEGURIDAD CLAVE ---

// Función para ofuscar (ocultar parcialmente) una dirección IP
function obfuscateIP(ip) {
    if (!ip) return 'N/A';
    if (ip === '::1' || ip === '127.0.0.1') return ip; // No ofuscar IPs locales

    // Para IPv6
    if (ip.includes(':')) {
        const parts = ip.split(':');
        // Mostramos los primeros 4 bloques si hay suficientes
        return parts.length > 4 ? parts.slice(0, 4).join(':') + ':xxxx:xxxx' : ip;
    }
    // Para IPv4
    if (ip.includes('.')) {
        const parts = ip.split('.');
        return parts.length === 4 ? parts.slice(0, 2).join('.') + '.x.x' : ip;
    }
    return 'IP Inválida';
}
// --- FIN DE LA LÓGICA DE SEGURIDAD CLAVE ---


// Nueva ruta para servir el panel de moderadores
router.get('/mod-panel', isStaff, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'mod-panel.html'));
});

router.get('/reports', isStaff, (req, res) => {
    const db = require('../services/db-connection').getInstance();
    db.all("SELECT timestamp, details FROM activity_logs WHERE event_type = 'USER_REPORT' ORDER BY timestamp DESC", [], (err, rows) => {
        if (err) {
            console.error("Error al obtener denuncias:", err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        
        const reports = rows.map(log => {
            const parts = log.details.split(' | ');
            const reporter = parts[0] ? parts[0].replace('Denuncia de: ', '').trim() : 'Desconocido';
            const reported = parts[1] ? parts[1].replace('Hacia: ', '').trim() : 'Desconocido';
            const reason = parts[2] ? parts[2].replace('Razón: ', '').trim() : 'Sin razón';
            return {
                timestamp: log.timestamp,
                reporter,
                reported,
                reason
            };
        });
        
        res.json(reports);
    });
});

router.get('/banned', isStaff, async (req, res) => {
    try {
        const db = require('../services/db-connection').getInstance();
        db.all('SELECT * FROM banned_users ORDER BY at DESC', [], (err, rows) => {
            if (err) {
                console.error("Error al obtener baneados:", err);
                return res.status(500).json({ error: 'Error del servidor' });
            }
            // --- ¡SEGURIDAD! Si el rol es mod u operator, ofuscamos la IP ---
            if (['mod', 'operator'].includes(req.moderator.role)) {
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
        const db = require('../services/db-connection').getInstance();
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
        
        // --- ¡SEGURIDAD! Ofuscamos la IP para roles intermedios ---
        if (['mod', 'operator'].includes(req.moderator.role)) {
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

// Rutas solo para Admins/Owner (con IPs completas)
router.get('/online-users', isStaff, async (req, res) => {
    try {
        // Bloqueamos el acceso a esta información sensible para mods/ops
        if (['mod', 'operator'].includes(req.moderator.role)) {
            return res.status(403).json({ error: 'No tienes permiso para acceder a esta sección.' });
        }

        const io = req.io;
        const onlineUsers = [];
        const allSockets = await io.fetchSockets();

        for (const socket of allSockets) {
            try {
                if (socket.userData) {
                    const user = { ...socket.userData };
                    user.rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
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
    // Bloqueamos el acceso a esta información sensible para mods/ops
    if (['mod', 'operator'].includes(req.moderator.role)) {
        return res.status(403).json({ error: 'No tienes permiso para acceder a esta sección.' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const offset = (parseInt(req.query.page) || 0) * limit;
    const db = require('../services/db-connection').getInstance();

    db.all('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
        if (err) {
            console.error("Error al obtener logs de actividad:", err);
            return res.status(500).json({ error: 'Error del servidor' });
        }
        res.json(rows);
    });
});

router.post('/unban', isStaff, async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'Se requiere el ID del usuario.' });
    }
    
    try {
        const success = await banService.unbanUser(userId); 
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

router.get('/registered-users', isStaff, async (req, res) => {
    // Bloqueamos el acceso a esta información sensible para mods/ops
    if (['mod', 'operator'].includes(req.moderator.role)) {
        return res.status(403).json({ error: 'No tienes permiso para acceder a esta sección.' });
    }
    try {
        const users = await userService.getAllRegisteredUsers();
        res.json(users);
    } catch (error) {
        console.error('Error fetching registered users:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener usuarios registrados.' });
    }
});

module.exports = router;
