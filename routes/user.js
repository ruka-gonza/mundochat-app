// routes/user.js (MODIFICADO: Rutas de avatar dinámicas)
const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Lógica para determinar la ruta de subida de avatares
const uploadsDir = process.env.RENDER ? path.join(__dirname, '../data/avatars') : path.join(__dirname, '../public/avatars');

// Asegurarse de que el directorio existe
if (!fs.existsSync(uploadsDir)) {
    console.log(`Creando directorio para avatares en: ${uploadsDir}`);
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Configuración de Multer ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir); // Usa la ruta dinámica para guardar
    },
    filename: function (req, file, cb) {
        if (!req.body.nick) {
            return cb(new Error("El nick es requerido para nombrar el archivo."));
        }
        const safeNick = req.body.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_');
        const uniqueSuffix = Date.now() + '-' + safeNick;
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // Límite de 2MB
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

// --- Ruta para actualizar el avatar ---
router.post('/avatar', (req, res) => {
    upload(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            console.error("Error de Multer:", err.message);
            return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
        } else if (err) {
            console.error("Error desconocido en subida:", err.message);
            return res.status(400).json({ error: err.message });
        }

        const { nick } = req.body;
        const io = req.io;

        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo válido.' });
        }
        if (!nick) {
            return res.status(401).json({ error: 'No autenticado o nick no proporcionado.' });
        }

        // Lógica para determinar la URL pública del avatar
        const avatarUrl = process.env.RENDER ? `data/avatars/${req.file.filename}` : `avatars/${req.file.filename}`;

        try {
            const success = await userService.setAvatarUrl(nick, avatarUrl);
            if (success) {
                io.emit('user_avatar_changed', { nick, newAvatarUrl: avatarUrl });
                res.json({ 
                    message: 'Avatar actualizado con éxito.',
                    newAvatarUrl: avatarUrl 
                });
            } else {
                res.status(404).json({ error: 'Usuario no encontrado.' });
            }
        } catch (error) {
            console.error('Error al actualizar avatar en la DB:', error);
            res.status(500).json({ error: 'Error interno del servidor al guardar en la base de datos.' });
        }
    });
});

module.exports = router;