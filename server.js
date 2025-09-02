const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path'); 
const cookieParser = require('cookie-parser');
const cors = require('cors');
const config = require('./config');
const { initializeSocket } = require('./socketManager');
const botService = require('./services/botService'); 
const { isCurrentUser } = require('./middleware/isCurrentUser');

// --- Importar Rutas ---
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const guestRoutes = require('./routes/guest');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e7,
  pingInterval: 10000,
  pingTimeout: 5000
});

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
// 1. Creamos una "lista blanca" de orígenes permitidos.
//    Esto funcionará tanto en tu VPS como en tu máquina local.
const allowedOrigins = [
    'https://mundochat.me',      // Tu dominio de producción
    'http://localhost:3000',     // Para desarrollo local
    'http://127.0.0.1:3000'      // Otra dirección común para desarrollo
];

const corsOptions = {
    origin: function (origin, callback) {
        // Si la petición viene de uno de los orígenes en la lista, la permitimos.
        // La condición `!origin` es importante para permitir herramientas como Postman.
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('El acceso a esta API no está permitido por la política de CORS.'));
        }
    },
    credentials: true, // ¡Permite que el navegador envíe cookies!
};

// 2. Aplicamos la nueva configuración de CORS
app.use(cors(corsOptions));
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================

// --- CONFIGURACIÓN DE EXPRESS ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/data/temp_avatars', express.static(path.join(__dirname, 'data', 'temp_avatars')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.io = io;
    next();
});

// Ruta para mantener la sesión viva (keep-alive)
app.post('/api/auth/keep-alive', (req, res) => {
    const userAuthCookie = req.cookies.user_auth;
    if (userAuthCookie) {
        try {
            res.cookie('user_auth', userAuthCookie, {
                httpOnly: false,
                sameSite: 'lax',
                maxAge: 3600 * 1000 // 1 hora
            });
            return res.status(200).json({ message: 'Session extended.' });
        } catch (e) {
            return res.status(400).json({ error: 'Invalid session cookie.' });
        }
    }
    return res.status(401).json({ error: 'No active session.' });
});

// Configurar las rutas de la API (DEBEN IR DESPUÉS DE CORS)
app.use('/api/admin', adminRoutes);
app.use('/api/user', isCurrentUser, userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes);

// --- INICIALIZACIÓN DE SERVICIOS ---
initializeSocket(io);
botService.initialize(io);

// --- INICIO DEL SERVIDOR ---
server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});