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
const guestRoutes = require('./routes/guest'); // <-- AÑADIR ESTA LÍNEA
const path = require('path'); 
const { isCurrentUser } = require('./middleware/isCurrentUser');

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
app.use(express.json()); // Para parsear application/json
app.use(express.urlencoded({ extended: true })); // Para parsear application/x-www-form-urlencoded

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ---
// Sirve todos los archivos del frontend desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(path.join(__dirname, 'avatars')));
app.use('/temp_avatars', express.static(path.join(__dirname, 'temp_avatars'))); // <-- AÑADIR ESTA LÍNEA
// Configuración específica para el hosting de Render (si aplica)
if (process.env.RENDER) {
    app.use('/data', express.static('data'));
}

// --- LÍNEA ELIMINADA ---
// La siguiente ruta ya no es necesaria porque express.static('public') ya se encarga de servir reset-password.html
/*
app.get('/reset-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'reset-password.html'));
});
*/

// --- RUTAS DE LA API ---
// La lógica de rutas permanece igual. El orden es correcto.
app.use('/api/user', isCurrentUser, userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes); // <-- AÑADIR ESTA LÍNEA
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal en el servidor!');
});
// --- INICIALIZACIÓN DE SERVICIOS ---
initializeSocket(io);
botService.initialize(io);

// --- INICIO DEL SERVIDOR ---
server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});
