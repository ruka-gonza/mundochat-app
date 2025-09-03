const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const passwordResetService = require('../services/passwordResetService');
const emailService = require('../services/emailService');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../services/db-connection');
const { v4: uuidv4 } = require('uuid');

const isProduction = process.env.NODE_ENV === 'production';

// Almacenamiento en memoria de tokens de sesión activos.
// La clave es el token, el valor son los datos del usuario.
const activeTokens = new Map();

// Exportamos el mapa de tokens para que otros módulos puedan usarlo (ej. isCurrentUser)
module.exports.activeTokens = activeTokens;


router.post('/register', async (req, res) => {
    const { nick, email, password } = req.body;
    const ip = req.ip;

    if (!nick || !email || !password) {
        return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }
    if (nick.length < 3 || nick.length > 15) {
        return res.status(400).json({ error: "El nick debe tener entre 3 y 15 caracteres." });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(nick)) {
        return res.status(400).json({ error: "El nick solo puede contener letras, números, guiones y guiones bajos." });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ error: "Formato de correo electrónico inválido." });
    }

    try {
        const existingUserByNick = await userService.findUserByNick(nick);
        if (existingUserByNick) {
            return res.status(400).json({ error: "Ese nick ya está registrado." });
        }
        
        const existingUserByEmail = await userService.findUserByNick(email);
        if (existingUserByEmail) {
            return res.status(400).json({ error: "Ese correo electrónico ya está en uso." });
        }

        await userService.createUser(nick, email, password, ip);
        res.status(201).json({ message: `¡Nick '${nick}' registrado con éxito! Ahora puedes iniciar sesión.` });

    } catch (error) {
        console.error("Error al registrar usuario:", error);
        res.status(500).json({ error: "Error interno del servidor al registrar el usuario." });
    }
});


router.post('/login', async (req, res) => {
    const { nick, password } = req.body;
    
    try {
        const user = await userService.findUserByNick(nick);
        if (!user) {
            return res.status(401).json({ error: "El nick o email no está registrado." });
        }

        const match = await userService.verifyPassword(password, user.password);
        if (!match) {
            return res.status(401).json({ error: "Contraseña incorrecta." });
        }
        
        const sessionData = {
            id: user.id,
            nick: user.nick,
            role: user.role
        };
        
        const authToken = uuidv4();
        activeTokens.set(authToken, sessionData);

        res.cookie('user_auth', JSON.stringify(sessionData), {
            httpOnly: false,
            sameSite: 'none',
            secure: isProduction,
            maxAge: 3600 * 1000
        });

        res.status(200).json({ 
            message: "Login successful", 
            userData: sessionData, 
            token: authToken 
        });

    } catch (error) {
        console.error("Error en la ruta /api/auth/login:", error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


router.post('/forgot-password', async (req, res) => {
    // ...
});

router.post('/reset-password', async (req, res) => {
    // ...
});

// Importante: Cambiamos cómo se exporta para poder acceder a activeTokens
const authRouter = router;
module.exports = authRouter;