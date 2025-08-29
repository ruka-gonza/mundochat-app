const express = require('express');
const router = express.Router(); // <--- ¡LA LÍNEA MÁS IMPORTANTE QUE FALTABA!
const userService = require('../services/userService');
const roomService = require('../services/roomService');
const config = require('../config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = process.env.RENDER ? path.join(__dirname, '../data/avatars') : path.join(__dirname, '../avatars');

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
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten archivos de imagen (jpeg, jpg, png, gif).'));
    }
}).single('avatarFile');

router.post('/avatar', (req, res) => {
    const oldNick = req.verifiedUser.nick;
    
    upload(req, res, async function (err) {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo válido.' });

        const avatarUrl = process.env.RENDER ? `data/avatars/${req.file.filename}` : `avatars/${req.file.filename}`;

        try {
            const success = await userService.setAvatarUrl(oldNick, avatarUrl);
            if (success) {
                const targetSocketId = roomService.findSocketIdByNick(oldNick);
                if (targetSocketId) {
                    const targetSocket = req.io.sockets.sockets.get(targetSocketId);
                    if (targetSocket) {
                        targetSocket.userData.avatar_url = avatarUrl;
                        req.io.emit('user_data_updated', { nick: oldNick, avatar_url: avatarUrl });
                    }
                }
                res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });
            } else {
                res.status(404).json({ error: 'Usuario no encontrado.' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Error interno del servidor al guardar en la base de datos.' });
        }
    });
});

router.post('/nick', async (req, res) => {
    const oldNick = req.verifiedUser.nick;
    const { newNick } = req.body;
    const io = req.io;

    if (oldNick.toLowerCase() === config.ownerNick.toLowerCase()) {
        return res.status(403).json({ error: 'Acción prohibida: El nick del Owner no se puede cambiar desde la aplicación.' });
    }

    if (!newNick || newNick.trim() === '') return res.status(400).json({ error: 'El nuevo nick no puede estar vacío.' });
    if (newNick.length < 3 || newNick.length > 15) return res.status(400).json({ error: "El nick debe tener entre 3 y 15 caracteres." });
    if (!/^[a-zA-Z0-9_-]+$/.test(newNick)) return res.status(400).json({ error: "El nick solo puede contener letras, números, guiones y guiones bajos." });
    
    if (newNick.toLowerCase() === oldNick.toLowerCase() && newNick !== oldNick) {
        // Permitir el cambio si es solo de capitalización
    } else if (newNick.toLowerCase() === oldNick.toLowerCase()) {
        return res.status(400).json({ error: 'El nuevo nick es igual al actual.' });
    }

    try {
        const existingUser = await userService.findUserByNick(newNick);
        if (existingUser && existingUser.id !== req.verifiedUser.id) {
            return res.status(400).json({ error: `El nick '${newNick}' ya está registrado por otro usuario.` });
        }
        
        const socketIdInUse = roomService.findSocketIdByNick(newNick);
        const mySocketId = roomService.findSocketIdByNick(oldNick);
        if (socketIdInUse && socketIdInUse !== mySocketId) {
             return res.status(400).json({ error: `El nick '${newNick}' ya está en uso por un usuario conectado.` });
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

                    io.emit('system message', { text: `${oldNick} ahora es conocido como ${newNick}.`, type: 'highlight' });
                    
                    io.emit('user_data_updated', {
                        oldNick: oldNick,
                        nick: newNick,
                        role: targetSocket.userData.role,
                        isVIP: targetSocket.userData.isVIP,
                        avatar_url: targetSocket.userData.avatar_url,
                        id: targetSocket.userData.id
                    });
                }
            }
            res.json({ message: `Tu nick se ha cambiado a '${newNick}' con éxito.` });
        } else {
            res.status(500).json({ error: 'No se pudo cambiar el nick en la base de datos.' });
        }
    } catch (error) {
        console.error('Error al cambiar nick:', error);
        res.status(500).json({ error: 'Error interno del servidor al cambiar el nick.' });
    }
});

// La línea que exporta el router para que sea usado en server.js
module.exports = router;