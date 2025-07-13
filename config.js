// config.js (MODIFICADO: Añadida la clave para la API de ProxyCheck)
require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    ownerNick: process.env.OWNER_NICK || 'Admin',
    proxyCheckApiKey: process.env.PROXYCHECK_API_KEY || '' // <-- AÑADIDO
};