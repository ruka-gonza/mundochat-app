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
    
    const authToken = uuidv4();
    req.activeTokens.set(authToken, sessionData);

    const cookieOptions = {
        httpOnly: false,
    };

    if (isProduction) {
        cookieOptions.sameSite = 'none';
        cookieOptions.secure = true;
    } else {
        cookieOptions.sameSite = 'lax';
    }
    // Al no especificar maxAge, la cookie se borrará al cerrar el navegador.
    res.cookie('user_auth', JSON.stringify(sessionData), cookieOptions);

    res.status(200).json({ 
        message: "Guest join successful", 
        userData: sessionData,
        token: authToken 
    });
});

module.exports = router;