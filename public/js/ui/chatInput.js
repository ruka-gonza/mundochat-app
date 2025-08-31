import state from '../state.js';
import * as dom from '../domElements.js';
import { createMessageElement } from './renderer.js';
import { renderUserList } from './userInteractions.js';
import { addPrivateChat, updateConversationList } from './conversations.js';
import { updateUnreadCounts } from '../socket.js';

// --- Funciones para manejar la barra de respuesta ---
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
            autocompleteNick(user.nick);
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
    const after = text.substring(lastIndex + textToReplace.length);
    const newText = before + nick + ' ' + after.trimStart();
    dom.input.value = newText;
    dom.commandSuggestions.classList.add('hidden');
    state.suggestionState.list = [];
    state.suggestionState.index = -1;
    const newCursorPosition = (before + nick).length + 1;
    dom.input.focus();
    dom.input.setSelectionRange(newCursorPosition, newCursorPosition);
}

function resetAudioRecorderUI() {
    dom.audioRecordButton.classList.remove('hidden', 'recording');
    dom.audioRecordButton.innerHTML = '🎤';
    dom.audioSendButton.classList.add('hidden');
    dom.audioCancelButton.classList.add('hidden');
    dom.input.classList.remove('hidden');
    state.audioChunks = [];
    state.audioBlob = null;
    state.mediaRecorder = null;
    if (state.audioStream) {
        state.audioStream.getTracks().forEach(track => track.stop());
        state.audioStream = null;
    }
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
    if (type === 'room') {
        const payload = { 
            text, 
            roomName: contextWith,
            replyToId: state.replyingTo ? state.replyingTo.id : null
        };
        state.socket.emit('chat message', payload);
    } else if (type === 'private') {
        state.socket.emit('private message', { to: contextWith, text: text });
    }
    dom.input.value = '';
    dom.emojiPicker.classList.add('hidden');
    hideReplyContextBar();
}

export function handleFileUpload(file) {
    if (!file || !state.currentChatContext.with) {
        state.socket.emit('system message', { text: 'No hay archivo o chat activo para enviar.', type: 'error' });
        return;
    }
    if (file.size > 10 * 1024 * 1024) { // Límite de 10MB
        state.socket.emit('system message', { text: 'El archivo es demasiado grande (máx 10MB).', type: 'error' });
        return;
    }

    const fileId = `${Date.now()}-${file.name}`;
    const chunkSize = 64 * 1024;
    let offset = 0;
    const eventName = state.currentChatContext.type === 'room' ? 'file-start' : 'private-file-start';
    const payload = { id: fileId, name: file.name, type: file.type, size: file.size, ...(state.currentChatContext.type === 'room' ? { roomName: state.currentChatContext.with } : { to: state.currentChatContext.with }) };
    state.socket.emit(eventName, payload);
    const reader = new FileReader();
    reader.onload = (e) => {
        state.socket.emit('file-chunk', { id: fileId, data: e.target.result });
        offset += e.target.result.byteLength;
        if (offset < file.size) readSlice(offset);
    };
    const readSlice = o => {
        const slice = file.slice(o, o + chunkSize);
        reader.readAsArrayBuffer(slice);
    };
    readSlice(0);
};

export function switchToChat(contextId, contextType) {
    if (contextType === 'private') {
        addPrivateChat(contextId); 
        if (state.currentChatContext.type === 'room') {
            state.lastActiveRoom = state.currentChatContext.with;
        }
    }
    state.usersTyping.clear();
    updateTypingIndicator();
    state.currentChatContext = { type: contextType, with: contextId };
    
    state.usersWithUnreadMessages.delete(contextId);
    
    updateConversationList();
    updateUnreadCounts();
    
    dom.userSearchInput.value = '';
    let history = [];
    let view, container;

    if (contextType === 'room') {
        state.socket.emit('request user list', { roomName: contextId });
        
        if (!state.publicMessageHistories[contextId]) {
            state.publicMessageHistories[contextId] = [];
        }
        history = state.publicMessageHistories[contextId];
        view = dom.mainChatArea;
        container = dom.messagesContainer;
        dom.roomNameHeader.textContent = `Sala: ${contextId}`;
        dom.privateChatView.classList.add('hidden');
        view.classList.remove('hidden');
        
        container.innerHTML = '';
        history.forEach(msg => container.appendChild(createMessageElement(msg, false)));
        container.scrollTop = container.scrollHeight;
    } else {
        view = dom.privateChatView;
        container = dom.privateChatWindow;
        dom.privateChatWithUser.textContent = `Chat con ${contextId}`;
        dom.mainChatArea.classList.add('hidden');
        view.classList.remove('hidden');
        
        // =========================================================================
        // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
        // =========================================================================
        // ESTAS SON LAS LÍNEAS QUE CAUSABAN EL ERROR. LAS HEMOS ELIMINADO.
        // state.currentRoomUsers = []; 
        // renderUserList();
        // Al no tocar la lista, el panel de la derecha se mantendrá como estaba.
        // =========================================================================
        // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
        // =========================================================================
        
        container.innerHTML = '';
        if (!state.privateMessageHistories[contextId]) {
            state.socket.emit('request private history', { withNick: contextId });
        } else {
            const ul = document.createElement('ul');
            state.privateMessageHistories[contextId].forEach(msg => {
                ul.appendChild(createMessageElement(msg, true));
            });
            container.appendChild(ul);
            ul.scrollTop = ul.scrollHeight;
        }
    }
}

