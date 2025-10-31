const userService = require('../services/userService');
const roomService = require('../services/roomService');

const isCurrentUser = async (req, res, next) => {
    try {
        const closedSessions = req.app.locals.closedSessions;

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
             if (!userInDb) {
                res.clearCookie('user_auth');
                return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
             }

             // Si los nicks no coinciden, es una sesión de incógnito.
             // Fusionamos los datos: usamos el ID y rol real de la BD para seguridad,
             // pero mantenemos el nick de la cookie que es el de incógnito.
             req.verifiedUser = {
                ...sessionData, // Mantenemos datos de la cookie como el nick de incógnito
                id: userInDb.id, // Sobrescribimos con el ID real de la BD
                role: userInDb.role, // Sobrescribimos con el ROL real de la BD para permisos
                originalNick: userInDb.nick, // Guardamos el nick original
                isIncognito: true // Marcamos explícitamente como incógnito
             };
             return next();
        }
        
        req.verifiedUser = sessionData;
        next();
    } catch (e) {
        console.error('Error en middleware isCurrentUser (probablemente cookie corrupta):', e);
        return res.status(400).json({ error: 'Cookie o token de sesión corrupto o inválido.' });
    }
};

module.exports = { isCurrentUser };