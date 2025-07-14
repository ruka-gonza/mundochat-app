// routes/user.js (MODIFICADO: Manejo de subida de audio/imagen a S3/local)
const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client, isProduction } = require('../aws-config');
const path = require('path');
const fs = require('fs');

let upload;

if (isProduction) {
    // =========================================================================
    // INICIO: Configuración para subir a S3 en producción (Cyclic)
    // =========================================================================
    const s3Bucket = process.env.CYCLIC_BUCKET_NAME; // Nombre del bucket S3 de Cyclic

    upload = multer({
        storage: multerS3({
            s3: s3Client,
            bucket: s3Bucket,
            contentType: multerS3.AUTO_CONTENT_TYPE, // Detectar tipo de contenido automáticamente
            acl: 'public-read', // Permiso de lectura pública para las URLs
            metadata: function (req, file, cb) {
                cb(null, { fieldName: file.fieldname });
            },
            key: function (req, file, cb) {
                const safeNick = req.body.nick ? req.body.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_') : 'unknown';
                const fileExtension = path.extname(file.originalname || file.mimetype.split('/')[1]);
                const uniqueFilename = `${safeNick}-${Date.now()}${fileExtension}`;
                
                // Categorizar en carpetas 'avatars' o 'media'
                let folder = 'media/';
                if (file.mimetype.startsWith('image/')) {
                    folder = 'avatars/';
                } else if (file.mimetype.startsWith('audio/')) {
                    folder = 'media/'; // Puede ser otra carpeta si quieres diferenciar
                }
                
                cb(null, folder + uniqueFilename);
            }
        }),
        limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB para archivos
        fileFilter: function (req, file, cb) {
            const allowedTypes = /jpeg|jpg|png|gif|mp3|wav|webm|ogg/; // Tipos permitidos
            const mimetype = allowedTypes.test(file.mimetype);
            if (mimetype) {
                return cb(null, true);
            }
            cb(new Error('Solo se permiten archivos de imagen, audio (mp3, wav, webm, ogg).'));
        }
    }).single('file'); // El nombre del campo en el FormData
    // =========================================================================
    // FIN: Configuración para subir a S3 en producción (Cyclic)
    // =========================================================================

} else {
    // =========================================================================
    // INICIO: Configuración para guardar en disco local en desarrollo
    // =========================================================================
    const uploadsDir = path.join(__dirname, '../public/uploads'); // Nueva carpeta para archivos subidos localmente
    const avatarsDir = path.join(__dirname, '../public/avatars'); // Avatares siguen separados
    
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(avatarsDir)) { // Asegurarse que la carpeta de avatares existe
        fs.mkdirSync(avatarsDir, { recursive: true });
    }

    upload = multer({
        storage: multer.diskStorage({
            destination: function (req, file, cb) {
                // Decide dónde guardar según el tipo de archivo
                if (file.mimetype.startsWith('image/')) {
                    cb(null, avatarsDir);
                } else { // Para audio y otros archivos
                    cb(null, uploadsDir);
                }
            },
            filename: function (req, file, cb) {
                const safeNick = req.body.nick ? req.body.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_') : 'unknown';
                const uniqueFilename = `${safeNick}-${Date.now()}${path.extname(file.originalname || file.mimetype.split('/')[1])}`;
                cb(null, uniqueFilename);
            }
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: function (req, file, cb) {
            const allowedTypes = /jpeg|jpg|png|gif|mp3|wav|webm|ogg/;
            if (allowedTypes.test(file.mimetype)) {
                return cb(null, true);
            }
            cb(new Error('Solo se permiten archivos de imagen, audio (mp3, wav, webm, ogg).'));
        }
    }).single('file'); // El nombre del campo en el FormData
    // =========================================================================
    // FIN: Configuración para guardar en disco local en desarrollo
    // =========================================================================
}

router.post('/avatar', (req, res) => {
    // Cambiamos el nombre del campo de Multer a 'avatarFile' para la ruta de avatar
    // Esto es para que la ruta /avatar solo maneje el archivo del avatar y no los mensajes.
    // Creamos una instancia específica para avatares.
    const avatarUpload = multer(isProduction ? {
        storage: multerS3({
            s3: s3Client,
            bucket: process.env.CYCLIC_BUCKET_NAME,
            contentType: multerS3.AUTO_CONTENT_TYPE,
            acl: 'public-read',
            metadata: function (req, file, cb) { cb(null, { fieldName: file.fieldname }); },
            key: function (req, file, cb) {
                const safeNick = req.body.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_');
                cb(null, 'avatars/' + Date.now() + '-' + safeNick + path.extname(file.originalname));
            }
        }),
        limits: { fileSize: 2 * 1024 * 1024 },
        fileFilter: function (req, file, cb) {
            const filetypes = /jpeg|jpg|png|gif/;
            const mimetype = filetypes.test(file.mimetype);
            if (mimetype) { return cb(null, true); }
            cb(new Error('Solo se permiten archivos de imagen (jpeg, jpg, png, gif).'));
        }
    } : {
        storage: multer.diskStorage({
            destination: path.join(__dirname, '../public/avatars'),
            filename: function (req, file, cb) {
                const safeNick = req.body.nick.toLowerCase().replace(/[^a-z0-9]/gi, '_');
                cb(null, Date.now() + '-' + safeNick + path.extname(file.originalname));
            }
        }),
        limits: { fileSize: 2 * 1024 * 1024 },
        fileFilter: function (req, file, cb) {
            const filetypes = /jpeg|jpg|png|gif/;
            const mimetype = filetypes.test(file.mimetype);
            if (mimetype) { return cb(null, true); }
            cb(new Error('Solo se permiten archivos de imagen (jpeg, jpg, png, gif).'));
        }
    }).single('avatarFile'); // <-- Aquí es 'avatarFile'

    avatarUpload(req, res, async function (err) {
        if (err) {
            console.error('Error subiendo avatar:', err);
            return res.status(400).json({ error: `Error al subir avatar: ${err.message}` });
        }

        const { nick } = req.body;
        if (!req.file || !nick) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo válido o falta el nick.' });
        }

        let avatarUrl;
        if (isProduction) {
            avatarUrl = req.file.location; // URL de S3
        } else {
            avatarUrl = `avatars/${req.file.filename}`; // URL local
        }

        try {
            await userService.setAvatarUrl(nick, avatarUrl);
            req.io.emit('user_avatar_changed', { nick, newAvatarUrl: avatarUrl });
            res.json({ message: 'Avatar actualizado con éxito.', newAvatarUrl: avatarUrl });
        } catch (error) {
            console.error('Error al actualizar avatar en la DB:', error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
    });
});


// =========================================================================
// INICIO: NUEVA RUTA para manejar la subida de mensajes con archivos (audio/imagen)
// =========================================================================
router.post('/upload-message-file', (req, res) => {
    upload(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Error al subir archivo: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo válido.' });
        }
        
        let fileUrl;
        if (isProduction) {
            fileUrl = req.file.location; // URL de S3
        } else {
            fileUrl = `uploads/${req.file.filename}`; // URL local
        }

        // Devolvemos la URL y el tipo de archivo al cliente
        res.json({ success: true, fileUrl, fileType: req.file.mimetype });
    });
});
// =========================================================================
// FIN: NUEVA RUTA
// =========================================================================

module.exports = router;