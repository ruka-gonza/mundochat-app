const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const config = require('./config');
const { initializeSocket } = require('./socketManager');
const botService = require('./services/botService'); 
const cookieParser = require('cookie-parser');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const guestRoutes = require('./routes/guest');
const path = require('path'); 
const { isCurrentUser } = require('./middleware/isCurrentUser');
const roomService = require('./services/roomService'); // <-- AÑADIDO: Importamos roomService

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

// Middleware para hacer 'io' accesible en las rutas
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Middlewares para parsear cookies y cuerpos de petición
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(path.join(__dirname, 'avatars')));
app.use('/temp_avatars', express.static(path.join(__dirname, 'temp_avatars')));
if (process.env.RENDER) {
    app.use('/data', express.static('data'));
}

// --- RUTAS DE LA API ---
app.use('/api/user', isCurrentUser, userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes);
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal en el servidor!');
});

// --- INICIALIZACIÓN DE SERVICIOS ---

// --- INICIO DE LA MODIFICACIÓN ---
// Esta línea carga las salas por defecto en memoria ANTES de que cualquier
// usuario se conecte, asegurando que la lista de salas nunca esté vacía.
roomService.initializeDefaultRooms();
// --- FIN DE LA MODIFICACIÓN ---

initializeSocket(io);
botService.initialize(io);

// --- INICIO DEL SERVIDOR ---
server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});