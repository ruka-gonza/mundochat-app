const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userService = require('../services/userService');
const { getInstance } = require('../services/db-connection');
const { v4: uuidv4 } = require('uuid'); // Importamos uuid para IDs de mensajes privados
const roomService = require('../services/roomService'); // Necesitamos esto para encontrar al usuario

// --- DIRECTORIOS DE SUBIDA (sin cambios) ---
const avatarUploadPath = path.join(__dirname, '..', 'data', 'avatars');
const chatUploadPath = path.join(__dirname, '..', 'data', 'chat_uploads');
fs.mkdirSync(avatarUploadPath, { recursive: true });
fs.mkdirSync(chatUploadPath, { recursive: true });

// --- CONFIGURACIÓN DE MULTER PARA AVATARES (sin cambios) ---
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarUploadPath);
    },
    filename: function (req, file, cb) {
        const userId = req.verifiedUser.id;
        const uniqueSuffix = Date.now();
        cb(null, `user-${userId}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const avatarUpload = multer({ 
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Solo se permiten archivos de imagen.'), false);
        }
        cb(null, true);
    }
}).single('avatarFile');


// --- CONFIGURACIÓN DE MULTER PARA ARCHIVOS DE CHAT (sin cambios) ---
const chatStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, chatUploadPath);
    },
    filename: function (req, file, cb) {
        const senderNick = req.verifiedUser.nick;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${senderNick.replace(/[^a-zA-Z0-9]/g, '_')}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const chatUpload = multer({ 
    storage: chatStorage,
    limits: { fileSize: 50 * 1024 * 1024 }
}).single('chatFile');


// --- RUTAS ---

// RUTA PARA CAMBIAR AVATAR (sin cambios)
router.post('/avatar', (req, res) => {
    // ... (esta ruta no cambia)
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


// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
// RUTA PARA SUBIR ARCHIVOS DE CHAT (USA FormData)
router.post('/chat-file', chatUpload, (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }

    const { contextType, contextWith } = req.body;
    const sender = req.verifiedUser;
    const io = req.io;
    const db = getInstance();

    const fileUrl = `/data/chat_uploads/${req.file.filename}`;
    const fileType = req.file.mimetype;
    const timestamp = new Date().toISOString();

    if (contextType === 'room') {
        const stmt = db.prepare(
            'INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp, file_url, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run(contextWith, sender.nick, '', sender.role, sender.isVIP ? 1 : 0, timestamp, fileUrl, fileType, function(err) {
            if (err) {
                console.error("Error guardando mensaje de archivo de sala:", err);
                fs.unlink(req.file.path, () => {});
                return res.status(500).json({ error: 'Error al guardar en la base de datos.' });
            }

            const messagePayload = {
                id: this.lastID,
                nick: sender.nick,
                role: sender.role,
                isVIP: sender.isVIP,
                file: fileUrl,
                type: fileType,
                timestamp: timestamp,
                roomName: contextWith
            };

            io.to(contextWith).emit('chat message', messagePayload);
            res.json({ success: true, message: 'Archivo subido y enviado a la sala.', messagePayload });
        });
        stmt.finalize();

    } else if (contextType === 'private') {
        const recipientNick = contextWith;
        const stmt = db.prepare(
            'INSERT INTO private_messages (from_nick, to_nick, text, timestamp, file_url, file_type) VALUES (?, ?, ?, ?, ?, ?)'
        );
        stmt.run(sender.nick, recipientNick, '', timestamp, fileUrl, fileType, function(err) {
            if (err) {
                console.error("Error guardando mensaje de archivo privado:", err);
                fs.unlink(req.file.path, () => {});
                return res.status(500).json({ error: 'Error al guardar en la base de datos.' });
            }

            const messagePayload = {
                id: uuidv4(), // Los privados usan UUID para evitar colisiones de ID
                from: sender.nick,
                to: recipientNick,
                role: sender.role,
                isVIP: sender.isVIP,
                file: fileUrl,
                type: fileType,
                timestamp: timestamp
            };
            
            const targetSocketId = roomService.findSocketIdByNick(recipientNick);
            const senderSocketId = roomService.findSocketIdByNick(sender.nick);

            // Enviar al destinatario si está conectado
            if (targetSocketId) {
                io.to(targetSocketId).emit('private message', messagePayload);
            }
            // Enviar un eco de vuelta al remitente para que vea su propio mensaje
            if (senderSocketId) {
                io.to(senderSocketId).emit('private message', messagePayload);
            }

            res.json({ success: true, message: 'Archivo subido y enviado de forma privada.', messagePayload });
        });
        stmt.finalize();

    } else {
        fs.unlink(req.file.path, () => {}); // Borra el archivo si el contexto no es válido
        res.status(400).json({ error: 'Tipo de contexto no válido.' });
    }
});
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================

module.exports = router;