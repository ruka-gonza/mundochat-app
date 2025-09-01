import state from '../state.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';

function createPreviewCard(preview) {
    if (!preview || !preview.url) return null;

    // --- INICIO DE LA MODIFICACIÓN ---
    if (preview.type === 'audio') {
        const audioCard = document.createElement('div');
        audioCard.className = 'link-preview-card audio-preview';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'preview-info';
        infoDiv.innerHTML = `<strong class="preview-title">${preview.title || 'Nota de voz'}</strong><p class="preview-description">${preview.description || ''}</p>`;
        
        const audioPlayer = document.createElement('audio');
        audioPlayer.src = preview.url;
        audioPlayer.controls = true;
        audioPlayer.preload = 'metadata';
        
        audioCard.appendChild(infoDiv);
        audioCard.appendChild(audioPlayer);
        
        return audioCard;
    }
    // --- FIN DE LA MODIFICACIÓN ---

    // El resto de la lógica para imágenes y YouTube
    const linkCard = document.createElement('a');
    linkCard.href = preview.url;
    linkCard.target = '_blank';
    linkCard.rel = 'noopener noreferrer';
    linkCard.className = 'link-preview-card';

    if (preview.type === 'image') {
        linkCard.dataset.previewType = 'image';
        linkCard.dataset.imageUrl = preview.image;
    }
    if (preview.type === 'youtube') {
        const videoIdMatch = preview.url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
        if (videoIdMatch) {
            linkCard.dataset.previewType = 'youtube';
            linkCard.dataset.youtubeId = videoIdMatch[1];
        }
    }

    let innerHTML = '';
    if (preview.image) {
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

    linkCard.innerHTML = innerHTML;
    return linkCard;
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

    if (!msg.preview || msg.preview.type !== 'image' && msg.preview.type !== 'audio') {
        textSpan.append(replaceEmoticons(msg.text));
    }

    contentDiv.appendChild(textSpan);

    if (msg.preview) {
        const previewCard = createPreviewCard(msg.preview);
        if (previewCard) {
            contentDiv.appendChild(previewCard);
        }
    }
    
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

    const iAmModerator = ['owner', 'admin'].includes(state.myUserData.role);
    if (!isPrivate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        if (isSent && msg.text && (!msg.preview || msg.preview.type === 'youtube')) {
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