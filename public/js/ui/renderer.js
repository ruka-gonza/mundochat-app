import state from '../state.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';

function createEmbedElement(text) {
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const gifRegex = /(https?:\/\/\S+\.(?:gif))/i;

    const youtubeMatch = text.match(youtubeRegex);
    const gifMatch = text.match(gifRegex);

    let embedContainer = null;
    let embedContent = null;

    if (youtubeMatch && youtubeMatch[1]) {
        const videoId = youtubeMatch[1];
        embedContainer = document.createElement('div');
        embedContainer.className = 'message-embed-container';

        embedContent = document.createElement('iframe');
        
        const origin = window.location.origin;

        embedContent.src = `https://www.youtube-nocookie.com/embed/${videoId}?origin=${encodeURIComponent(origin)}`;
        embedContent.sandbox = 'allow-scripts allow-same-origin allow-presentation allow-popups';
        embedContent.title = 'Reproductor de video de YouTube';
        embedContent.frameBorder = '0';
        embedContent.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        embedContent.allowFullscreen = true;

    } else if (gifMatch && gifMatch[0]) {
        const gifUrl = gifMatch[0];
        embedContainer = document.createElement('div');
        embedContainer.className = 'message-embed-container';

        embedContent = document.createElement('img');
        embedContent.src = gifUrl;
        embedContent.alt = 'GIF animado';
        embedContent.loading = 'lazy';
    }

    if (embedContainer && embedContent) {
        embedContent.className = 'embed-content';
        embedContainer.appendChild(embedContent);

        const closeButton = document.createElement('button');
        closeButton.className = 'embed-close-btn';
        closeButton.textContent = '×';
        closeButton.title = 'Cerrar vista previa';
        embedContainer.appendChild(closeButton);
    }

    return embedContainer;
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
    
    const icons = getUserIcons(senderData);
    const displayName = isPrivate ? (isSent ? 'Yo' : msg.from) : msg.nick;
    
    const nickElement = document.createElement('span');
    nickElement.className = 'message-nick';
    nickElement.innerHTML = `${icons} <strong>${displayName}</strong>: `;

    if (displayName !== 'Yo' && msg.nick !== state.myNick) {
        nickElement.dataset.nick = msg.nick;
        nickElement.dataset.messageId = msg.id;
    }

    if (msg.text) {
        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.appendChild(nickElement);
        textSpan.append(replaceEmoticons(msg.text));
        contentDiv.appendChild(textSpan);
    }

    if (msg.file) {
        let fileElement;
        
        if (!msg.text) {
             contentDiv.appendChild(nickElement);
        }

        if (msg.type.startsWith('image/')) {
            fileElement = document.createElement('img');
            fileElement.src = msg.file;
            fileElement.className = 'image-thumbnail';
            fileElement.alt = `Imagen de ${displayName}`;
            fileElement.style.marginTop = '5px';
        } else if (msg.type.startsWith('audio/')) {
            fileElement = document.createElement('audio');
            fileElement.src = msg.file;
            fileElement.controls = true;
            fileElement.style.marginTop = '5px';
        }

        if (fileElement) {
            contentDiv.appendChild(fileElement);
        }
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // AÑADIMOS UNA COMPROBACIÓN PARA EVITAR ERRORES CON MENSAJES ANTIGUOS
    if (msg.timestamp) {
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'message-timestamp';
        timestampSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        contentDiv.appendChild(timestampSpan);
    }
    // --- FIN DE LA CORRECCIÓN ---

    if (msg.editedAt) {
        const editedSpan = document.createElement('span');
        editedSpan.className = 'edited-indicator';
        editedSpan.textContent = ' (editado)';
        contentDiv.appendChild(editedSpan);
    }

    mainContentWrapper.appendChild(contentDiv);

    if (msg.text) {
        const embedElement = createEmbedElement(msg.text);
        if (embedElement) {
            mainContentWrapper.appendChild(embedElement);
        }
    }

    const iAmModerator = ['owner', 'admin'].includes(state.myUserData.role);
    if (!isPrivate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        if (isSent && msg.text) {
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