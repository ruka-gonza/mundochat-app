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
const roomService = require('./services/roomService'); // La importación puede quedarse, no hace daño

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

// ... (todo tu código de middlewares y rutas queda igual) ...

// --- INICIALIZACIÓN DE SERVICIOS ---

// --- LÍNEA ELIMINADA ---
// roomService.initializeDefaultRooms(); // ¡Esta línea se va!

initializeSocket(io);
botService.initialize(io);

// --- INICIO DEL SERVIDOR ---
server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});