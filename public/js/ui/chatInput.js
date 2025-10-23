import state from '../state.js';
import * as dom from '../domElements.js';
import { createMessageElement } from './renderer.js';
import { renderUserList } from './userInteractions.js';
import { addPrivateChat, updateConversationList } from './conversations.js';
import { updateUnreadCounts } from '../socket.js';
import { fetchWithCredentials } from './modals.js';

export function showReplyContextBar() {
    if (!state.replyingTo) return;
    const { nick, text } = state.replyingTo;
    dom.replyContextBar.querySelector('strong').textContent = nick;
    const preview = dom.replyContextBar.querySelector('.reply-text-preview');
    preview.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
    dom.replyContextBar.classList.remove('hidden');
    dom.input.focus();
}

export function hideReplyContextBar() {
    state.replyingTo = null;
    dom.replyContextBar.classList.add('hidden');
}

function handleTypingIndicator() {
    if (state.currentChatContext.type === 'none') return;
    if (!state.isTyping) {
        state.isTyping = true;
        state.socket.emit('typing', { context: state.currentChatContext, to: state.currentChatContext.with });
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
        state.isTyping = false;
        state.socket.emit('stop typing', { context: state.currentChatContext, to: state.currentChatContext.with });
    }, state.TYPING_TIMER_LENGTH);
}

function handleNickSuggestions() {
    const text = dom.input.value;
    const cursorPosition = dom.input.selectionStart;
    const textBeforeCursor = text.substring(0, cursorPosition);
    const words = textBeforeCursor.split(/[\s\n]/);
    const currentWord = words.pop();
    state.suggestionState.index = -1;
    if (currentWord.length === 0) {
        state.suggestionState.list = [];
        dom.commandSuggestions.classList.add('hidden');
        return;
    }
    state.suggestionState.list = state.currentRoomUsers.filter(user => user.nick.toLowerCase().startsWith(currentWord.toLowerCase()) && user.nick !== state.myNick);
    state.suggestionState.originalWord = currentWord;
    if (state.suggestionState.list.length > 0) {
        renderSuggestions();
    } else {
        dom.commandSuggestions.classList.add('hidden');
    }
}

function renderSuggestions() {
    if (state.suggestionState.list.length === 0) {
        dom.commandSuggestions.classList.add('hidden');
        return;
    }
    dom.commandSuggestions.innerHTML = '';
    const ul = document.createElement('ul');
    state.suggestionState.list.forEach((user, i) => {
        const li = document.createElement('li');
        li.textContent = user.nick;
        if (i === state.suggestionState.index) {
            li.classList.add('active-suggestion');
        }
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const text = dom.input.value;
            const textToReplace = state.suggestionState.originalWord;
            const lastIndex = text.toLowerCase().lastIndexOf(textToReplace.toLowerCase());
            if (lastIndex === -1) return;
            const before = text.substring(0, lastIndex);
            const after = text.substring(lastIndex + textToReplace.length);
            const newText = before + user.nick + ' ' + after.trimStart();
            dom.input.value = newText;
            dom.commandSuggestions.classList.add('hidden');
            state.suggestionState.list = [];
            state.suggestionState.index = -1;
            const newCursorPosition = (before + user.nick).length + 1;
            dom.input.focus();
            dom.input.setSelectionRange(newCursorPosition, newCursorPosition);
        });
        ul.appendChild(li);
    });
    dom.commandSuggestions.appendChild(ul);
    dom.commandSuggestions.classList.remove('hidden');
}

function autocompleteNick(nick) {
    const text = dom.input.value;
    const textToReplace = state.suggestionState.originalWord;
    const lastIndex = text.toLowerCase().lastIndexOf(textToReplace.toLowerCase());
    if (lastIndex === -1) return;
    
    const before = text.substring(0, lastIndex);
    const newText = before + nick;
    dom.input.value = newText;

    const newCursorPosition = newText.length;
    dom.input.focus();
    dom.input.setSelectionRange(newCursorPosition, newCursorPosition);
}

