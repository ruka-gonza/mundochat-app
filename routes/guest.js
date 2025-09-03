const express = require('express');
const router = express.Router();
const roomService = require('../services/roomService');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');

const isProduction = process.env.NODE_ENV === 'production';

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
    
    // Importamos el mapa de tokens del módulo de autenticación
    const { activeTokens } = require('./auth.js');
    const authToken = uuidv4();
    activeTokens.set(authToken, sessionData);

    res.cookie('user_auth', JSON.stringify(sessionData), {
        httpOnly: false,
        sameSite: 'none',
        secure: isProduction,
        maxAge: 3600 * 1000
    });

    res.status(200).json({ 
        message: "Guest join successful", 
        userData: sessionData,
        token: authToken 
    });

    res.status(200).json({ 
        message: "Guest join successful", 
        userData: sessionData,
        token: authToken 
    });
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

    res.status(200).json({ message: "Guest join successful", userData: sessionData });
});

module.exports = router;