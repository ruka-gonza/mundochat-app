// services/banService.js (CORREGIDO: Nombre de tabla BAN)
const { docClient } = require('../aws-config');
const { GetCommand, PutCommand, DeleteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

// =========================================================================
// INICIO: CORRECCIÓN DE NOMBRE DE TABLA
// =========================================================================
// Aseguramos que el nombre de la tabla se lea de una variable de entorno de Cyclic,
// o use un valor por defecto si estamos en local.
const BANNED_USERS_TABLE_NAME = process.env.CYCLIC_DB_TABLE_NAME_BANNED || 'banned_users';
// =========================================================================
// FIN: CORRECCIÓN DE NOMBRE DE TABLA
// =========================================================================

async function isUserBanned(persistentId) {
    const command = new GetCommand({
        TableName: BANNED_USERS_TABLE_NAME,
        Key: { id: persistentId }
    });
    const { Item } = await docClient.send(command);
    return Item;
}

async function banUser(persistentId, nick, ip, reason, by) {
    const banItem = {
        id: persistentId,
        nick: nick,
        ip: ip,
        reason: reason,
        by: by,
        at: new Date().toISOString()
    };

    const command = new PutCommand({
        TableName: BANNED_USERS_TABLE_NAME,
        Item: banItem
    });

    await docClient.send(command);
    return { id: persistentId };
}

async function unbanUser(persistentId) {
    const command = new DeleteCommand({
        TableName: BANNED_USERS_TABLE_NAME,
        Key: { id: persistentId }
    });
    const response = await docClient.send(command);
    return true; 
}

async function getAllBannedUsers() {
    const command = new ScanCommand({
        TableName: BANNED_USERS_TABLE_NAME
    });
    const { Items } = await docClient.send(command);
    return Items || [];
}

module.exports = { isUserBanned, banUser, unbanUser, getAllBannedUsers };