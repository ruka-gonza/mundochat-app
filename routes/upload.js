const express = require('express');
const router = express.Router();
const db = require('../services/db-connection');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const roomService = require('../services/roomService');

const chatUploadsDir = path.join(__dirname, '..', 'data', 'chat_uploads');

async function ensureUploadsDir() {
    try {
        await fs.access(chatUploadsDir);
    } catch {
        await fs.mkdir(chatUploadsDir, { recursive: true });
    }
}

router.post('/chat-file', async (req, res) => {
    const { fileBase64, contextType, contextWith } = req.body;
    const sender = req.verifiedUser; // Del middleware isCurrentUser
    const io = req.io;

    if (!fileBase64 || !contextType || !contextWith) {
        return res.status(400).json({ error: 'Faltan datos para la subida.' });
    }
    
    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    // Expresión regular mejorada que acepta image/*, audio/*, y video/* (para webm)
    const match = fileBase64.match(/^data:((image|audio|video)\/([\w\+]+));base64,(.+)$/);
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

    if (!match) {
        return res.status(400).json({ error: 'Formato de archivo inválido.' });
    }

    const mimeType = match[1]; // ej: "audio/webm"
    const fileKind = match[2]; // 'image', 'audio', o 'video'
    const extension = match[3];  // ej: 'webm'
    const base64Data = match[4];
    const fileBuffer = Buffer.from(base64Data, 'base64');
    
    if (fileBuffer.length > 15 * 1024 * 1024) { // Límite de 15MB
        return res.status(413).json({ error: 'El archivo es demasiado grande.' });
    }

    try {
        await ensureUploadsDir();
        const fileName = `${uuidv4()}.${extension}`;
        const filePath = path.join(chatUploadsDir, fileName);
        await fs.writeFile(filePath, fileBuffer);
        
        const fileUrl = `data/chat_uploads/${fileName}`;
        
        // Determinar el tipo de preview correcto (image o audio)
        const previewType = fileKind === 'image' ? 'image' : 'audio';
        const textPlaceholder = `[${previewType === 'image' ? 'Imagen' : 'Audio'}: ${fileName}]`;

        const previewData = {
            type: previewType,
            url: fileUrl,
            title: fileName,
            image: previewType === 'image' ? fileUrl : null,
            description: `${previewType === 'image' ? 'Imagen' : 'Audio'} subido por el usuario`
        };

        const timestamp = new Date().toISOString();

        if (contextType === 'room') {
            const stmt = db.prepare(`INSERT INTO messages (roomName, nick, text, role, isVIP, timestamp, preview_type, preview_url, preview_title, preview_description, preview_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const lastId = await new Promise((resolve, reject) => {
                stmt.run(contextWith, sender.nick, textPlaceholder, sender.isVIP ? 1:0, timestamp, previewData.type, previewData.url, previewData.title, previewData.description, previewData.image, function(err) {
                    if (err) return reject(err);
                    resolve(this.lastID);
                });
                stmt.finalize();
            });
            const messagePayload = { id: lastId, text: textPlaceholder, nick: sender.nick, role: sender.role, isVIP: sender.isVIP, roomName: contextWith, timestamp, preview: previewData };
            io.to(contextWith).emit('chat message', messagePayload);

        } else if (contextType === 'private') {
            const stmt = db.prepare(`INSERT INTO private_messages (from_nick, to_nick, text, timestamp, preview_type, preview_url, preview_title, preview_description, preview_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const lastId = await new Promise((resolve, reject) => {
                stmt.run(sender.nick, contextWith, textPlaceholder, timestamp, previewData.type, previewData.url, previewData.title, previewData.description, previewData.image, function(err) {
                    if (err) return reject(err);
                    resolve(this.lastID);
                });
                stmt.finalize();
            });
            const messagePayload = { id: lastId, text: textPlaceholder, from: sender.nick, to: contextWith, role: sender.role, isVIP: sender.isVIP, timestamp, preview: previewData };
            const targetSocketId = roomService.findSocketIdByNick(contextWith);
            if (targetSocketId) {
                io.to(targetSocketId).emit('private message', messagePayload);
            }
            const mySocketId = roomService.findSocketIdByNick(sender.nick);
            if (mySocketId) {
                io.to(mySocketId).emit('private message', messagePayload);
            }
        }

        res.status(201).json({ success: true, message: 'Archivo subido y enviado.' });

    } catch (error) {
        console.error('Error al subir archivo de chat:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;