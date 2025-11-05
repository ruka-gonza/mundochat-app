const userService = require('../services/userService');

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

        if (sessionData.role === 'guest') {
            req.verifiedUser = sessionData;
            return next();
        }
        
        const userInDb = await userService.findUserById(sessionData.id);
        if (!userInDb) {
            res.clearCookie('user_auth');
            return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
        }

        const isIncognito = userInDb.nick !== sessionData.nick;

        req.verifiedUser = {
            ...sessionData, // nick de la cookie (puede ser el de incógnito)
            id: userInDb.id, // id real de la BD
            role: userInDb.role, // rol real de la BD
            originalNick: userInDb.nick, // nick real de la BD
            isIncognito: isIncognito
        };
        
        next();
    } catch (e) {
        console.error('Error en middleware isCurrentUser (probablemente cookie corrupta):', e);
        return res.status(400).json({ error: 'Cookie o token de sesión corrupto o inválido.' });
    }
};

module.exports = { isCurrentUser };