export function sendMessage() {
    const text = dom.input.value.trim();
    if (!text) return;
    dom.commandSuggestions.classList.add('hidden');
    state.suggestionState.list = [];
    if (state.isTyping && state.currentChatContext.type !== 'none') {
        clearTimeout(state.typingTimer);
        state.isTyping = false;
        state.socket.emit('stop typing', { context: state.currentChatContext, to: state.currentChatContext.with });
    }
    const { type, with: contextWith } = state.currentChatContext;
    if (text.startsWith('/incognito')) {
        const parts = text.split(' ');
        let newNick = null;
        if (parts.length > 1) {
            newNick = parts[1];
        }
        state.socket.emit('toggle incognito', { newNick });
        dom.input.value = '';
        dom.emojiPicker.classList.add('hidden');
        hideReplyContextBar();
        return;
    }

    const payload = { 
        text, 
        replyToId: state.replyingTo ? state.replyingTo.id : null
    };

    if (type === 'room') {
        payload.roomName = contextWith;
        state.socket.emit('chat message', payload);
    } else if (type === 'private') {
        payload.to = contextWith;
        state.socket.emit('private message', payload);
    }
    
    dom.input.value = '';
    dom.emojiPicker.classList.add('hidden');
    hideReplyContextBar();
}

export async function handleFileUpload(file) {
    if (!file || !state.currentChatContext.with || state.currentChatContext.type === 'none') {
        alert('Por favor, selecciona una sala o chat privado para enviar el archivo.');
        return;
    }
    if (file.size > 15 * 1024 * 1024) {
        alert('El archivo es demasiado grande (máx 15MB).');
        return;
    }

    const indicator = document.createElement('li');
    indicator.className = 'system-message';
    indicator.textContent = `Subiendo ${file.name}...`;
    const container = state.currentChatContext.type === 'room' ? dom.messagesContainer : dom.privateChatWindow.querySelector('ul');
    if(container) {
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
        const fileBase64 = reader.result;
        try {
            const options = {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.authToken}`
                },
                body: JSON.stringify({
                    fileBase64,
                    contextType: state.currentChatContext.type,
                    contextWith: state.currentChatContext.with,
                    senderNick: state.myNick
                })
            };

            const response = await fetch('/api/upload/chat-file', options);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detalle || errorData.error || 'Error desconocido del servidor');
            }

            const result = await response.json();
            console.log(result.message);

        } catch (error) {
            console.error('Error al subir archivo:', error);
            alert(`Error al subir archivo: ${error.message}`);
        } finally {
            if(indicator) indicator.remove();
        }
    };
    reader.onerror = () => {
        alert('No se pudo leer el archivo seleccionado.');
        if(indicator) indicator.remove();
    };
};

export function switchToChat(contextId, contextType) {
    if (contextType === 'private') {
        addPrivateChat(contextId); 
        if (state.currentChatContext.type === 'room') {
            state.lastActiveRoom = state.currentChatContext.with;
        }
    } else if (contextType === 'room') {
        state.lastActiveRoom = contextId;
        if (!state.joinedRooms.has(contextId)) {
            state.pendingRoomJoin = contextId;
        }
    }
    
    if (!state.socket.connected) {
        console.warn(`Socket desconectado. Intento de unirse a '${contextId}' pendiente.`);
        return;
    }
    
    state.pendingRoomJoin = null;

    state.usersTyping.clear();
    updateTypingIndicator();
    state.currentChatContext = { type: contextType, with: contextId };
    
    state.usersWithUnreadMessages.delete(contextId);
    
    updateConversationList();
    updateUnreadCounts();
    
    dom.userSearchInput.value = '';

    if (contextType === 'room' && !state.joinedRooms.has(contextId)) {
        state.socket.emit('join room', { roomName: contextId });
    } else {
        if (contextType === 'room') {
            dom.mainChatArea.classList.remove('hidden');
            dom.privateChatView.classList.add('hidden');
            dom.roomNameHeader.textContent = `Sala: ${contextId}`;
            dom.messagesContainer.innerHTML = '';
            const history = state.publicMessageHistories[contextId] || [];
            history.forEach(msg => dom.messagesContainer.appendChild(createMessageElement(msg, false)));
            dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;

            if (state.roomUserLists && state.roomUserLists[contextId]) {
                state.currentRoomUsers = state.roomUserLists[contextId];
            } else {
                state.currentRoomUsers = [];
            }

            renderUserList();
        } else {
            dom.mainChatArea.classList.add('hidden');
            dom.privateChatView.classList.remove('hidden');
            dom.privateChatWithUser.textContent = `Chat con ${contextId}`;
            dom.privateChatWindow.innerHTML = '';
            const ul = document.createElement('ul');
            const history = state.privateMessageHistories[contextId] || [];
            history.forEach(msg => ul.appendChild(createMessageElement(msg, true)));
            dom.privateChatWindow.appendChild(ul);
            ul.scrollTop = ul.scrollHeight;
            if (!state.privateMessageHistories[contextId]) {
                state.socket.emit('request private history', { withNick: contextId });
            }
        }
    }
}

export function updateTypingIndicator() {
    const targetIndicator = state.currentChatContext.type === 'room'
        ? dom.typingIndicator
        : dom.privateTypingIndicator;
    
    if (!targetIndicator) return;
    
    if (state.usersTyping.size === 0) {
        targetIndicator.textContent = '';
        targetIndicator.classList.add('hidden');
        return;
    }

    const users = Array.from(state.usersTyping);
    let text;
    if (users.length === 1) {
        text = `${users[0]} está escribiendo...`;
    } else if (users.length === 2) {
        text = `${users[0]} y ${users[1]} están escribiendo...`;
    } else {
        text = `Varios usuarios están escribiendo...`;
    }

    targetIndicator.textContent = text;
    targetIndicator.classList.remove('hidden');
}

export function initChatInput() {
    // ... (toda la lógica de grabación de audio no cambia) ...

    dom.input.addEventListener('input', () => {
        handleTypingIndicator();
        handleNickSuggestions();
    });

    dom.form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    dom.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dom.commandSuggestions.classList.add('hidden');
            state.suggestionState.list = [];
        }

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        if (e.key === 'Tab' && state.suggestionState.list.length > 0) {
            e.preventDefault(); 

            state.suggestionState.index = (state.suggestionState.index + 1) % state.suggestionState.list.length;
            
            const selectedUser = state.suggestionState.list[state.suggestionState.index];
            
            autocompleteNick(selectedUser.nick);
            
            // Actualizamos la palabra original con la que acabamos de autocompletar.
            // Esto es crucial para que el siguiente 'Tab' reemplace la palabra correcta.
            state.suggestionState.originalWord = selectedUser.nick;
            
            renderSuggestions();
        }
        // --- FIN DE LA CORRECCIÓN CLAVE ---
    });

    dom.imageUpload.addEventListener('change', (e) => {
        handleFileUpload(e.target.files[0]);
        e.target.value = '';
    });
    
    let emojisInitialized = false;
    dom.emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!emojisInitialized) {
            const emojis = [
                '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', 
                '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🤲', '🙏', '🤝',
                '❤️', '💔', '🔥', '✨', '⭐', '🎉', '🎈', '🎁', '🎂', '🍕', '🍔', '🍟', '🍿', '☕', '🍺', '🍷',
                '💯', '✅', '❌', '⚠️', '❓', '❗', '💀', '💩', '🤡', '👻', '👽', '👾', '🤖'
            ];
            dom.emojiPicker.innerHTML = '';
            emojis.forEach(emoji => {
                const span = document.createElement('span');
                span.textContent = emoji;
                span.addEventListener('click', () => { dom.input.value += emoji; dom.input.focus(); });
                dom.emojiPicker.appendChild(span);
            });
            emojisInitialized = true;
        }
        dom.emojiPicker.classList.toggle('hidden');
    });
    
    document.addEventListener('click', (e) => { 
        if (dom.emojiPicker && !dom.emojiPicker.contains(e.target) && e.target !== dom.emojiButton) {
            dom.emojiPicker.classList.add('hidden');
        }
    }, true);

    dom.cancelReplyButton.addEventListener('click', hideReplyContextBar);
}