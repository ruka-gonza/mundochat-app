import state from '../state.js';
import * as dom from '../domElements.js';
import { createMessageElement } from './renderer.js';
import { renderUserList } from './userInteractions.js';
import { addPrivateChat, updateConversationList } from './conversations.js';
import { updateUnreadCounts } from '../socket.js';
import { fetchWithCredentials } from './modals.js'; // Importamos la función fetch

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

// =========================================================================
// ===             NUEVA LÓGICA DE SUBIDA DE ARCHIVOS (FETCH)            ===
// =========================================================================
export async function handleFileUpload(file) {
    if (!file || !state.currentChatContext.with || state.currentChatContext.type === 'none') {
        alert('Por favor, selecciona una sala o chat privado para enviar el archivo.');
        return;
    }
    if (file.size > 15 * 1024 * 1024) { // Límite de 15MB
        alert('El archivo es demasiado grande (máx 15MB).');
        return;
    }

    // Muestra un indicador visual de que el archivo se está subiendo
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
            const result = await fetchWithCredentials('/api/upload/chat-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileBase64,
                    contextType: state.currentChatContext.type,
                    contextWith: state.currentChatContext.with
                })
            });
            // La subida fue exitosa, el servidor emitirá el mensaje por Socket.IO
            console.log(result.message);
        } catch (error) {
            console.error('Error al subir archivo:', error);
            alert(`Error al subir archivo: ${error.message}`);
        } finally {
            // Elimina el indicador de "Subiendo..."
            if(indicator) indicator.remove();
        }
    };
    reader.onerror = () => {
        alert('No se pudo leer el archivo seleccionado.');
        if(indicator) indicator.remove();
    };
};
// =========================================================================
// ===                       FIN DE LA NUEVA LÓGICA                      ===
// =========================================================================


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
    let recordingStartTime;
    let recordingInterval;

    function resetAudioRecorderUI() {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
        }
        if (state.audioStream) {
            state.audioStream.getTracks().forEach(track => track.stop());
        }
        clearInterval(recordingInterval);
        
        dom.form.classList.remove('is-recording');
        const recordingControls = document.getElementById('audio-recording-controls');
        if (recordingControls) recordingControls.classList.add('hidden');

        state.audioChunks = [];
        state.audioBlob = null;
        state.mediaRecorder = null;
        state.audioStream = null;
    }

    async function startRecording() {
        if (!state.currentChatContext.with || state.currentChatContext.type === 'none') {
            alert('Selecciona una sala o chat privado para enviar notas de voz.');
            return;
        }
        try {
            state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const options = { mimeType: 'audio/webm; codecs=opus' };
            state.mediaRecorder = new MediaRecorder(state.audioStream, options);
            state.audioChunks = [];
            state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) state.audioChunks.push(event.data);
            };
            state.mediaRecorder.onstop = () => {
                state.audioBlob = new Blob(state.audioChunks, { type: options.mimeType });
                const sendBtn = document.getElementById('send-audio-button');
                const stopBtn = document.getElementById('stop-recording-button');
                if(sendBtn) sendBtn.classList.remove('hidden');
                if(stopBtn) stopBtn.classList.add('hidden');
            };
            state.mediaRecorder.start();
            recordingStartTime = Date.now();
            
            dom.form.classList.add('is-recording');
            
            const recordingControls = document.getElementById('audio-recording-controls');
            const stopBtn = document.getElementById('stop-recording-button');
            const sendBtn = document.getElementById('send-audio-button');
            const timer = document.getElementById('recording-timer');
            if(recordingControls) recordingControls.classList.remove('hidden');
            if(stopBtn) stopBtn.classList.remove('hidden');
            if(sendBtn) sendBtn.classList.add('hidden');
            if(timer) timer.textContent = '00:00';
            recordingInterval = setInterval(() => {
                const timer = document.getElementById('recording-timer');
                if (!timer) return;
                const elapsed = Date.now() - recordingStartTime;
                const seconds = String(Math.floor(elapsed / 1000) % 60).padStart(2, '0');
                const minutes = String(Math.floor(elapsed / (1000 * 60))).padStart(2, '0');
                timer.textContent = `${minutes}:${seconds}`;
            }, 1000);
        } catch (err) {
            console.error('Error al acceder al micrófono:', err);
            alert('No se pudo acceder al micrófono. Asegúrate de dar permiso.');
            resetAudioRecorderUI();
        }
    }

    function stopRecording() {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
            clearInterval(recordingInterval);
        }
    }

    const recordButton = document.getElementById('record-audio-button');
    const stopRecordingButton = document.getElementById('stop-recording-button');
    const cancelRecordingButton = document.getElementById('cancel-recording-button');
    const sendAudioButton = document.getElementById('send-audio-button');

    if(recordButton) recordButton.addEventListener('click', startRecording);
    if(stopRecordingButton) stopRecordingButton.addEventListener('click', stopRecording);
    if(cancelRecordingButton) cancelRecordingButton.addEventListener('click', resetAudioRecorderUI);
    if(sendAudioButton) sendAudioButton.addEventListener('click', () => {
        if (state.audioBlob) {
            const fileName = `audio-${Date.now()}.webm`;
            handleFileUpload(new File([state.audioBlob], fileName, { type: state.audioBlob.type }));
            resetAudioRecorderUI();
        }
    });

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
            autocompleteNick(state.suggestionState.list[0].nick);
        }
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