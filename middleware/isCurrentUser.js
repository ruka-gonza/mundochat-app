const userService = require('../services/userService');

const isCurrentUser = async (req, res, next) => {
    try {
        // 1. La única fuente de verdad para una petición HTTP es la cookie.
        const authCookieString = req.cookies.user_auth;
        if (!authCookieString) {
            return res.status(401).json({ error: 'No autenticado: Faltan credenciales de sesión.' });
        }
        
        // 2. Intentamos parsear la cookie. Si falla, el catch lo manejará.
        const sessionData = JSON.parse(authCookieString);
        if (!sessionData || !sessionData.id || !sessionData.nick) {
            return res.status(401).json({ error: 'No autenticado: Cookie con formato inválido.' });
        }

        // 3. Para usuarios registrados, verificamos que todavía existan en la DB.
        if (sessionData.role !== 'guest') {
             const userInDb = await userService.findUserById(sessionData.id);
             if (!userInDb || userInDb.nick.toLowerCase() !== sessionData.nick.toLowerCase()) {
                res.clearCookie('user_auth');
                return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
             }
        }
        
        // 4. Autenticación exitosa. Adjuntamos los datos a la petición.
        req.verifiedUser = sessionData;
        next();

    } catch (e) {
        // Este error se activa si JSON.parse falla (cookie corrupta).
        console.error('Error en middleware isCurrentUser (probablemente cookie corrupta):', e);
        return res.status(400).json({ error: 'Cookie o token de sesión corrupto o inválido.' });
    }
};

module.exports = { isCurrentUser };