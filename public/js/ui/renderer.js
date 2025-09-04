import state from '../state.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';
import { openImageModal } from './modals.js';

function createPreviewCard(preview) {
    if (!preview || !preview.url || preview.type === 'image' || preview.type === 'audio') {
        return null;
    }

    const linkCard = document.createElement('a');
    linkCard.href = preview.url;
    linkCard.target = '_blank';
    linkCard.rel = 'noopener noreferrer';
    linkCard.className = 'link-preview-card';

    if (preview.type === 'youtube') {
        const videoIdMatch = preview.url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
        if (videoIdMatch) {
            linkCard.dataset.previewType = 'youtube';
            linkCard.dataset.youtubeId = videoIdMatch[1];
        }
    }

    let innerHTML = '';
    if (preview.image) {
        innerHTML += `<div class="preview-image-container"><img src="${preview.image}" alt="Previsualización" loading="lazy"></div>`;
    }
    innerHTML += '<div class="preview-info">';
    if (preview.title) {
        innerHTML += `<strong class="preview-title">${preview.title}</strong>`;
    }
    if (preview.description) {
        innerHTML += `<p class="preview-description">${preview.description}</p>`;
    }
    innerHTML += '</div>';

    linkCard.innerHTML = innerHTML;
    return linkCard;
}

export function createMessageElement(msg, isPrivate = false) {
    if (!msg.nick && !msg.from) {
        const item = document.createElement('li');
        item.className = `system-message ${msg.type || ''}`;
        item.textContent = msg.text;
        return item;
    }

    const senderNick = isPrivate ? msg.from : msg.nick;
    if (state.ignoredNicks.has(senderNick.toLowerCase())) {
        return document.createDocumentFragment();
    }

    const isMediaOnly = msg.preview && (msg.preview.type === 'image' || msg.preview.type === 'audio');
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

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    
    // 1. Crear siempre la cabecera con el nick.
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    headerDiv.innerHTML = `${getUserIcons(senderData)} <strong>${senderNick}</strong>`;
    mainContentWrapper.appendChild(headerDiv);

    // 2. Crear el contenedor del contenido del mensaje.
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (isMediaOnly) {
        contentDiv.classList.add('media-only-content');
    }

    // 3. Añadir la cita si es una respuesta.
    if (msg.replyTo) {
        const quoteDiv = document.createElement('div');
        quoteDiv.className = 'reply-quote';
        quoteDiv.innerHTML = `<strong>${msg.replyTo.nick}</strong><p>${replaceEmoticons(msg.replyTo.text)}</p>`;
        contentDiv.appendChild(quoteDiv);
    }
    
    // 4. Añadir el contenido principal (media o texto).
    if (isMediaOnly) {
        if (msg.preview.type === 'image') {
            const img = document.createElement('img');
            img.src = msg.preview.url;
            img.alt = msg.preview.title;
            img.className = 'media-message image-message';
            img.loading = 'lazy';
            contentDiv.appendChild(img);
        } else if (msg.preview.type === 'audio') {
            const audioPlayer = document.createElement('audio');
            audioPlayer.src = msg.preview.url;
            audioPlayer.controls = true;
            audioPlayer.preload = 'metadata';
            audioPlayer.className = 'media-message audio-message';
            contentDiv.appendChild(audioPlayer);
        }
    } else {
        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.innerHTML = replaceEmoticons(msg.text);
        contentDiv.appendChild(textSpan);
    }

    // 5. Añadir previsualización de enlaces si existe.
    const linkPreview = createPreviewCard(msg.preview);
    if (linkPreview) {
        contentDiv.appendChild(linkPreview);
    }
    
    // 6. Añadir la hora y el indicador de editado.
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'message-timestamp';
    timestampSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    contentDiv.appendChild(timestampSpan);
    
    if (msg.editedAt) {
        const editedSpan = document.createElement('span');
        editedSpan.className = 'edited-indicator';
        editedSpan.textContent = ' (editado)';
        contentDiv.appendChild(editedSpan);
    }

    mainContentWrapper.appendChild(contentDiv);

    // 7. Añadir los botones de acción al final.
    const iAmModerator = ['owner', 'admin'].includes(state.myUserData.role);
    if (!isPrivate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        // Botón de editar (solo para mensajes propios y de texto)
        if (isSent && msg.text && !isMediaOnly) {
            const editBtn = document.createElement('button');
            editBtn.textContent = '✏️';
            editBtn.title = 'Editar mensaje';
            editBtn.className = 'action-btn edit-btn';
            editBtn.dataset.messageId = msg.id;
            actionsDiv.appendChild(editBtn);
        }

        // Botón de borrar (para mensajes propios o si eres moderador)
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

    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================

    item.appendChild(mainContentWrapper);

    if (isPrivate) {
        item.classList.add(isSent ? 'sent' : 'received');
    } else {
        if (isSent) item.classList.add('sent-by-me');
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