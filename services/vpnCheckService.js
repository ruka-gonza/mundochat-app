// services/vpnCheckService.js
const fetch = require('node-fetch');
const config = require('../config');

async function isVpn(ip) {
    // Si no hay clave de API, no hacemos la comprobación
    if (!config.proxyCheckApiKey) {
        console.warn('PROXYCHECK_API_KEY no está configurada. Se omitirá la verificación de VPN.');
        return false;
    }

    // No comprobar IPs locales
    if (ip === '::1' || ip === '127.0.0.1') {
        return false;
    }

    const url = `https://proxycheck.io/v2/${ip}?key=${config.proxyCheckApiKey}&vpn=1`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'ok') {
            // El servicio nos dice 'yes' si detecta una VPN o un proxy.
            if (data[ip].proxy === 'yes') {
                console.log(`[VPN DETECTADO] IP: ${ip}, Proveedor: ${data[ip].provider}`);
                return true;
            }
        } else if (data.status === 'error') {
            console.error('[VPN Check Error]', data.message);
        }

        return false;

    } catch (error) {
        console.error('Error al contactar la API de ProxyCheck:', error.message);
        // En caso de fallo de la API, permitimos la conexión para no bloquear a todos.
        return false;
    }
}

module.exports = { isVpn };