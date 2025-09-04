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

const activeTokens = new Map();
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
        
        const sessionData = { id: user.id, nick: user.nick, role: user.role };
        const authToken = uuidv4();
        activeTokens.set(authToken, sessionData);

        const cookieOptions = {
            httpOnly: false,
            maxAge: 3600 * 1000, // 1 hora
        };

        if (isProduction) {
            cookieOptions.sameSite = 'none';
            cookieOptions.secure = true;
        } else {
            cookieOptions.sameSite = 'lax';
        }
        res.cookie('user_auth', JSON.stringify(sessionData), cookieOptions);

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
    const { identifier } = req.body; 

    if (!identifier) {
        return res.status(400).json({ error: 'Por favor, introduce tu nick o correo electrónico.' });
    }

    try {
        const user = await userService.findUserByNick(identifier);
        if (!user) {
            return res.json({ message: 'Si el nick o correo electrónico están registrados, recibirás un enlace para restablecer tu contraseña.' });
        }

        if (!user.email) {
            return res.status(400).json({ error: 'Tu cuenta no tiene un correo electrónico asociado para la recuperación de contraseña. Contacta a un administrador.' });
        }

        const resetToken = await passwordResetService.createResetToken(user.id);
        const resetLink = `${config.appBaseUrl}/reset-password.html?token=${resetToken}`;

        const emailSent = await emailService.sendPasswordResetEmail(user.email, resetLink);

        if (emailSent) {
            res.json({ message: 'Si el nick o correo electrónico están registrados, recibirás un enlace para restablecer tu contraseña.' });
        } else {
            res.status(500).json({ error: 'No se pudo enviar el correo de restablecimiento. Inténtalo de nuevo más tarde.' });
        }

    } catch (error) {
        console.error('Error en /forgot-password:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }
    if (newPassword.length < 6) { 
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        const tokenData = await passwordResetService.validateResetToken(token);
        if (!tokenData) {
            return res.status(400).json({ error: 'Token de restablecimiento inválido o expirado.' });
        }

        const user = await userService.findUserById(tokenData.userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id], function(err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
        
        await passwordResetService.invalidateResetToken(token);

        res.json({ message: 'Contraseña restablecida con éxito. Ya puedes iniciar sesión.' });

    } catch (error) {
        console.error('Error en /reset-password POST:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

const authRouter = router;
module.exports = authRouter;