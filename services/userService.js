// services/userService.js (MODIFICADO: Añadida función getAllMutedUsers)
const { docClient } = require('../aws-config');
const { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb"); // Agregamos ScanCommand
const bcrypt = require('bcrypt');
const config = require('../config');

const USERS_TABLE_NAME = process.env.CYCLIC_DB_TABLE_NAME || 'users';

let admins = ["Basajaun", "namor"];
let mods = ["Mod1"];

function getRole(nick) {
    if (nick.toLowerCase() === config.ownerNick.toLowerCase()) return 'owner';
    if (admins.map(a => a.toLowerCase()).includes(nick.toLowerCase())) return 'admin';
    if (mods.map(m => m.toLowerCase()).includes(nick.toLowerCase())) return 'mod';
    return 'user';
}

async function findUserByNick(nick) {
    const command = new QueryCommand({
        TableName: USERS_TABLE_NAME,
        IndexName: 'nick-index',
        KeyConditionExpression: 'nick = :nick',
        ExpressionAttributeValues: { ':nick': nick.toLowerCase() }
    });
    const { Items } = await docClient.send(command);
    const user = Items && Items.length > 0 ? Items[0] : null;

    if (user) {
        if(user.role === 'user' && user.nick.toLowerCase() === config.ownerNick.toLowerCase()) {
            user.role = 'owner';
        }
    }
    return user;
}

async function createUser(nick, password, ip) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const initialRole = getRole(nick);
    const user = {
        id: nick.toLowerCase(),
        nick: nick,
        password: hashedPassword,
        registeredAt: new Date().toISOString(),
        isVIP: false,
        role: initialRole,
        isMuted: false,
        mutedBy: null,
        lastIP: ip,
        avatar_url: 'image/default-avatar.png'
    };

    const command = new PutCommand({
        TableName: USERS_TABLE_NAME,
        Item: user
    });

    await docClient.send(command);
    return { id: user.id, nick: user.nick };
}

async function updateUserIP(nick, ip) {
    const command = new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id: nick.toLowerCase() },
        UpdateExpression: 'set lastIP = :ip',
        ExpressionAttributeValues: { ':ip': ip }
    });
    await docClient.send(command);
    return true;
}

async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

async function setVipStatus(nick, isVIP) {
    const command = new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id: nick.toLowerCase() },
        UpdateExpression: 'set isVIP = :status',
        ExpressionAttributeValues: { ':status': isVIP }
    });
    await docClient.send(command);
    return true;
}

async function setMuteStatus(nick, isMuted, moderatorNick = null) {
    const mutedBy = isMuted ? moderatorNick : null;
    const command = new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id: nick.toLowerCase() },
        UpdateExpression: 'set isMuted = :isMuted, mutedBy = :mutedBy',
        ExpressionAttributeValues: {
            ':isMuted': isMuted,
            ':mutedBy': mutedBy
        }
    });
    await docClient.send(command);
    return true;
}

async function setAvatarUrl(nick, avatarUrl) {
    const command = new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id: nick.toLowerCase() },
        UpdateExpression: 'set avatar_url = :url',
        ExpressionAttributeValues: { ':url': avatarUrl }
    });
    await docClient.send(command);
    return true;
}

async function setUserRole(nick, role) {
    const validRoles = ['admin', 'mod', 'user'];
    if (!validRoles.includes(role)) {
        throw new Error('Rol no válido.');
    }
    const command = new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id: nick.toLowerCase() },
        UpdateExpression: 'set #r = :role',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: { ':role': role }
    });
    await docClient.send(command);
    return true;
}

// =========================================================================
// INICIO: NUEVA FUNCIÓN para listar todos los usuarios muteados
// =========================================================================
async function getAllMutedUsers() {
    const command = new ScanCommand({
        TableName: USERS_TABLE_NAME,
        FilterExpression: 'isMuted = :true',
        ExpressionAttributeValues: {
            ':true': true
        }
    });
    const { Items } = await docClient.send(command);
    return Items || [];
}
// =========================================================================
// FIN: NUEVA FUNCIÓN
// =========================================================================


module.exports = { 
    getRole, 
    findUserByNick, 
    createUser, 
    verifyPassword, 
    setVipStatus,
    setMuteStatus,
    updateUserIP,
    setAvatarUrl,
    setUserRole,
    getAllMutedUsers // Exportamos la nueva función
};