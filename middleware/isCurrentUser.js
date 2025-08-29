const roomService = require('../services/roomService');
const userService = require('../services/userService');

const isCurrentUser = async (req, res, next) => {
    // La única fuente de verdad inicial es la cookie.
    const userAuthCookie = req.cookies.user_auth ? JSON.parse(req.cookies.user_auth) : null;

    if (!userAuthCookie || !userAuthCookie.id || !userAuthCookie.nick) {
        return res.status(401).json({ error: 'No autenticado: Faltan credenciales de sesión.' });
    }

    try {
        // 1. Validar la sesión del usuario a partir de la cookie.
        const userInDb = await userService.findUserById(userAuthCookie.id);
        if (!userInDb || userInDb.nick.toLowerCase() !== userAuthCookie.nick.toLowerCase()) {
            return res.status(401).json({ error: 'Sesión inválida. Vuelve a iniciar sesión.' });
        }

        const targetSocketId = roomService.findSocketIdByNick(userAuthCookie.nick);
        const targetSocket = targetSocketId ? req.io.sockets.sockets.get(targetSocketId) : null;
        if (!targetSocket || !targetSocket.userData) {
            return res.status(401).json({ error: 'Sesión activa no encontrada. Por favor, vuelve a iniciar sesión.' });
        }

        // 2. Adjuntar los datos del usuario verificado al objeto `req`.
        // Esto es crucial para que las rutas que vienen después (como /avatar y /nick) lo puedan usar.
        req.verifiedUser = targetSocket.userData;

        // 3. Realizar una validación adicional SOLO SI la petición contiene un nick en el cuerpo.
        // - Para la ruta /nick (JSON), `req.body` existirá y se hará la comprobación.
        // - Para la ruta /avatar (multipart), `req.body` no existirá en este punto, y este bloque se omitirá,
        //   lo cual es el comportamiento que queremos.
        const requestedNickFromBody = req.body.oldNick || req.body.nick;
        if (requestedNickFromBody) {
            if (req.verifiedUser.nick.toLowerCase() !== requestedNickFromBody.toLowerCase()) {
                return res.status(403).json({ error: 'Acceso denegado: El nick en la solicitud no coincide con tu sesión.' });
            }
        }
        
        // 4. Si todas las validaciones pasan, continuar a la ruta solicitada (ej. el manejador de 'upload' de multer).
        next();

    } catch (e) {
        console.error('Error en el middleware isCurrentUser:', e);
        return res.status(500).json({ error: 'Error interno de autenticación.' });
    }
};

module.exports = { isCurrentUser };