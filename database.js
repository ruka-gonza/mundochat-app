// database.js (MODIFICADO: Ruta de DB dinámica y columna mutedBy)
const sqlite3 = require('sqlite3').verbose();

// Lógica para determinar la ruta de la base de datos
const dbPath = process.env.RENDER ? './data/chat.db' : './chat.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log('Creando/actualizando tablas para la base de datos...');

    // Tabla de usuarios con la columna avatar_url y mutedBy
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nick TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            registeredAt TEXT NOT NULL,
            isVIP INTEGER DEFAULT 0,
            role TEXT DEFAULT 'user',
            isMuted INTEGER DEFAULT 0,
            mutedBy TEXT DEFAULT NULL,
            lastIP TEXT,
            avatar_url TEXT DEFAULT 'image/default-avatar.png' 
        )
    `, (err) => {
        if (err) console.error("Error creando tabla users:", err.message);
        else console.log("Tabla 'users' creada o ya existente.");
    });

    // ... (el resto de las tablas no cambia)
    // Tabla de baneados
    db.run(`
        CREATE TABLE IF NOT EXISTS banned_users (
            id TEXT PRIMARY KEY,
            nick TEXT NOT NULL,
            ip TEXT,
            reason TEXT NOT NULL,
            by TEXT NOT NULL,
            at TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error("Error creando tabla banned_users:", err.message);
        else console.log("Tabla 'banned_users' creada o ya existente.");
    });

    // Tabla de mensajes públicos
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roomName TEXT NOT NULL,
            nick TEXT NOT NULL,
            text TEXT NOT NULL,
            role TEXT NOT NULL,
            isVIP INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            editedAt TEXT DEFAULT NULL
        )
    `, (err) => {
        if (err) console.error("Error creando tabla messages:", err.message);
        else console.log("Tabla 'messages' creada o ya existente.");
    });

    // Tabla para mensajes privados
    db.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_nick TEXT NOT NULL,
            to_nick TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error("Error creando tabla private_messages:", err.message);
        else console.log("Tabla 'private_messages' creada o ya existente.");
    });

    // Tabla de logs de actividad
    db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            nick TEXT NOT NULL,
            userId TEXT NOT NULL,
            userRole TEXT NOT NULL,
            ip TEXT,
            details TEXT
        )
    `, (err) => {
        if (err) console.error("Error creando tabla activity_logs:", err.message);
        else console.log("Tabla 'activity_logs' creada o ya existente.");
    });
});

db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Base de datos inicializada correctamente.');
});