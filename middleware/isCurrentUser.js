const userService = require('../services/userService');
const { activeTokens } = require('../routes/auth.js'); // Importar tokens

const isCurrentUser = async (req, res, next) => {
    try {
        let sessionData = null;

        // --- MÉTODO 1: Verificar Cabecera de Autorización (Preferido) ---
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            if (activeTokens.has(token)) {
                sessionData = activeTokens.get(token);
            }
        }

        // --- MÉTODO 2: Verificar Cookie (Respaldo) ---
        if (!sessionData) {
            const authCookieString = req.cookies.user_auth;
            if (authCookieString) {
                sessionData = JSON.parse(authCookieString);
            }
        }

        // --- Validación Final ---
        if (!sessionData || !sessionData.id || !sessionData.nick) {
            return res.status(401).json({ error: 'No autenticado: Faltan credenciales de sesión.' });
        }
        
        // Verificamos que el usuario aún exista en la DB (para usuarios registrados)
        if (sessionData.role !== 'guest') {
             const userInDb = await userService.findUserById(sessionData.id);
             if (!userInDb || userInDb.nick.toLowerCase() !== sessionData.nick.toLowerCase()) {
                return res.status(401).json({ error: 'Sesión inválida. Vuelve a iniciar sesión.' });
             }
        }
        
        req.verifiedUser = sessionData;
        next();

    } catch (e) {
        return res.status(400).json({ error: 'Cookie o token de sesión corrupto o inválido.' });
    }
};

module.exports = { isCurrentUser };