import state from '../state.js';
import * as dom from '../domElements.js';
import { getUserIcons } from '../utils.js';
import { switchToChat, showReplyContextBar } from './chatInput.js';
import { openImageModal, fetchWithCredentials } from './modals.js';

function showSelfContextMenu(event) {
    if (event.type === 'contextmenu') {
        event.preventDefault();
    }
    event.stopPropagation();

    const menu = document.getElementById('self-context-menu');
    const afkButton = document.getElementById('self-afk-button');
    const avatarLabel = document.getElementById('self-avatar-label-guest');

    afkButton.textContent = state.isAFK ? 'Volver' : 'Ausentar';
    afkButton.onclick = () => {
        state.socket.emit('toggle afk');
        menu.classList.add('hidden');
    };

    if (state.myUserData.role === 'guest') {
        avatarLabel.classList.remove('hidden');
    } else {
        avatarLabel.classList.add('hidden');
    }

    menu.style.top = `${event.pageY}px`;
    menu.style.left = `${event.pageX}px`;
    menu.classList.remove('hidden');
}

async function handleGuestAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('self-context-menu').classList.add('hidden');

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
        const avatarBase64 = reader.result;
        try {
            // Usa la ruta universal /api/user/avatar
            await fetchWithCredentials('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatarBase64 }) // Solo necesita el Base64, el servidor sabe quién es
            });
        } catch (error) {
            console.error('Error al subir avatar de invitado:', error);
            alert('Hubo un error de conexión al subir el avatar: ' + error.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.onerror = error => {
        console.error('Error al leer el archivo para Base64:', error);
        alert('No se pudo procesar el archivo seleccionado.');
    };
}

export function renderUserList() {
    const searchTerm = dom.userSearchInput.value.toLowerCase().trim();
    
    const uniqueUsers = [];
    const seenNicks = new Set();
    state.currentRoomUsers.forEach(user => {
        const lowerNick = user.nick.toLowerCase();
        if (!seenNicks.has(lowerNick)) {
            seenNicks.add(lowerNick);
            uniqueUsers.push(user);
        }
    });

    const filteredUsers = uniqueUsers.filter(user => user.nick.toLowerCase().includes(searchTerm));
    
    dom.userList.innerHTML = '';
    dom.userCount.textContent = filteredUsers.length;

    filteredUsers.forEach(user => {
        const userData = state.allUsersData[user.nick.toLowerCase()] || user;
        const avatarUrl = userData.avatar_url || 'image/default-avatar.png';
        const item = document.createElement('li');
        item.className = 'user-list-item';
        
        item.dataset.socketId = user.socketId;

        if (state.ignoredNicks.has(user.nick.toLowerCase())) {
            item.classList.add('ignored');
        }

        const avatarImg = document.createElement('img');
        avatarImg.src = avatarUrl;
        avatarImg.className = 'user-list-avatar';
        item.appendChild(avatarImg);

        const nickSpan = document.createElement('span');
        nickSpan.innerHTML = `${getUserIcons(userData)} ${user.nick}`;
        item.appendChild(nickSpan);

        if (user.nick === state.myNick) {
            item.classList.add('self');
            item.addEventListener('contextmenu', (e) => showSelfContextMenu(e));
            item.addEventListener('click', (e) => showSelfContextMenu(e));
        } else {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                showUserActionPopup(e.currentTarget, user);
            });
        }
        dom.userList.appendChild(item);
    });
}

function showUserActionPopup(targetElement, user) {
    document.getElementById('popup-user-nick').textContent = user.nick;
    document.getElementById('popup-user-id').textContent = `ID: ${user.id}`;

    const pmButton = document.getElementById('popup-pm-button');
    const ignoreButton = document.getElementById('popup-ignore-button');
    const reportButton = document.getElementById('popup-report-button');

    pmButton.onclick = () => {
        state.socket.emit('request private chat', { targetNick: user.nick });
        dom.userActionPopup.classList.add('hidden');
        dom.userListContainer.classList.remove('show');
        document.getElementById('mobile-overlay').classList.remove('show');
    };

    const isIgnored = state.ignoredNicks.has(user.nick.toLowerCase());
    ignoreButton.textContent = isIgnored ? 'Dejar de Ignorar' : 'Ignorar';
    ignoreButton.onclick = () => {
        const nickLower = user.nick.toLowerCase();
        if (state.ignoredNicks.has(nickLower)) {
            state.ignoredNicks.delete(nickLower);
        } else {
            state.ignoredNicks.add(nickLower);
        }
        renderUserList();
        dom.userActionPopup.classList.add('hidden');
    };

    reportButton.onclick = () => {
        const reason = prompt(`Por favor, describe brevemente por qué denuncias a ${user.nick}:`, "Acoso/Spam");
        if (reason && reason.trim() !== '') {
            state.socket.emit('report user', { targetNick: user.nick, reason: reason.trim() });
        }
        dom.userActionPopup.classList.add('hidden');
    };

    const rect = targetElement.getBoundingClientRect();
    dom.userActionPopup.style.top = `${rect.bottom + 5}px`;
    dom.userActionPopup.style.left = `${rect.left}px`;
    dom.userActionPopup.classList.remove('hidden');
}

