const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const roomService = require('../services/roomService');
const config = require('../config');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const uploadsDir = path.join(__dirname, '..', 'data', 'avatars');
const tempUploadsDir = path.join(__dirname, '..', 'data', 'temp_avatars');

async function ensureDirs() {
    try {
        await fs.access(uploadsDir);
    } catch {
        await fs.mkdir(uploadsDir, { recursive: true });
    }
    try {
        await fs.access(tempUploadsDir);
    } catch {
        await fs.mkdir(tempUploadsDir, { recursive: true });
    }
}

router.post('/avatar', async (req, res) => {
    const { avatarBase64 } = req.body;
    const { id, nick, role } = req.verifiedUser;
    const io = req.io;

    if (!avatarBase64) {
        return res.status(400).json({ error: 'No se ha proporcionado ninguna imagen.' });
    }

    const match = avatarBase64.match(/^data:(image\/(\w+));base64,(.+)$/);
    if (!match) {
        return res.status(400).json({ error: 'Formato de imagen inválido.' });
    }

    const imageType = match[2];
    const base64Data = match[3];
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    const MAX_SIZE_MB = 5;
    if (imageBuffer.length > MAX_SIZE_MB * 1024 * 1024) {
        return res.status(413).json({ error: `La imagen es demasiado grande (máx ${MAX_SIZE_MB}MB).` });
    }

    try {
        await ensureDirs();

        const isGuest = role === 'guest';
        const fileName = `${uuidv4()}.${imageType}`;
        const targetDir = isGuest ? tempUploadsDir : uploadsDir;
        const filePath = path.join(targetDir, fileName);
        const avatarUrl = `data/${isGuest ? 'temp_avatars' : 'avatars'}/${fileName}`;

        await fs.writeFile(filePath, imageBuffer);
        
        const targetSocket = roomService.findSocketIdByNick(nick) ? io.sockets.sockets.get(roomService.findSocketIdByNick(nick)) : null;

        if (isGuest) {
            if (targetSocket) {
                if (targetSocket.userData.temp_avatar_path) {
                    await fs.unlink(targetSocket.userData.temp_avatar_path).catch(err => console.error("No se pudo borrar el avatar temporal antiguo:", err));
                }
                targetSocket.userData.avatar_url = avatarUrl;
                targetSocket.userData.temp_avatar_path = filePath;
            }
        } else {
            await userService.setAvatarUrl(id, avatarUrl);
            if (targetSocket) {
                targetSocket.userData.avatar_url = avatarUrl;
            }
        }
        
        io.emit('user_data_updated', { nick: nick, avatar_url: avatarUrl });
        res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });

    } catch (error) {
        console.error('Error al guardar avatar Base64:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la imagen.' });
    }
});

router.post('/nick', async (req, res) => {
    const { id: userId, nick: oldNick } = req.verifiedUser;
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
        
        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Si el nick existe, pero pertenece al MISMO usuario que hace la petición (comprobando por ID),
        // entonces no es un error. Esto permite cambiar A->B y luego B->A.
        // Solo lanzamos error si el nick pertenece a OTRO usuario.
        if (existingUser && existingUser.id !== userId) {
            return res.status(400).json({ error: `El nick '${newNick}' ya está registrado por otro usuario.` });
        }
        // --- FIN DE LA CORRECCIÓN CLAVE ---
        
        const success = await userService.updateUserNick(oldNick, newNick);

        if (success) {
            const targetSocketId = roomService.findSocketIdByNick(oldNick);
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    // 1. Actualizar el estado principal del socket
                    targetSocket.userData.nick = newNick;
                    
                    // 2. Sincronizar el estado actualizado en todas las salas del servidor
                    roomService.updateUserDataInAllRooms(targetSocket);
                    
                    // 3. Enviar evento para que el cliente actualice su cookie
                    targetSocket.emit('set session cookie', { 
                        id: targetSocket.userData.id,
                        nick: newNick,
                        role: targetSocket.userData.role
                    });
                    
                    // 4. Emitir evento global para cambios cosméticos (ej. en listas de chats privados)
                    io.emit('user_data_updated', {
                        oldNick: oldNick,
                        nick: newNick
                    });

                    // 5. Forzar la re-emisión de la lista de usuarios en todas las salas del usuario
                    targetSocket.joinedRooms.forEach(room => {
                        if (room !== targetSocket.id) {
                            roomService.updateUserList(io, room);
                        }
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