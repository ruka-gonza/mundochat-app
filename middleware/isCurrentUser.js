const userService = require('../services/userService');
const { closedSessions } = require('../socketManager');
const roomService = require('../services/roomService'); // Importar roomService

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
             if (!userInDb) { // Si el usuario no existe en la BD, la sesión es inválida
                res.clearCookie('user_auth');
                return res.status(401).json({ error: 'Sesión inválida. Por favor, vuelve a iniciar sesión.' });
             }

             // Si el nick de la cookie no coincide con el de la BD
             if (userInDb.nick.toLowerCase() !== sessionData.nick.toLowerCase()) {
                // Intentar verificar si el usuario está en modo incógnito
                const io = global.io; // Acceder a la instancia global de io
                let isValidIncognitoSession = false;

                if (io && sessionData.id) {
                    // Buscar el socket del usuario por su ID de usuario
                    // roomService.findSocketIdByUserId devuelve el socket.id, no el socket completo
                    const socketId = roomService.findSocketIdByUserId(sessionData.id);
                    if (socketId) {
                        const userSocket = io.sockets.sockets.get(socketId);
                        if (userSocket && userSocket.userData) {
                            // Verificar si está en modo incógnito y si el nick original coincide
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