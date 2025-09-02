const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const roomService = require('../services/roomService');
const config = require('../config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'data', 'avatars');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        if (!req.verifiedUser || !req.verifiedUser.nick) {
            return cb(new Error("Usuario no verificado para subir archivo."));
        }
        const safeNick = req.verifiedUser.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_');
        const uniqueSuffix = Date.now() + '-' + safeNick;
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        if (filetypes.test(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten archivos de imagen.'));
    }
}).single('avatarFile');


// --- RUTA DE SUBIDA DE AVATAR ---
router.post('/avatar', upload, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se ha subido ningún archivo válido.' });
    }

    const { id: userId, nick: userNick } = req.verifiedUser;
    
    // LÍNEA ELIMINADA: Se ha quitado la comprobación estricta 'typeof userId !== "number"'
    // La base de datos manejará la conversión si es necesario.
    if (!userId) {
         return res.status(400).json({ error: 'ID de usuario inválido en la sesión.' });
    }

    const avatarUrl = `data/avatars/${req.file.filename}`;

    try {
        const success = await userService.setAvatarUrl(userId, avatarUrl);

        if (success) {
            const targetSocketId = roomService.findSocketIdByNick(userNick);
            if (targetSocketId) {
                const targetSocket = req.io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.userData.avatar_url = avatarUrl;
                    req.io.emit('user_data_updated', { nick: userNick, avatar_url: avatarUrl });
                }
            }
            res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });
        } else {
            res.status(404).json({ error: 'Usuario no encontrado en la base de datos (ID inválido).' });
        }
    } catch (error) {
        console.error('Error al guardar avatar en la DB:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// --- RUTA DE CAMBIO DE NICK (COMPLETADA) ---
router.post('/nick', async (req, res) => {
    const oldNick = req.verifiedUser.nick;
    const { newNick } = req.body;
    const io = req.io;

    if (oldNick.toLowerCase() === config.ownerNick.toLowerCase()) {
        return res.status(403).json({ error: 'Acción prohibida: El nick del Owner no se puede cambiar.' });
    }

    if (!newNick || newNick.trim() === '' || newNick.length < 3 || newNick.length > 15 || !/^[a-zA-Z0-9_-]+$/.test(newNick)) {
        return res.status(400).json({ error: 'Nick inválido (3-15 caracteres, solo letras, números, _-).' });
    }
    
    if (newNick.toLowerCase() === oldNick.toLowerCase()) {
        return res.status(400).json({ error: 'El nuevo nick es igual al actual.' });
    }

    try {
        const existingUser = await userService.findUserByNick(newNick);
        if (existingUser) {
            return res.status(400).json({ error: `El nick '${newNick}' ya está registrado.` });
        }
        
        const success = await userService.updateUserNick(oldNick, newNick);

        if (success) {
            const targetSocketId = roomService.findSocketIdByNick(oldNick);
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.userData.nick = newNick;
                    
                    targetSocket.emit('set session cookie', { 
                        id: targetSocket.userData.id,
                        nick: newNick,
                        role: targetSocket.userData.role
                    });

                    io.emit('user_data_updated', {
                        oldNick: oldNick,
                        nick: newNick
                    });
                }
            }
            res.json({ message: `Tu nick se ha cambiado a '${newNick}' con éxito.` });
        } else {
            res.status(500).json({ error: 'No se pudo cambiar el nick en la base de datos.' });
        }
    } catch (error) {
        console.error('Error al cambiar nick:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;