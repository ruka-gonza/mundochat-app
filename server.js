// server.js (MODIFICADO: Se sirve la carpeta de uploads para archivos locales)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const config = require('./config');
const { initializeSocket } = require('./socketManager');
const botService = require('./services/botService');

const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const path = require('path'); // Asegurarse de importar path
const { isProduction } = require('./aws-config'); // Para verificar el entorno

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

// Añadido: Servir la carpeta de uploads para archivos locales
if (!isProduction) { // Si NO estamos en producción (o sea, en local)
    app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
}

app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);

initializeSocket(io);
botService.initialize(io);

server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});