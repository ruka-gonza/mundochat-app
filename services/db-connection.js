const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 1. Define la ruta al directorio 'data' en la raíz de tu proyecto
const dataDir = path.join(__dirname, '..', 'data');

// 2. Si el directorio 'data' no existe, lo crea automáticamente
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Directorio 'data' para la base de datos creado.");
}

// 3. Define la ruta completa al archivo de la base de datos
const dbPath = path.join(dataDir, 'chat.db');

// 4. Crea la única instancia de la base de datos usando la ruta correcta
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("ERROR FATAL: No se pudo conectar a la base de datos.", err.message);
    process.exit(1);
  } else {
    console.log('Conexión a la base de datos SQLite establecida exitosamente.');
  }
});

// 5. Exporta la instancia única para que otros archivos la usen
module.exports = db;