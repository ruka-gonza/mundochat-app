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

// Función para asegurar que los directorios existan
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
    const { id, nick, role } = req.verifiedUser; // Esto viene del middleware isCurrentUser
    const io = req.io;

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    // Se ha ELIMINADO el bloque que buscaba el socket y devolvía un error 403.
    // Ahora esta ruta procesará la petición sin comprobar el modo incógnito,
    // ya que el cliente (modals.js) ya se encarga de no llamar a esta ruta
    // para los admins en modo incógnito. Esto permite que los 'guests'
    // puedan seguir cambiando su avatar.
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

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
        
        const targetSocketId = roomService.findSocketIdByUserId(id);
        const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;
        
        if (targetSocket) {
            const currentNick = targetSocket.userData.nick;

            if (isGuest) {
                if (targetSocket.userData.temp_avatar_path) {
                    await fs.unlink(targetSocket.userData.temp_avatar_path).catch(err => console.error("No se pudo borrar el avatar temporal antiguo:", err));
                }
                targetSocket.userData.avatar_url = avatarUrl;
                targetSocket.userData.temp_avatar_path = filePath;
                roomService.updateUserDataInAllRooms(targetSocket);
            } else {
                await userService.setAvatarUrl(id, avatarUrl);
                targetSocket.userData.avatar_url = avatarUrl;
                roomService.updateUserDataInAllRooms(targetSocket);
            }
            
            io.emit('user_data_updated', { nick: currentNick, avatar_url: avatarUrl });
        } else {
            if (!isGuest) {
                 await userService.setAvatarUrl(id, avatarUrl);
            }
        }
        
        res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });

    } catch (error) {
        console.error('Error al guardar avatar Base64:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la imagen.' });
    }
});


// RUTA DE CAMBIO DE NICK (sin cambios)
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
        
        if (existingUser && existingUser.id !== userId) {
            return res.status(400).json({ error: `El nick '${newNick}' ya está registrado por otro usuario.` });
        }
        
        const success = await userService.updateUserNick(oldNick, newNick);

        if (success) {
            const targetSocketId = roomService.findSocketIdByNick(oldNick);
            if (targetSocketId) {
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.userData.nick = newNick;
                    
                    roomService.updateUserDataInAllRooms(targetSocket);
                    
                    targetSocket.emit('set session cookie', { 
                        id: targetSocket.userData.id,
                        nick: newNick,
                        role: targetSocket.userData.role
                    });
                    
                    io.emit('user_data_updated', {
                        oldNick: oldNick,
                        nick: newNick
                    });

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