function showNickContextMenu(event, nick, messageId) {
    event.preventDefault();
    event.stopPropagation();

    const menu = document.getElementById('nick-context-menu');
    const pmButton = document.getElementById('context-pm-button');
    const replyButton = document.getElementById('context-reply-button');

    pmButton.onclick = () => {
        switchToChat(nick, 'private');
        menu.classList.add('hidden');
    };

    replyButton.onclick = () => {
        const messageElement = document.getElementById(`message-${messageId}`);
        const textElement = messageElement.querySelector('.message-text');
        if (textElement) {
            const textContentClone = textElement.cloneNode(true);
            textContentClone.querySelector('.message-nick').remove();
            
            state.replyingTo = {
                id: messageId,
                nick: nick,
                text: textContentClone.textContent.trim()
            };
            showReplyContextBar();
        }
        menu.classList.add('hidden');
    };

    menu.style.top = `${event.pageY}px`;
    menu.style.left = `${event.pageX}px`;
    menu.classList.remove('hidden');
}

function promptForEdit(messageId) {
    const messageElement = document.getElementById(`message-${messageId}`);
    if (!messageElement) return;

    const textSpan = messageElement.querySelector('.message-text');
    if (!textSpan) return;

    const textContentClone = textSpan.cloneNode(true);
    const nickElementInClone = textContentClone.querySelector('.message-nick');
    if (nickElementInClone) nickElementInClone.remove();
    const currentText = textContentClone.textContent.trim();

    const newText = prompt('Edita tu mensaje:', currentText);
    if (newText && newText.trim() !== '' && newText !== currentText) {
        state.socket.emit('edit message', { messageId, newText, roomName: state.currentChatContext.with });
    }
}

function showAvatarPopup(avatarElement) {
    const avatarSrc = avatarElement.src;
    if (!avatarSrc || avatarSrc.endsWith('default-avatar.png')) return;
    
    const popupImg = dom.avatarHoverPopup.querySelector('img');
    popupImg.src = avatarSrc;
    
    const rect = avatarElement.getBoundingClientRect();
    const popupWidth = 210;
    const isMobile = window.innerWidth <= 1024;
    
    if (isMobile) {
        dom.avatarHoverPopup.style.left = '50%';
        dom.avatarHoverPopup.style.top = '50%';
        dom.avatarHoverPopup.style.transform = 'translate(-50%, -50%)';
    } else {
        let left = rect.right + 10;
        if (left + popupWidth > window.innerWidth) {
            left = rect.left - popupWidth - 10;
        }
        const top = rect.top;
        dom.avatarHoverPopup.style.left = `${left}px`;
        dom.avatarHoverPopup.style.top = `${top}px`;
        dom.avatarHoverPopup.style.transform = 'none';
    }
    
    dom.avatarHoverPopup.classList.remove('hidden');
    setTimeout(() => dom.avatarHoverPopup.classList.add('visible'), 10);
}

function hideAvatarPopup() {
    dom.avatarHoverPopup.classList.remove('visible');
    setTimeout(() => {
        if (!dom.avatarHoverPopup.classList.contains('visible')) {
            dom.avatarHoverPopup.classList.add('hidden');
        }
    }, 200);
}

function closeImageModal() {
    if (dom.imageModalOverlay) {
        dom.imageModalOverlay.classList.add('hidden');
        dom.modalImage.src = '';
    }
}

