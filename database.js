const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = './data/chat.db';

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Directorio 'data' creado para la base de datos.");
}

const db = new sqlite3.Database(dbPath);

db.serialize(async () => {
    console.log('Creando/actualizando tablas para la base de datos...');

    // Función auxiliar para añadir columnas si no existen
    const addColumn = async (tableName, columnName, columnDef) => {
        return new Promise(resolve => {
            db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`, (err) => {
                if (err && !err.message.includes("duplicate column name")) {
                    console.error(`Error añadiendo columna '${columnName}' a '${tableName}':`, err.message);
                } else if (!err) {
                    console.log(`Columna '${columnName}' añadida a la tabla '${tableName}'.`);
                }
                resolve();
            });
        });
    };

    // --- Tabla 'users' ---
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
    await addColumn('users', 'email', 'TEXT UNIQUE');

    // --- Tabla 'room_staff' ---
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

    // --- Tabla 'rooms' ---
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

    // --- Tabla 'global_bans' (RENOMBRADA Y MODIFICADA) ---
    await new Promise(resolve => {
        // Renombramos la tabla si existe la antigua
        db.run(`ALTER TABLE banned_users RENAME TO global_bans`, (err) => {
            if (err && !err.message.includes('no such table')) {
                console.error("Error al renombrar banned_users a global_bans:", err.message);
            }
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS global_bans (
                id TEXT PRIMARY KEY,
                nick TEXT NOT NULL,
                ip TEXT,
                reason TEXT NOT NULL,
                by TEXT NOT NULL,
                at TEXT NOT NULL,
                expiresAt TEXT DEFAULT NULL 
            )
        `, (err) => {
            if (err) console.error("Error creando tabla global_bans:", err.message);
            else console.log("Tabla 'global_bans' creada o ya existente.");
            resolve();
        });
    });
    await addColumn('global_bans', 'expiresAt', 'TEXT DEFAULT NULL');
    
    // --- Tabla 'room_bans' (NUEVA TABLA) ---
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS room_bans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                roomName TEXT NOT NULL,
                reason TEXT NOT NULL,
                by TEXT NOT NULL,
                at TEXT NOT NULL,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(userId, roomName)
            )
        `, (err) => {
            if (err) console.error("Error creando tabla room_bans:", err.message);
            else console.log("Tabla 'room_bans' creada o ya existente.");
            resolve();
        });
    });


    // --- Tabla 'messages' ---
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roomName TEXT NOT NULL,
                nick TEXT NOT NULL,
                text TEXT,
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
    await addColumn('messages', 'preview_type', 'TEXT');
    await addColumn('messages', 'preview_url', 'TEXT');
    await addColumn('messages', 'preview_title', 'TEXT');
    await addColumn('messages', 'preview_description', 'TEXT');
    await addColumn('messages', 'preview_image', 'TEXT');
    await addColumn('messages', 'replyToId', 'INTEGER DEFAULT NULL');
    await addColumn('messages', 'file_url', 'TEXT');
    await addColumn('messages', 'file_type', 'TEXT');

     await new Promise(resolve => {
        db.run(`
            CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp 
            ON messages (roomName, timestamp DESC)
        `, (err) => {
            if (err) console.error("Error creando índice para messages:", err.message);
            else console.log("Índice 'idx_messages_room_timestamp' creado o ya existente.");
            resolve();
        });
    });
  
    
    // --- Tabla 'private_messages' (MODIFICADA) ---
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS private_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_nick TEXT NOT NULL,
                to_nick TEXT NOT NULL,
                text TEXT,
                timestamp TEXT NOT NULL
            )
        `, (err) => {
            if (err) console.error("Error creando tabla private_messages:", err.message);
            else console.log("Tabla 'private_messages' creada o ya existente.");
            resolve();
        });
    });
    
    await addColumn('private_messages', 'preview_type', 'TEXT');
    await addColumn('private_messages', 'preview_url', 'TEXT');
    await addColumn('private_messages', 'preview_title', 'TEXT');
    await addColumn('private_messages', 'preview_description', 'TEXT');
    await addColumn('private_messages', 'preview_image', 'TEXT');
    await addColumn('private_messages', 'file_url', 'TEXT');
    await addColumn('private_messages', 'file_type', 'TEXT');
    
    // --- Tabla 'activity_logs' ---
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

    // --- Tabla 'password_reset_tokens' ---
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

    // --- Tabla 'offline_messages' ---
    await new Promise(resolve => {
        db.run(`
            CREATE TABLE IF NOT EXISTS offline_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_nick TEXT NOT NULL,
                recipient_nick TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                is_delivered INTEGER DEFAULT 0
            )
        `, (err) => {
            if (err) console.error("Error creando tabla offline_messages:", err.message);
            else console.log("Tabla 'offline_messages' creada o ya existente.");
            resolve();
        });
    });

    db.close((err) => {
        if (err) return console.error(err.message);
        console.log('Base de datos inicializada correctamente.');
    });
});