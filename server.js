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

// --- 1. Definimos la configuración de CORS una sola vez ---
const allowedOrigins = [
    'https://mundochat.me',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('El acceso a esta API no está permitido por la política de CORS.'));
        }
    },
    credentials: true,
};

// --- 2. Inicializamos Socket.IO con la configuración CORS ---
const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e7,
  pingInterval: 10000,
  pingTimeout: 5000
});

// --- 3. Aplicamos CORS a todas las rutas de Express ---
app.use(cors(corsOptions));

// --- CONFIGURACIÓN DE EXPRESS ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/data/temp_avatars', express.static(path.join(__dirname, 'data', 'temp_avatars')));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.io = io;
    next();
});

const isProduction = process.env.NODE_ENV === 'production';

// Ruta para mantener la sesión viva (keep-alive)
app.post('/api/auth/keep-alive', (req, res) => {
    const userAuthCookie = req.cookies.user_auth;
    if (userAuthCookie) {
        try {
            res.cookie('user_auth', userAuthCookie, {
                httpOnly: false,
                sameSite: 'none',
                secure: isProduction, // Condicional para que funcione en local (http) y producción (https)
                maxAge: 3600 * 1000 // 1 hora
            });
            return res.status(200).json({ message: 'Session extended.' });
        } catch (e) {
            return res.status(400).json({ error: 'Invalid session cookie.' });
        }
    }
    return res.status(401).json({ error: 'No active session.' });
});

// Configurar las rutas de la API
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