import state from '../state.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';
import { openImageModal } from './modals.js';

function createPreviewCard(preview) {
    if (!preview || !preview.url || preview.type === 'image' || preview.type === 'audio' || preview.type === 'youtube') {
        return null;
    }
    const linkCard = document.createElement('a');
    linkCard.href = preview.url;
    linkCard.target = '_blank';
    linkCard.rel = 'noopener noreferrer';
    linkCard.className = 'link-preview-card';
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

function processMessageText(text) {
    if (!text) return ''; // Prevenir errores si el texto es nulo o undefined
    
    const youtubeRegex = /^(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11}))\s*$/i;
    const youtubeMatch = text.match(youtubeRegex);

    if (youtubeMatch && youtubeMatch[1]) {
        const videoId = youtubeMatch[1];
        return `<iframe 
                    width="480" 
                    height="270" 
                    src="https://www.youtube.com/embed/${videoId}" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen 
                    referrerpolicy="strict-origin-when-cross-origin">
                </iframe>`;
    }

    const imageRegex = /(https?:\/\/[^\s]+\.(?:gif|png|jpg|jpeg|webp))/gi;
    return text.replace(imageRegex, '<a href="$1" target="_blank"><img src="$1" class="chat-image" alt="Image" loading="lazy"></a>');
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

    const isSent = msg.from === state.myNick || msg.nick === state.myNick;
    
    const item = document.createElement('li');
    item.id = `message-${msg.id}`;
    
    const senderData = state.allUsersData[senderNick.toLowerCase()] || {};
    const avatarUrl = senderData.avatar_url || 'image/default-avatar.png';
    
    const avatarImg = document.createElement('img');
    avatarImg.src = avatarUrl;
    avatarImg.className = 'message-avatar';
    item.appendChild(avatarImg);

    const mainContentWrapper = document.createElement('div');
    mainContentWrapper.className = 'message-main-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    const displayName = senderNick;
    headerDiv.innerHTML = `${getUserIcons(senderData)} <strong>${displayName}</strong>`;
    
    if (!isSent) {
        headerDiv.dataset.nick = senderNick;
        headerDiv.dataset.messageId = msg.id;
        headerDiv.style.cursor = 'pointer';
    }
    
    if (msg.replyTo) {
        const quoteDiv = document.createElement('div');
        quoteDiv.className = 'reply-quote';
        const quoteNick = document.createElement('strong');
        quoteNick.textContent = msg.replyTo.nick;
        const quoteText = document.createElement('p');
        const previewText = msg.replyTo.text.length > 70 ? msg.replyTo.text.substring(0, 70) + '...' : msg.replyTo.text;
        quoteText.innerHTML = twemoji.parse(replaceEmoticons(previewText));
        quoteDiv.appendChild(quoteNick);
        quoteDiv.appendChild(quoteText);
        contentDiv.appendChild(quoteDiv);
    }
    
    contentDiv.appendChild(headerDiv);

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    
    // Simplificamos la lógica de renderizado
    const processedHTML = processMessageText(msg.text);
    const isYoutubeVideo = processedHTML.startsWith('<iframe');

    if (msg.preview && (msg.preview.type === 'image' || msg.preview.type === 'audio')) {
        // CASO 1: Es un archivo subido (imagen o audio)
        contentDiv.classList.add('media-only-content');
        if (msg.preview.type === 'image') {
            const img = document.createElement('img');
            img.src = msg.preview.url;
            img.alt = msg.preview.title;
            img.className = 'media-message image-message';
            img.loading = 'lazy';
            const link = document.createElement('a');
            link.href = msg.preview.url;
            link.target = '_blank';
            link.appendChild(img);
            contentDiv.appendChild(link);
        } else if (msg.preview.type === 'audio') {
            const audioPlayer = document.createElement('audio');
            audioPlayer.src = msg.preview.url;
            audioPlayer.controls = true;
            audioPlayer.preload = 'metadata';
            audioPlayer.className = 'media-message audio-message';
            contentDiv.appendChild(audioPlayer);
        }
    } else if (isYoutubeVideo) {
        // CASO 2: Es un enlace de YouTube
        const textContainer = document.createElement('div');
        textContainer.className = 'message-text';
        textContainer.innerHTML = processedHTML;
        contentDiv.appendChild(textContainer);
    } else {
        // CASO 3: Es un mensaje de texto normal (puede contener otras imágenes o previews)
        const textContainer = document.createElement('div');
        textContainer.className = 'message-text';
        textContainer.innerHTML = twemoji.parse(replaceEmoticons(processedHTML));
        contentDiv.appendChild(textContainer);
        
        const linkPreview = createPreviewCard(msg.preview);
        if (linkPreview) {
            contentDiv.appendChild(linkPreview);
        }
    }
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    
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

    const iAmModerator = (state.myUserData.role === 'owner' || state.myUserData.role === 'admin') || (state.myOriginalRole === 'owner' || state.myOriginalRole === 'admin');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    
    if (isSent && msg.text && !isYoutubeVideo) {
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