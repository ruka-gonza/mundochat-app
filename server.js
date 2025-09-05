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

const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const guestRoutes = require('./routes/guest');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

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

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 20 * 1024 * 1024,
  pingInterval: 10000,
  pingTimeout: 5000
});

app.use(cors(corsOptions));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/data/temp_avatars', express.static(path.join(__dirname, 'data', 'temp_avatars')));
app.use('/data/chat_uploads', express.static(path.join(__dirname, 'data', 'chat_uploads')));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.io = io;
    next();
});

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
// LA RUTA '/api/auth/keep-alive' HA SIDO ELIMINADA POR COMPLETO
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================

app.use('/api/admin', adminRoutes);
app.use('/api/user', isCurrentUser, userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/upload', isCurrentUser, uploadRoutes);

initializeSocket(io);
botService.initialize(io);

server.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port}`);
});