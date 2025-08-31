import state from '../state.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';

/**
 * Crea una tarjeta interactiva de previsualización para un enlace.
 * @param {object} preview - El objeto de previsualización enviado por el servidor.
 * @returns {HTMLElement|null} El elemento de la tarjeta o null si no hay previsualización.
 */
function createPreviewCard(preview) {
    if (!preview || !preview.url) return null;

    const card = document.createElement('a');
    card.href = preview.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = 'link-preview-card';

    // Añadir atributos de datos para la interactividad
    if (preview.type === 'image') {
        card.dataset.previewType = 'image';
        card.dataset.imageUrl = preview.image;
    }
    if (preview.type === 'youtube') {
        const videoIdMatch = preview.url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
        if (videoIdMatch) {
            card.dataset.previewType = 'youtube';
            card.dataset.youtubeId = videoIdMatch[1];
        }
    }

    let innerHTML = '';
    if (preview.image) {
        // Añadimos un onerror para evitar imágenes rotas
        innerHTML += `<div class="preview-image-container"><img src="${preview.image}" alt="Previsualización" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.display='none';"></div>`;
    }
    innerHTML += '<div class="preview-info">';
    if (preview.title) {
        innerHTML += `<strong class="preview-title">${preview.title}</strong>`;
    }
    if (preview.description) {
        innerHTML += `<p class="preview-description">${preview.description}</p>`;
    }
    innerHTML += '</div>';

    card.innerHTML = innerHTML;
    return card;
}

export function createMessageElement(msg, isPrivate = false) {
    // Manejo de mensajes de sistema
    if (!msg.nick && !msg.from) {
        const item = document.createElement('li');
        item.className = `system-message ${msg.type || ''}`;
        item.textContent = msg.text;
        return item;
    }

    // Ignorar usuarios
    const senderNick = isPrivate ? msg.from : msg.nick;
    if (state.ignoredNicks.has(senderNick.toLowerCase())) {
        return document.createDocumentFragment();
    }

    // Creación de elementos base
    const item = document.createElement('li');
    item.id = `message-${msg.id}`;
    const isSent = msg.from === state.myNick || msg.nick === state.myNick;
    const senderData = state.allUsersData[senderNick.toLowerCase()] || {};
    const avatarUrl = (isSent && state.myUserData.avatar_url) ? state.myUserData.avatar_url : (senderData.avatar_url || 'image/default-avatar.png');
    
    const avatarImg = document.createElement('img');
    avatarImg.src = avatarUrl;
    avatarImg.className = 'message-avatar';
    item.appendChild(avatarImg);
    
    const mainContentWrapper = document.createElement('div');
    mainContentWrapper.className = 'message-main-wrapper';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Renderizado de respuesta (si existe)
    if (msg.replyTo) {
        const quoteDiv = document.createElement('div');
        quoteDiv.className = 'reply-quote';
        const quoteNick = document.createElement('strong');
        quoteNick.textContent = msg.replyTo.nick;
        const quoteText = document.createElement('p');
        const previewText = msg.replyTo.text.length > 70 ? msg.replyTo.text.substring(0, 70) + '...' : msg.replyTo.text;
        quoteText.textContent = replaceEmoticons(previewText);
        quoteDiv.appendChild(quoteNick);
        quoteDiv.appendChild(quoteText);
        contentDiv.appendChild(quoteDiv);
    }
    
    // =========================================================================
    // ===                    INICIO DE LA MODIFICACIÓN                    ===
    // =========================================================================
    // Lógica unificada para renderizar el contenido del mensaje
    
    const icons = getUserIcons(senderData);
    const displayName = isPrivate ? (isSent ? 'Yo' : msg.from) : msg.nick;

    const nickElement = document.createElement('span');
    nickElement.className = 'message-nick';
    nickElement.innerHTML = `${icons} <strong>${displayName}</strong>: `;

    if (displayName !== 'Yo' && msg.nick !== state.myNick) {
        nickElement.dataset.nick = msg.nick;
        nickElement.dataset.messageId = msg.id;
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'message-text';
    textSpan.appendChild(nickElement);

    // Si el mensaje tiene una previsualización de tipo 'image', el texto es un placeholder
    // y no queremos mostrarlo, solo la tarjeta. Si es de YouTube, sí mostramos el texto (la URL).
    if (!msg.preview || msg.preview.type !== 'image') {
        textSpan.append(replaceEmoticons(msg.text));
    }

    contentDiv.appendChild(textSpan);

    // Si el mensaje tiene CUALQUIER tipo de previsualización, la renderizamos como una tarjeta.
    // Esto ahora funciona tanto para enlaces externos como para imágenes subidas.
    if (msg.preview) {
        const previewCard = createPreviewCard(msg.preview);
        if (previewCard) {
            contentDiv.appendChild(previewCard);
        }
    }
    
    // =========================================================================
    // ===                     FIN DE LA MODIFICACIÓN                    ===
    // =========================================================================

    // Renderizado de timestamp y estado de edición
    if (msg.timestamp) {
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'message-timestamp';
        timestampSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        contentDiv.appendChild(timestampSpan);
    }

    if (msg.editedAt) {
        const editedSpan = document.createElement('span');
        editedSpan.className = 'edited-indicator';
        editedSpan.textContent = ' (editado)';
        contentDiv.appendChild(editedSpan);
    }

    mainContentWrapper.appendChild(contentDiv);

    // Renderizado de botones de acción
    const iAmModerator = ['owner', 'admin'].includes(state.myUserData.role);
    if (!isPrivate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        if (isSent && msg.text && (!msg.preview || msg.preview.type !== 'image')) { // Solo se pueden editar mensajes de texto
            const editBtn = document.createElement('button');
            editBtn.textContent = '✏️';
            editBtn.title = 'Editar mensaje';
            editBtn.className = 'action-btn edit-btn';
            editBtn.dataset.messageId = msg.id;
            actionsDiv.appendChild(editBtn);
        }

        if (isSent || iAmModerator) {
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = 'Eliminar mensaje';
            deleteBtn.className = 'action-btn delete-btn';
            deleteBtn.dataset.messageId = msg.id;
            if (iAmModerator && !isSent) {
                deleteBtn.dataset.isModAction = 'true';
            }
            actionsDiv.appendChild(deleteBtn);
        }
        
        if (actionsDiv.hasChildNodes()) {
            mainContentWrapper.appendChild(actionsDiv);
        }
    }

    item.appendChild(mainContentWrapper);

    // Aplicar clases de estilo finales
    if (isPrivate) {
        item.classList.add(isSent ? 'sent' : 'received');
    } else {
        if (isSent) {
            item.classList.add('sent-by-me');
        }
    }
    
    if (!isPrivate && msg.isMention) {
        item.classList.add('mencion');
    }
    
    return item;
}

export function appendMessageToView(msg, isPrivate) {
    let listElement;
    if (isPrivate) {
        listElement = document.querySelector('#private-chat-window ul');
        if (!listElement) {
            listElement = document.createElement('ul');
            document.getElementById('private-chat-window').innerHTML = '';
            document.getElementById('private-chat-window').appendChild(listElement);
        }
    } else {
        listElement = document.getElementById('messages');
    }
    const isScrolledToBottom = listElement.scrollHeight - listElement.clientHeight <= listElement.scrollTop + 50;
    const isMyOwnMessage = msg.from === state.myNick || msg.nick === state.myNick;
    listElement.appendChild(createMessageElement(msg, isPrivate));
    if (isMyOwnMessage || isScrolledToBottom) {
        listElement.scrollTop = listElement.scrollHeight;
    }
}