export function updateTypingIndicator() {
    dom.typingIndicator.textContent = '';
    dom.typingIndicator.classList.add('hidden');
    dom.privateTypingIndicator.textContent = '';
    dom.privateTypingIndicator.classList.add('hidden');

    if (state.usersTyping.size === 0) {
        return;
    }

    const targetIndicator = state.currentChatContext.type === 'room'
        ? dom.typingIndicator
        : dom.privateTypingIndicator;

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
        if (e.key === 'Tab' && state.suggestionState.list.length > 0) {
            e.preventDefault();
            state.suggestionState.index = (state.suggestionState.index + 1) % state.suggestionState.list.length;
            const selectedUser = state.suggestionState.list[state.suggestionState.index];
            const text = dom.input.value;
            const textToReplace = state.suggestionState.originalWord;
            const lastIndex = text.toLowerCase().lastIndexOf(textToReplace.toLowerCase());
            if (lastIndex !== -1) {
                const before = text.substring(0, lastIndex);
                dom.input.value = before + selectedUser.nick;
                state.suggestionState.originalWord = selectedUser.nick;
            }
            renderSuggestions();
        }
    });

    dom.imageUpload.addEventListener('change', (e) => {
        handleFileUpload(e.target.files[0]);
        e.target.value = '';
    });
    
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
    dom.emojiButton.addEventListener('click', (e) => { e.stopPropagation(); dom.emojiPicker.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => { if (!dom.emojiPicker.contains(e.target) && e.target !== dom.emojiButton) dom.emojiPicker.classList.add('hidden'); }, true);

    dom.audioRecordButton.addEventListener('click', async () => {
        if (!state.currentChatContext.with || state.currentChatContext.type === 'none') {
            state.socket.emit('system message', { text: 'Selecciona una sala o chat privado para enviar notas de voz.', type: 'error' });
            return;
        }

        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
        } else {
            try {
                state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const options = MediaRecorder.isTypeSupported('audio/webm; codecs=opus') ? { mimeType: 'audio/webm; codecs=opus' } : {};
                state.mediaRecorder = new MediaRecorder(state.audioStream, options);
                state.audioChunks = [];
                state.audioBlob = null;

                state.mediaRecorder.ondataavailable = (event) => {
                    state.audioChunks.push(event.data);
                };

                state.mediaRecorder.onstop = () => {
                    state.audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
                    dom.audioRecordButton.classList.add('hidden');
                    dom.audioRecordButton.classList.remove('recording');
                    dom.audioSendButton.classList.remove('hidden');
                    dom.audioCancelButton.classList.remove('hidden');
                    dom.input.classList.add('hidden');
                
                    if (state.audioStream) {
                        state.audioStream.getTracks().forEach(track => track.stop());
                    }
                    state.socket.emit('system message', { text: 'Grabación detenida. Haz clic en "Enviar" para enviar o "Cancelar" para cancelar.', type: 'highlight' });
                };

                state.mediaRecorder.start();
                dom.audioRecordButton.classList.add('recording');
                state.socket.emit('system message', { text: 'Grabando audio... Haz clic en el micrófono de nuevo para detener.', type: 'highlight' });

            } catch (err) {
                console.error('Error al acceder al micrófono:', err);
                state.socket.emit('system message', { text: 'No se pudo acceder al micrófono. Asegúrate de dar permiso.', type: 'error' });
            }
        }
    });
    dom.audioSendButton.addEventListener('click', () => {
        if (state.audioBlob && state.currentChatContext.with) {
            const fileName = `audio-${Date.now()}.${state.audioBlob.type.split('/')[1].split(';')[0] || 'ogg'}`;
            handleFileUpload(new File([state.audioBlob], fileName, { type: state.audioBlob.type }));
            
            resetAudioRecorderUI();
            state.socket.emit('system message', { text: 'Nota de voz enviada.', type: 'highlight' });
        } else {
            state.socket.emit('system message', { text: 'No hay audio grabado o no hay chat activo.', type: 'error' });
        }
    });
    dom.audioCancelButton.addEventListener('click', () => {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
        }
        resetAudioRecorderUI();
        state.socket.emit('system message', { text: 'Grabación de audio cancelada.', type: 'warning' });
    });

    dom.cancelReplyButton.addEventListener('click', hideReplyContextBar);
}