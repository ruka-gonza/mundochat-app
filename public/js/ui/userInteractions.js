import state from '../state.js';
import * as dom from '../domElements.js';
import { getUserIcons, replaceEmoticons } from '../utils.js';
import { switchToChat, showReplyContextBar } from './chatInput.js';

function showSelfContextMenu(event) {
    // --- INICIO DE LA CORRECCIÓN CRÍTICA ---
    // Solo prevenimos la acción por defecto si es un clic derecho (contextmenu)
    if (event.type === 'contextmenu') {
        event.preventDefault();
    }
    // --- FIN DE LA CORRECCIÓN CRÍTICA ---
    event.stopPropagation();

    const menu = document.getElementById('self-context-menu');
    const afkButton = document.getElementById('self-afk-button');
    const avatarLabel = document.getElementById('self-avatar-label-guest');

    // Lógica del botón AFK
    afkButton.textContent = state.isAFK ? 'Volver' : 'Ausentar';
    afkButton.onclick = () => {
        state.socket.emit('toggle afk');
        menu.classList.add('hidden');
    };

    // Lógica para el botón de avatar de invitado
    if (state.myUserData.role === 'guest') {
        avatarLabel.classList.remove('hidden');
        // El clic en la label ya abre el input, no necesita un .onclick
    } else {
        avatarLabel.classList.add('hidden');
    }

    menu.style.top = `${event.pageY}px`;
    menu.style.left = `${event.pageX}px`;
    menu.classList.remove('hidden');
}

// Nueva función para manejar la subida del archivo del invitado
async function handleGuestAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Ocultar el menú contextual si sigue abierto
    document.getElementById('self-context-menu').classList.add('hidden');

    const formData = new FormData();
    formData.append('avatarFile', file);
    formData.append('guestId', state.myUserData.id); // Enviamos el UUID del invitado

    try {
        const response = await fetch('/api/guest/avatar', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (!response.ok) {
            alert(`Error: ${result.error || 'No se pudo subir la imagen.'}`);
        }
        // No es necesario hacer nada más, el evento 'user_data_updated' del servidor se encargará
        
    } catch (error) {
        console.error('Error al subir avatar de invitado:', error);
        alert('Hubo un error de conexión al subir el avatar.');
    } finally {
        // Limpiar el input para permitir subir la misma imagen de nuevo si se desea
        event.target.value = '';
    }
}

export function renderUserList() {
    const searchTerm = dom.userSearchInput.value.toLowerCase().trim();
    const filteredUsers = state.currentRoomUsers.filter(user => user.nick.toLowerCase().includes(searchTerm));
    dom.userList.innerHTML = '';
    dom.userCount.textContent = filteredUsers.length;

    filteredUsers.forEach(user => {
        const userData = state.allUsersData[user.nick.toLowerCase()] || user;
        const avatarUrl = userData.avatar_url || 'image/default-avatar.png';
        const item = document.createElement('li');
        item.className = 'user-list-item';
        
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
            item.addEventListener('contextmenu', (e) => showSelfContextMenu(e)); // Clic derecho
            item.addEventListener('click', (e) => showSelfContextMenu(e));       // Clic izquierdo
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

function openImageModal(imageSrc) {
    if (dom.modalImage && dom.imageModalOverlay) {
        dom.modalImage.src = imageSrc;
        dom.imageModalOverlay.classList.remove('hidden');
    }
}

function closeImageModal() {
    if (dom.imageModalOverlay) {
        dom.imageModalOverlay.classList.add('hidden');
        dom.modalImage.src = '';
    }
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
        if (e.target.classList.contains('image-thumbnail')) {
            e.stopPropagation();
            openImageModal(e.target.src);
            return;
        }

        const actionButton = e.target.closest('.action-btn');
        const nickElement = e.target.closest('.message-nick');

        if (nickElement && nickElement.dataset.nick) {
            const nick = nickElement.dataset.nick;
            const messageId = nickElement.dataset.messageId;
            if (nick === state.myNick) {
                showSelfContextMenu(e);
            } else {
                showNickContextMenu(e, nick, messageId);
            }
            return;
        }

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

        const messageContentClicked = e.target.closest('.message-content');
        const currentlyVisible = document.querySelector('#messages > li.actions-visible');

        if (messageContentClicked) {
            e.stopPropagation();
            const messageItem = messageContentClicked.closest('li');

            if (currentlyVisible && currentlyVisible !== messageItem) {
                currentlyVisible.classList.remove('actions-visible');
            }

            if (messageItem) {
                messageItem.classList.toggle('actions-visible');
            }
        } else {
            if (currentlyVisible) {
                currentlyVisible.classList.remove('actions-visible');
            }
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
