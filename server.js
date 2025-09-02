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

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
// Configuración del servidor de Socket.IO con "heartbeat" (pings) reforzado
const io = new Server(server, {
  maxHttpBufferSize: 1e7, // Límite de 10MB para subidas de
  
  // Configuración de ping más agresiva para mantener la conexión viva a través de redes inestables y proxies
  pingInterval: 10000, // Envía un ping a cada cliente cada 10 segundos
  pingTimeout: 5000    // Si un cliente no responde en 5 segundos, se considera desconectado
});
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================


// --- CONFIGURACIÓN DE EXPRESS ---

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Servir avatares de las carpetas 'data'
app.use('/data/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/data/temp_avatars', express.static(path.join(__dirname, 'data', 'temp_avatars')));


// Middlewares para procesar datos de formularios y JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Pasar la instancia 'io' a las rutas
app.use((req, res, next) => {
    req.io = io;
    next();
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