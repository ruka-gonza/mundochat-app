// services/emailService.js
const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
    host: config.emailService.host,
    port: config.emailService.port,
    secure: config.emailService.secure,
    auth: {
        user: config.emailService.user,
        pass: config.emailService.pass
    }
});

async function sendPasswordResetEmail(toEmail, resetLink) {
    const mailOptions = {
        from: `MundoChat <${config.emailService.user}>`, // Remitente visible
        to: toEmail,
        subject: 'Restablecer contraseña de MundoChat',
        html: `
            <p>Hola,</p>
            <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de MundoChat.</p>
            <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
            <p><a href="${resetLink}">${resetLink}</a></p>
            <p>Este enlace expirará en ${config.resetTokenExpiresIn}.</p>
            <p>Si no solicitaste un restablecimiento de contraseña, ignora este correo electrónico.</p>
            <p>Saludos,</p>
            <p>El equipo de MundoChat</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo de restablecimiento enviado a ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`Error al enviar correo de restablecimiento a ${toEmail}:`, error);
        return false;
    }
}

module.exports = { sendPasswordResetEmail };