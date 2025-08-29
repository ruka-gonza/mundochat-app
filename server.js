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
  maxHttpBufferSize: 1e7 // Límite de 10MB para subidas
});


// ==========================================================
// CONFIGURACIÓN DE EXPRESS (LA PARTE QUE FALTABA)
// ==========================================================

// LÍNEA CLAVE 1: Servir archivos estáticos desde la carpeta 'public'
// Esto resuelve el error "Cannot GET /" al servir tu index.html
app.use(express.static(path.join(__dirname, 'public')));

// LÍNEAS ADICIONALES para servir avatares de las carpetas 'data'
// Esto es importante para que las imágenes de perfil se vean
app.use('/data/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/data/temp_avatars', express.static(path.join(__dirname, 'data', 'temp_avatars')));


// LÍNEA CLAVE 2: Middlewares para procesar datos de formularios y JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// LÍNEA CLAVE 3: Pasar la instancia 'io' a las rutas
app.use((req, res, next) => {
    req.io = io;
    next();
});

// LÍNEA CLAVE 4: Configurar las rutas de la API
app.use('/api/admin', adminRoutes);
app.use('/api/user', isCurrentUser, userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes);


// ==========================================================
// FIN DE LA CONFIGURACIÓN
// ==========================================================


// --- INICIALIZACIÓN DE SERVICIOS ---
initializeSocket(io);
botService.initialize(io);

// --- INICIO DEL SERVIDOR ---
server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});