function createYoutubeEmbed(youtubeId, targetContainer) {
    const embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1`;
    iframe.title = "Reproductor de video de YouTube";
    iframe.frameBorder = "0";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    
    embedWrapper.appendChild(iframe);
    
    targetContainer.parentNode.replaceChild(embedWrapper, targetContainer);
}

export function initUserInteractions() {
    dom.userSearchInput.addEventListener('input', renderUserList);
    
    const guestAvatarInput = document.getElementById('guest-avatar-input');
    if (guestAvatarInput) {
        guestAvatarInput.addEventListener('change', handleGuestAvatarUpload);
    }

    dom.chatContainer.addEventListener('mouseover', (e) => {
        if (window.innerWidth > 1024) {
            const avatar = e.target.closest('.message-avatar, .user-list-avatar');
            if (avatar) showAvatarPopup(avatar);
        }
    });

    dom.chatContainer.addEventListener('mouseout', (e) => {
        if (window.innerWidth > 1024) {
            const avatar = e.target.closest('.message-avatar, .user-list-avatar');
            if (avatar) hideAvatarPopup();
        }
    });
    
    dom.chatContainer.addEventListener('click', (e) => {
        const avatar = e.target.closest('.message-avatar, .user-list-avatar');
        if (avatar) {
            e.stopPropagation();
            showAvatarPopup(avatar);
        }
    });

    dom.messagesContainer.addEventListener('click', (e) => {
        
        const previewCard = e.target.closest('.link-preview-card');
        if (previewCard) {
            e.preventDefault(); 
            const type = previewCard.dataset.previewType;
            if (type === 'image') {
                openImageModal(previewCard.dataset.imageUrl);
            } else if (type === 'youtube') {
                createYoutubeEmbed(previewCard.dataset.youtubeId, previewCard);
            }
            return;
        }
        
        const currentlyVisible = document.querySelector('#messages > li.actions-visible');
        if (currentlyVisible && !e.target.closest('li')) {
            currentlyVisible.classList.remove('actions-visible');
        }

        const messageItem = e.target.closest('li');
        if (messageItem && currentlyVisible && currentlyVisible !== messageItem) {
            currentlyVisible.classList.remove('actions-visible');
        }
        if (messageItem) {
            messageItem.classList.toggle('actions-visible');
        }
        
        const actionButton = e.target.closest('.action-btn');
        if (actionButton) {
            e.stopPropagation();
            const messageId = actionButton.dataset.messageId;
            if (actionButton.classList.contains('edit-btn')) {
                promptForEdit(messageId);
            } else if (actionButton.classList.contains('delete-btn')) {
                const isModAction = actionButton.dataset.isModAction === 'true';
                const confirmationMessage = isModAction ? '¿Estás seguro de que quieres borrar este mensaje como moderador?' : '¿Estás seguro de que quieres eliminar este mensaje?';
                if (confirm(confirmationMessage)) {
                    const eventName = isModAction ? 'delete any message' : 'delete message';
                    state.socket.emit(eventName, { messageId, roomName: state.currentChatContext.with });
                }
            }
            actionButton.closest('li.actions-visible')?.classList.remove('actions-visible');
            return;
        }

        const nickElement = e.target.closest('.message-nick');
        if (nickElement && nickElement.dataset.nick) {
            const nick = nickElement.dataset.nick;
            const messageId = nickElement.dataset.messageId;
            if (nick === state.myNick) showSelfContextMenu(e);
            else showNickContextMenu(e, nick, messageId);
            return;
        }
    });

    dom.closeImageModalButton.addEventListener('click', closeImageModal);
    dom.imageModalOverlay.addEventListener('click', (e) => {
        if (e.target === dom.imageModalOverlay) {
            closeImageModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape" && !dom.imageModalOverlay.classList.contains('hidden')) {
            closeImageModal();
        }
    });

    document.addEventListener('click', (e) => {
        if (dom.roomSwitcher.classList.contains('show') && !dom.roomHeaderContainer.contains(e.target)) {
            dom.roomSwitcher.classList.remove('show');
        }
        if (!dom.commandSuggestions.contains(e.target) && e.target !== dom.input) {
            dom.commandSuggestions.classList.add('hidden');
        }
        if (!dom.userActionPopup.contains(e.target) && !e.target.closest('.user-list-item')) {
            dom.userActionPopup.classList.add('hidden');
        }
        if (dom.avatarHoverPopup.classList.contains('visible') && !dom.avatarHoverPopup.contains(e.target)) {
            hideAvatarPopup();
        }
        const menu = document.getElementById('nick-context-menu');
        if (menu && !menu.contains(e.target)) {
            menu.classList.add('hidden');
        }
        
        const selfMenu = document.getElementById('self-context-menu');
        if (selfMenu && !selfMenu.contains(e.target)) {
            selfMenu.classList.add('hidden');
        }
    });
}