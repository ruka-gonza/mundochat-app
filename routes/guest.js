const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const roomService = require('../services/roomService');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');


// Configuración de Multer (se mantiene igual)
const tempUploadsDir = process.env.RENDER
  ? path.join(__dirname, '../data/temp_avatars')
  : path.join(__dirname, '../temp_avatars');

if (!fs.existsSync(tempUploadsDir)) {
    fs.mkdirSync(tempUploadsDir, { recursive: true });
}

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
    limits: { fileSize: 5 * 1024 * 1024 },
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

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
router.post('/join', async (req, res) => {
    const { nick } = req.body;
    
    // Validaciones del servidor
    if (!nick) return res.status(400).json({ error: "El nick es obligatorio." });
    if (nick.length < 3 || nick.length > 15) return res.status(400).json({ error: "El nick debe tener entre 3 y 15 caracteres." });
    const existingUser = await userService.findUserByNick(nick);
    if (existingUser) return res.status(400).json({ error: `El nick '${nick}' está registrado. Por favor, inicia sesión.` });
    if (roomService.isNickInUse(nick)) return res.status(400).json({ error: `El nick '${nick}' ya está en uso.` });

    const persistentId = uuidv4();
    const sessionData = {
        id: persistentId,
        nick: nick,
        role: 'guest'
    };
    
    // Establece la cookie con una expiración de 1 hora
    res.cookie('user_auth', JSON.stringify(sessionData), {
        httpOnly: false, // Permitir que JS la lea para re-autenticación
        sameSite: 'lax',
        maxAge: 3600 * 1000 // 1 hora en milisegundos
    });

    res.status(200).json({ message: "Guest join successful", userData: sessionData });
});
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================


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
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Falta el ID del invitado.' });
        }

        const socketId = roomService.guestSocketMap.get(guestId);
        const targetSocket = socketId ? io.sockets.sockets.get(socketId) : null;

        if (!targetSocket || targetSocket.userData.role !== 'guest') {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'No se encontró la sesión del invitado.' });
        }

        if (targetSocket.userData.temp_avatar_path) {
            fs.unlink(targetSocket.userData.temp_avatar_path, (err) => {
                if (err) console.error("No se pudo borrar el avatar temporal antiguo:", err);
            });
        }
        
        const avatarUrl = `data/temp_avatars/${req.file.filename}`;

        targetSocket.userData.avatar_url = avatarUrl;
        targetSocket.userData.temp_avatar_path = req.file.path;

        io.emit('user_data_updated', {
            nick: targetSocket.userData.nick,
            avatar_url: avatarUrl
        });

        res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });
    });
});

module.exports = router;