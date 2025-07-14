// aws-config.js
// Centraliza la configuración de AWS para DynamoDB y S3.
// Se adapta automáticamente al entorno (local vs. producción en Cyclic).

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { S3Client } = require("@aws-sdk/client-s3");

// Comprueba si estamos en el entorno de Cyclic (producción)
const isProduction = process.env.CYCLIC_APP_ID !== undefined;

let dynamoDBClient;
let s3Client;

if (isProduction) {
    // En producción (Cyclic), usamos las credenciales y región que nos da el entorno.
    console.log("Configurando AWS para el entorno de producción (Cyclic)...");
    dynamoDBClient = new DynamoDBClient({});
    s3Client = new S3Client({});
} else {
    // En desarrollo (local), nos conectamos a DynamoDB Local.
    console.log("Configurando AWS para el entorno de desarrollo local...");
    dynamoDBClient = new DynamoDBClient({
        region: "localhost",
        endpoint: "http://localhost:8000",
        credentials: {
            accessKeyId: "dummy",
            secretAccessKey: "dummy",
        },
    });
    // Para S3, en local no lo usaremos directamente, multer lo manejará en disco.
    s3Client = null;
}

const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

module.exports = { docClient, s3Client, isProduction };