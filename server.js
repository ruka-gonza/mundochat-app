const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path'); 
const cookieParser = require('cookie-parser');
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
            // El contenido de la cookie no importa, solo su existencia.
            // Simplemente la renovamos con las mismas propiedades.
            res.cookie('user_auth', userAuthCookie, {
                httpOnly: false,
                sameSite: 'lax',
                maxAge: 3600 * 1000 // 1 hora en milisegundos
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