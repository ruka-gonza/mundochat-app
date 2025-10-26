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

             if (userInDb.nick.toLowerCase() !== sessionData.nick.toLowerCase()) {
                const io = req.io;
                let isValidIncognitoSession = false;

                if (io && sessionData.id) {
                    const socketId = roomService.findSocketIdByUserId(sessionData.id);
                    if (socketId) {
                        const userSocket = io.sockets.sockets.get(socketId);
                        if (userSocket && userSocket.userData) {
                            if (userSocket.userData.isIncognito && userSocket.userData.original_nick && userSocket.userData.original_nick.toLowerCase() === userInDb.nick.toLowerCase()) {
                                isValidIncognitoSession = true;
                            }
                        }
                    }
                }

                if (!isValidIncognitoSession) {
                    res.clearCookie('user_auth');
                    return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
                }
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