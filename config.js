// config.js
// IMPORTANTE: Asegúrate de que 'require('dotenv').config();' sea la primera línea.
require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    ownerNick: process.env.OWNER_NICK || 'Admin',
    proxyCheckApiKey: process.env.PROXYCHECK_API_KEY || '',

    // Configuración para el envío de correos
    emailService: {
        host: process.env.EMAIL_HOST || 'smtp.example.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    resetTokenExpiresIn: process.env.RESET_TOKEN_EXPIRES_IN || '1h', // Tiempo de validez del token
    appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}` // URL base de tu app
};