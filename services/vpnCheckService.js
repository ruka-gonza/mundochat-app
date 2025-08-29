const fetch = require('node-fetch');
const config = require('../config');

async function isVpn(ip) {
    if (!config.proxyCheckApiKey) {
        console.warn('PROXYCHECK_API_KEY no está configurada. Se omitirá la verificación de VPN.');
        return false;
    }

    // No comprobar IPs locales/privadas, ya que la API no las procesará
    const isPrivateIP = /^(::1|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)$/.test(ip);
    if (isPrivateIP) {
        return false;
    }

    const url = `https://proxycheck.io/v2/${ip}?key=${config.proxyCheckApiKey}&vpn=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            // Maneja errores de red o del servidor de la API
            console.error(`[VPN Check Error] La API respondió con el estado: ${response.status}`);
            return false;
        }
        
        const data = await response.json();

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Verificamos que la respuesta sea exitosa Y que contenga la información de la IP
        if (data.status === 'ok' && data[ip]) {
            if (data[ip].proxy === 'yes') {
                console.log(`[VPN DETECTADO] IP: ${ip}, Proveedor: ${data[ip].provider || 'Desconocido'}`);
                return true;
            }
        } else if (data.status === 'error') {
            console.error('[VPN Check Error]', data.message);
        } else {
            // Cubre casos donde el status es 'ok' pero la IP no viene en la respuesta.
            console.warn(`[VPN Check Warning] La respuesta de la API para la IP ${ip} fue inesperada:`, data);
        }
        // --- FIN DE LA CORRECCIÓN CLAVE ---

        return false;

    } catch (error) {
        console.error('Error al contactar la API de ProxyCheck:', error.message);
        // En caso de fallo, permitimos la conexión para no bloquear a todos.
        return false;
    }
}

module.exports = { isVpn };