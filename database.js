const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// La base de datos vivirá en un directorio 'data' dentro de tu proyecto
const dbPath = './data/chat.db';

// Crear el directorio 'data' si no existe antes de intentar conectar
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Directorio 'data' creado para la base de datos.");
}

const db = new sqlite3.Database(dbPath);

db.serialize(async () => { // <--- Añadido 'async' aquí para permitir 'await'
    console.log('Creando/actualizando tablas para la base de datos...');

    // Crear la tabla 'users'
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nick TEXT NOT NULL UNIQUE,
                email TEXT UNIQUE,
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
            resolve();
        });
    });

    // Añadir columna 'email' de forma asíncrona y esperar que termine
    await new Promise(resolve => {
        db.run("ALTER TABLE users ADD COLUMN email TEXT UNIQUE", (alterErr) => {
            if (alterErr && !alterErr.message.includes("duplicate column name")) {
                console.error("Error al añadir columna 'email' a la tabla users:", alterErr.message);
            } else if (!alterErr) {
                console.log("Columna 'email' añadida a la tabla 'users'.");
            }
            resolve();
        });
    });

    // Nueva tabla para almacenar los roles específicos de cada sala
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS room_staff (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                roomName TEXT NOT NULL,
                role TEXT NOT NULL,
                assignedBy TEXT NOT NULL,
                assignedAt TEXT NOT NULL,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(userId, roomName)
            )
        `, (err) => {
            if (err) console.error("Error creando tabla room_staff:", err.message);
            else console.log("Tabla 'room_staff' creada o ya existente.");
            resolve();
        });
    });

    // Nueva tabla 'rooms'
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                creatorId INTEGER NOT NULL,
                creatorNick TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                FOREIGN KEY (creatorId) REFERENCES users(id) ON DELETE SET NULL
            )
        `, (err) => {
            if (err) console.error("Error creando tabla rooms:", err.message);
            else console.log("Tabla 'rooms' creada o ya existente.");
            resolve();
        });
    });

    // Resto de las tablas
    await new Promise(resolve => {
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
            resolve();
        });
    });

    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roomName TEXT NOT NULL,
                nick TEXT NOT NULL,
                text TEXT NOT NULL,
                role TEXT NOT NULL,
                isVIP INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                editedAt TEXT DEFAULT NULL,
                replyToId INTEGER DEFAULT NULL 
            )
        `, (err) => {
            if (err) console.error("Error creando tabla messages:", err.message);
            else console.log("Tabla 'messages' creada o ya existente.");
            resolve();
        });
    });
    
    await new Promise(resolve => {
        db.run("ALTER TABLE messages ADD COLUMN replyToId INTEGER DEFAULT NULL", (alterErr) => {
            if (alterErr && !alterErr.message.includes("duplicate column name")) {
                console.error("Error al añadir columna 'replyToId' a la tabla messages:", alterErr.message);
            } else if (!alterErr) {
                console.log("Columna 'replyToId' añadida a la tabla 'messages'.");
            }
            resolve();
        });
    });

    await new Promise(resolve => {
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
            resolve();
        });
    });

    await new Promise(resolve => {
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
            resolve();
        });
    });

    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token TEXT PRIMARY KEY,
                userId INTEGER NOT NULL,
                expiresAt TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error("Error creando tabla password_reset_tokens:", err.message);
            else console.log("Tabla 'password_reset_tokens' creada o ya existente.");
            resolve();
        });
    });

    db.close((err) => {
        if (err) return console.error(err.message);
        console.log('Base de datos inicializada correctamente.');
    });
});