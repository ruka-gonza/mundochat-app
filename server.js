// server.js (MODIFICADO: Se inicializa el bot y se sirve la carpeta de datos en producción)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const config = require('./config');
const { initializeSocket } = require('./socketManager');
const botService = require('./services/botService'); // <-- IMPORTAR EL SERVICIO DEL BOT

const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

app.use((req, res, next) => {
    req.io = io;
    next();
});

app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static('public'));

// Añadido: Servir la carpeta de datos persistentes SÓLO si estamos en Render (producción)
if (process.env.RENDER) {
    app.use('/data', express.static('data'));
}

app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);

initializeSocket(io);
botService.initialize(io); // <-- INICIALIZAR EL BOT CON LA INSTANCIA DE IO

server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});