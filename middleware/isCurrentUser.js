const userService = require('../services/userService');
const { closedSessions } = require('../socketManager');

const isCurrentUser = async (req, res, next) => {
    try {
        const authCookieString = req.cookies.user_auth;
        if (!authCookieString) {
            return res.status(401).json({ error: 'No autenticado: Faltan credenciales de sesión.' });
        }
        
        const sessionData = JSON.parse(authCookieString);
        if (!sessionData || !sessionData.id || !sessionData.nick) {
            return res.status(401).json({ error: 'No autenticado: Cookie con formato inválido.' });
        }

        if (sessionData.role !== 'guest') {
             const userInDb = await userService.findUserById(sessionData.id);
             if (!userInDb || userInDb.nick.toLowerCase() !== sessionData.nick.toLowerCase()) {
                res.clearCookie('user_auth');
                return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
             }
        }
        
        req.verifiedUser = sessionData;
        next();
    } catch (e) {
        console.error('Error en middleware isCurrentUser (probablemente cookie corrupta):', e);
        return res.status(400).json({ error: 'Cookie o token de sesión corrupto o inválido.' });
    }
};

module.exports = { isCurrentUser };