const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const roomService = require('../services/roomService'); // Necesitamos esto para encontrar el socket

// 1. Crear directorio si no existe
const tempUploadsDir = process.env.RENDER
  ? path.join(__dirname, '../data/temp_avatars')
  : path.join(__dirname, '../temp_avatars');

if (!fs.existsSync(tempUploadsDir)) {
    fs.mkdirSync(tempUploadsDir, { recursive: true });
}

// 2. Configurar Multer para archivos temporales
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempUploadsDir);
    },
    filename: function (req, file, cb) {
        const guestId = req.body.guestId || 'unknown-guest';
        const safeId = guestId.replace(/[^a-z0-9]/gi, '_');
        const uniqueSuffix = Date.now() + '-' + safeId;
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten archivos de imagen (jpeg, jpg, png, gif, webp).'));
    }
}).single('avatarFile');

// 3. Definir la ruta POST para la subida
router.post('/avatar', (req, res) => {
    upload(req, res, async function (err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo válido.' });
        }

        const { guestId } = req.body;
        const io = req.io;

        if (!guestId) {
            fs.unlinkSync(req.file.path); // Borrar archivo huérfano
            return res.status(400).json({ error: 'Falta el ID del invitado.' });
        }

        const socketId = roomService.guestSocketMap.get(guestId);
        const targetSocket = socketId ? io.sockets.sockets.get(socketId) : null;

        if (!targetSocket || targetSocket.userData.role !== 'guest') {
            fs.unlinkSync(req.file.path); // Borrar archivo si el usuario ya no existe
            return res.status(404).json({ error: 'No se encontró la sesión del invitado.' });
        }

        if (targetSocket.userData.temp_avatar_path) {
            fs.unlink(targetSocket.userData.temp_avatar_path, (err) => {
                if (err) console.error("No se pudo borrar el avatar temporal antiguo:", err);
            });
        }
        
        // =========================================================================
        // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
        // =========================================================================
        // La ruta web correcta debe incluir 'data/' al principio.
        const avatarUrl = `data/temp_avatars/${req.file.filename}`;
        // =========================================================================
        // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
        // =========================================================================

        // Actualizar datos en el socket
        targetSocket.userData.avatar_url = avatarUrl;
        targetSocket.userData.temp_avatar_path = req.file.path; // Ruta física para borrarlo después

        // Notificar a todos los clientes del cambio
        io.emit('user_data_updated', {
            nick: targetSocket.userData.nick,
            avatar_url: avatarUrl
        });

        res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });
    });
});

module.exports = router;