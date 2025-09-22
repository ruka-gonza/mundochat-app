const express = require('express');
const router = express.Router();
const db = require('../services/db-connection').getInstance();
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
    
    const match = fileBase64.match(/^data:((image|audio|video)\/([a-zA-Z0-9\w\-\+]+)(;[a-zA-Z0-9\w\-\+=;.\s]*)?);base64,(.+)$/);
    if (!match) {
        const debugMatch = fileBase64.match(/^data:([a-zA-Z0-9\/_\-\+;=\s]+);base64,/);
        const receivedType = debugMatch ? debugMatch[1] : 'Desconocido';
        console.error(`[DEBUG] Formato de archivo rechazado. Tipo recibido: ${receivedType}`);
        return res.status(400).json({ 
            error: `Formato de archivo inválido. El servidor recibió el tipo: ${receivedType}` 
        });
    }

    const mimeType = match[1];
    const fileKind = match[2];
    // Tomar solo la parte principal de la extensión, antes de cualquier ';'
    const extension = match[3].split(';')[0].replace('x-matroska', 'mkv'); 
    const base64Data = match[5];
    const fileBuffer = Buffer.from(base64Data, 'base64');
    
    if (fileBuffer.length > 15 * 1024 * 1024) {
        return res.status(413).json({ error: 'El archivo es demasiado grande.' });
    }

    try {
        await ensureUploadsDir();
        const fileName = `${uuidv4()}.${extension}`;
        const filePath = path.join(chatUploadsDir, fileName);
        await fs.writeFile(filePath, fileBuffer);
        
        const fileUrl = `data/chat_uploads/${fileName}`;
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
            const { lastID } = await new Promise((resolve, reject) => {
                stmt.run(contextWith, sender.nick, textPlaceholder, sender.role, sender.isVIP ? 1:0, timestamp, previewData.type, previewData.url, previewData.title, previewData.description, previewData.image, function(err) {
                    if (err) return reject(err);
                    resolve(this);
                });
                stmt.finalize();
            });
            const messagePayload = { id: lastID, text: textPlaceholder, nick: sender.nick, role: sender.role, isVIP: sender.isVIP, roomName: contextWith, timestamp, preview: previewData };
            io.to(contextWith).emit('chat message', messagePayload);

        } else if (contextType === 'private') {
            const fromNickForDB = sender.nick; // El nick real para la BD
            const fromNickForSocket = senderNick || sender.nick; // El nick del socket (incógnito o real)

            const stmt = db.prepare(`INSERT INTO private_messages (from_nick, to_nick, text, timestamp, preview_type, preview_url, preview_title, preview_description, preview_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const { lastID } = await new Promise((resolve, reject) => {
                stmt.run(fromNickForDB, contextWith, textPlaceholder, timestamp, previewData.type, previewData.url, previewData.title, previewData.description, previewData.image, function(err) {
                    if (err) return reject(err);
                    resolve(this);
                });
                stmt.finalize();
            });
            const messagePayload = { id: lastID, text: textPlaceholder, from: fromNickForSocket, to: contextWith, role: sender.role, isVIP: sender.isVIP, timestamp, preview: previewData };
            const targetSocketId = roomService.findSocketIdByNick(contextWith);
            if (targetSocketId) io.to(targetSocketId).emit('private message', messagePayload);
            
            const mySocketId = roomService.findSocketIdByNick(fromNickForSocket);
            if (mySocketId) io.to(mySocketId).emit('private message', messagePayload);
        }

        res.status(201).json({ success: true, message: 'Archivo subido y enviado.' });

    } catch (error) {
        console.error('Error al subir archivo de chat:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor.',
            detalle: error.message
        });
    }
});

module.exports = router;