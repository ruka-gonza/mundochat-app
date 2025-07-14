// botConfig.js (MODIFICADO: Ahora cada regla define su propio castigo)

module.exports = {
    // El nombre que mostrará el bot en sus mensajes
    botNick: 'ChatBot',

    // Reglas para el Flood (muchos mensajes en poco tiempo)
    flood: {
        messageLimit: 5,   // Número de mensajes para ser considerado flood
        timeFrame: 3,      // En un período de X segundos
        punishment: 'kick',// 'warn' para advertir, 'kick' para expulsar
        reason: 'Flood/Spam de mensajes'
    },

    // Reglas para Repetición de Mensajes
    repetition: {
        count: 3,          // Número de veces que se debe repetir el mismo mensaje
        punishment: 'kick',// 'warn' o 'kick'
        reason: 'Repetición de mensajes (spam)'
    },

    // Reglas para Palabras Prohibidas
    bannedWords: {
        // La lista de palabras en sí. Usa expresiones regulares para más poder.
        list: [
            /\b(tonto|idiota|imbecil|estupido)\b/i,
            /\b(cp|hijo de puta)\b/i,
            // \b asegura que se detecten palabras completas (ej: no detectará "as" en "casa")
            // i hace que la búsqueda no distinga entre mayúsculas y minúsculas
        ],
        punishment: 'kick', // 'warn' o 'kick'
        reason: 'Uso de lenguaje inapropiado'
    }
};