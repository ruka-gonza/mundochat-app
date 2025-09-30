const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/chat.db');

const correctNick = 'Admin'; // El nick que DEBE existir.
const userEmail = 'regc750@gmail.com'; // El email asociado a tu cuenta de Admin.

db.serialize(() => {
    console.log(`Buscando usuario con el email: ${userEmail}...`);

    // Usamos el email como identificador único y seguro.
    db.get('SELECT id, nick FROM users WHERE lower(email) = ?', [userEmail.toLowerCase()], (err, row) => {
        if (err) {
            db.close();
            return console.error('Error al buscar el usuario por email:', err.message);
        }

        if (!row) {
            db.close();
            return console.log(`ERROR CRÍTICO: No se encontró ningún usuario con el email '${userEmail}'. Asegúrate de que el email en el script es el correcto.`);
        }

        console.log(`Usuario encontrado: ID ${row.id}, Nick actual en la BD: "${row.nick}"`);

        if (row.nick === correctNick) {
            console.log('El nick ya es correcto en la base de datos. No se necesita ningún cambio.');
            console.log('Si el problema persiste, podría ser un problema de caché. Intenta iniciar sesión en una ventana de incógnito.');
            db.close();
            return;
        }

        console.log(`El nick actual "${row.nick}" es incorrecto. Actualizando a "${correctNick}"...`);

        // Este comando limpia (TRIM) y actualiza el nick.
        db.run('UPDATE users SET nick = TRIM(?) WHERE id = ?', [correctNick, row.id], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    console.error(`Error: Ya existe otro usuario con el nick '${correctNick}'. Esto no debería pasar si la búsqueda por email funcionó.`);
                } else {
                    console.error('Error al actualizar el nick:', err.message);
                }
            } else if (this.changes > 0) {
                console.log('¡ÉXITO! El nick ha sido corregido a "Admin".');
                console.log('Por favor, reinicia tu servidor Node.js (con pm2 restart) e intenta iniciar sesión de nuevo.');
            } else {
                console.log('No se realizaron cambios. El ID de usuario podría no ser válido.');
            }
            
            db.close();
        });
    });
});