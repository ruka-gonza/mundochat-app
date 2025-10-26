const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userService = require('../services/userService');
const roomService = require('../services/roomService');

// --- DIRECTORIOS DE SUBIDA ---
const avatarUploadPath = path.join(__dirname, '..', 'data', 'avatars');
const chatUploadPath = path.join(__dirname, '..', 'data', 'chat_uploads');
fs.mkdirSync(avatarUploadPath, { recursive: true });
fs.mkdirSync(chatUploadPath, { recursive: true });

// --- CONFIGURACIÓN DE MULTER PARA AVATARES ---
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarUploadPath);
    },
    filename: function (req, file, cb) {
        const userId = req.verifiedUser.id;
        cb(null, `user-${userId}${path.extname(file.originalname)}`);
    }
});

const avatarUpload = multer({ 
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB para avatares
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Solo se permiten archivos de imagen.'), false);
        }
        cb(null, true);
    }
}).single('avatarFile');


// --- CONFIGURACIÓN DE MULTER PARA ARCHIVOS DE CHAT ---
const chatStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, chatUploadPath);
    },
    filename: function (req, file, cb) {
        const senderNick = req.verifiedUser.nick;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${senderNick}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const chatUpload = multer({ 
    storage: chatStorage,
    limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB para archivos de chat
}).single('chatFile');


// --- RUTAS ---

// RUTA PARA CAMBIAR AVATAR (USA FormData)
router.post('/avatar', (req, res) => {
    avatarUpload(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Error de Multer: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo de avatar.' });
        }

        const avatarUrl = `/data/avatars/${req.file.filename}`;
        const userId = req.verifiedUser.id;
        const userNick = req.verifiedUser.nick;

        try {
            await userService.setAvatarUrl(userId, avatarUrl);
            req.io.emit('user_avatar_changed', { nick: userNick, newAvatarUrl: avatarUrl });
            res.json({ message: 'Avatar actualizado correctamente.', newAvatarUrl: avatarUrl });
        } catch (dbError) {
            console.error('Error al actualizar la URL del avatar en la BD:', dbError);
            res.status(500).json({ error: 'Error al guardar el avatar en la base de datos.' });
        }
    });
});


// RUTA PARA SUBIR ARCHIVOS DE CHAT (USA FormData)
router.post('/chat-file', chatUpload, (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }

    const { contextType, contextWith } = req.body;
    const sender = req.verifiedUser;
    const io = req.io;

    // Construir la URL pública del archivo
    const fileUrl = `/data/chat_uploads/${req.file.filename}`;
    const isImage = req.file.mimetype.startsWith('image/');
    const isAudio = req.file.mimetype.startsWith('audio/');

    const messagePayload = {
        id: `file-${Date.now()}`,
        nick: sender.nick,
        from: sender.nick,
        role: sender.role,
        isVIP: sender.isVIP,
        preview: {
            type: isImage ? 'image' : (isAudio ? 'audio' : 'file'),
            url: fileUrl,
            title: req.file.originalname,
            image: isImage ? fileUrl : null,
            description: `Archivo ${isImage ? 'de imagen' : (isAudio ? 'de audio' : '')} compartido.`
        },
        timestamp: new Date().toISOString()
    };

    if (contextType === 'room') {
        messagePayload.roomName = contextWith;
        io.to(contextWith).emit('chat message', messagePayload);
    } else if (contextType === 'private') {
        messagePayload.to = contextWith;
        const targetSocketId = roomService.findSocketIdByNick(contextWith);
        if (targetSocketId) {
            io.to(targetSocketId).emit('private message', messagePayload);
        }
        // Enviar eco al remitente
        io.to(req.socketId).emit('private message', messagePayload); // Asumiendo que adjuntas socketId en un middleware
    }

    res.json({ message: 'Archivo subido y enviado correctamente.' });
});

module.exports = router;