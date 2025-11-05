const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Directorio 'data' para la base de datos creado.");
}

const dbPath = path.join(dataDir, 'chat.db');

let db = null;

function connectDb() {
    return new Promise((resolve, reject) => {
        if (db) {
            console.log('La base de datos ya estaba conectada.');
            return resolve(db);
        }

        const newDb = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error("ERROR FATAL: No se pudo conectar a la base de datos.", err.message);
                return reject(err);
            }
            console.log('Conexión a la base de datos SQLite establecida exitosamente.');
            db = newDb;
            resolve(db);
        });
    });
}

function getInstance() {
    // --- INICIO DE LA CORRECCIÓN CLAVE ---
    // Si la instancia 'db' es nula, significa que se está pidiendo antes de tiempo.
    // Lanzar un error claro es mejor que devolver null y causar un crash silencioso.
    if (!db) {
        throw new Error("Se intentó obtener la instancia de la base de datos antes de que la conexión fuera establecida. Asegúrate de que 'connectDb()' se complete primero.");
    }
    return db;
    // --- FIN DE LA CORRECCIÓN CLAVE ---
}

module.exports = { connectDb, getInstance };