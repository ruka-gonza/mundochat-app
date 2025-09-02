const express = require('express');
const router = express.Router();
const roomService = require('../services/roomService');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');

router.post('/join', async (req, res) => {
    const { nick } = req.body;
    
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
    
    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    res.cookie('user_auth', JSON.stringify(sessionData), {
        httpOnly: false,
        sameSite: 'none', // Permite que la cookie se envíe en peticiones fetch
        secure: true,     // Requerido para sameSite: 'none'
        maxAge: 3600 * 1000 // 1 hora
    });
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

    res.status(200).json({ message: "Guest join successful", userData: sessionData });
});

module.exports = router;