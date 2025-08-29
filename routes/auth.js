const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const passwordResetService = require('../services/passwordResetService');
const emailService = require('../services/emailService');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../services/db-connection');


// Ruta para solicitar restablecimiento de contraseña
router.post('/forgot-password', async (req, res) => {
    const { identifier } = req.body; // Puede ser nick o email

    if (!identifier) {
        return res.status(400).json({ error: 'Por favor, introduce tu nick o correo electrónico.' });
    }

    try {
        // Busca al usuario por nick O por email
        const user = await userService.findUserByNick(identifier);
        if (!user) {
            // Es importante no revelar si el usuario existe o no por razones de seguridad
            // Devuelve un mensaje genérico incluso si el identificador no existe
            return res.json({ message: 'Si el nick o correo electrónico están registrados, recibirás un enlace para restablecer tu contraseña.' });
        }

        // Si el usuario se encontró pero no tiene email (ej: usuario antiguo sin email al registrarse)
        if (!user.email) {
            return res.status(400).json({ error: 'Tu cuenta no tiene un correo electrónico asociado para la recuperación de contraseña. Contacta a un administrador.' });
        }

        const resetToken = await passwordResetService.createResetToken(user.id);
        const resetLink = `${config.appBaseUrl}/reset-password.html?token=${resetToken}`;

        // Usa el email real del usuario encontrado
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

// Ruta para restablecer la contraseña (POST)
router.post('/reset-password', async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }
    if (newPassword.length < 6) { // Ejemplo de validación mínima
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        const tokenData = await passwordResetService.validateResetToken(token);
        if (!tokenData) {
            return res.status(400).json({ error: 'Token de restablecimiento inválido o expirado.' });
        }

        const user = await userService.findUserById(tokenData.userId); // userId en tokens es el ID interno
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' }); // Esto no debería pasar si el token es válido
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id], function(err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            });
        });
        
        await passwordResetService.invalidateResetToken(token); // Invalida el token después de usarlo

        res.json({ message: 'Contraseña restablecida con éxito. Ya puedes iniciar sesión.' });

    } catch (error) {
        console.error('Error en /reset-password POST:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;