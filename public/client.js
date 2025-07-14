// client.js (CORREGIDO: Eliminada declaración duplicada de userActionPopup)

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- ELEMENTOS DEL DOM ---
    const welcomeContainer = document.getElementById('welcome-container');
    const chatContainer = document.getElementById('chat-container');
    const roomList = document.getElementById('room-list');
    const privateChatList = document.getElementById('private-chat-list');
    const mainChatArea = document.getElementById('main-chat-area');
    const privateChatView = document.getElementById('private-chat-view');
    const guestNickInput = document.getElementById('guest-nick-input');
    const guestRoomSelect = document.getElementById('guest-room-select');
    const guestJoinButton = document.getElementById('guest-join-button');
    const loginNickInput = document.getElementById('login-nick-input');
    const loginPasswordInput = document.getElementById('login-password-input');
    const loginRoomSelect = document.getElementById('login-room-select');
    const loginButton = document.getElementById('login-button');
    const registerNickInput = document.getElementById('register-nick-input');
    const registerPasswordInput = document.getElementById('register-password-input');
    const registerPasswordConfirm = document.getElementById('register-password-confirm');
    const registerButton = document.getElementById('register-button');
    const authError = document.getElementById('auth-error');
    const authSuccess = document.getElementById('auth-success');
    const privateChatWithUser = document.getElementById('private-chat-with-user');
    const privateChatWindow = document.getElementById('private-chat-window');
    const roomNameHeader = document.getElementById('room-name-header');
    const messagesContainer = document.getElementById('messages');
    const form = document.getElementById('form');
    const input = document.getElementById('input');
    const userList = document.getElementById('user-list');
    const userCount = document.getElementById('user-count');
    const userSearchInput = document.getElementById('user-search-input');
    const commandSuggestions = document.getElementById('command-suggestions');
    const emojiButton = document.getElementById('emoji-button');
    const emojiPicker = document.getElementById('emoji-picker');
    const imageUpload = document.getElementById('image-upload');
    // const audioUpload = document.getElementById('audio-upload'); // Ya no es un input, se usará para el botón de micro, se mantiene como referencia
    const roomHeaderContainer = document.getElementById('room-header-container');
    const roomSwitcher = document.getElementById('room-switcher');
    const roomSwitcherList = document.getElementById('room-switcher-list');
    const typingIndicator = document.getElementById('typing-indicator');
    const avatarHoverPopup = document.getElementById('avatar-hover-popup');
    const actionButtonsContainer = document.getElementById('action-buttons-container');
    const profileModal = document.getElementById('profile-modal');
    const closeProfileModalButton = profileModal.querySelector('.modal-close-button');
    const profileAvatarPreview = document.getElementById('profile-avatar-preview');
    const profileNickSpan = document.getElementById('profile-nick');
    const avatarFileInput = document.getElementById('avatar-file-input');
    const saveProfileButton = document.getElementById('save-profile-button');
    const adminPanelButton = document.getElementById('admin-panel-button');
    const userActionPopup = document.getElementById('user-action-popup'); // Esta es la única y correcta declaración

    // Elementos de Grabación de Voz (NUEVOS)
    const recordAudioButton = document.getElementById('record-audio-button');
    const audioRecordingControls = document.getElementById('audio-recording-controls');
    const recordingTimer = document.getElementById('recording-timer');
    const stopRecordingButton = document.getElementById('stop-recording-button');
    const sendAudioButton = document.getElementById('send-audio-button');
    const cancelRecordingButton = document.getElementById('cancel-recording-button');
    
    // --- ESTADO DEL CLIENTE ---
    let myNick = '';
    let myUserData = {};
    let currentChatContext = { type: 'none', with: null };
    let privateMessageHistories = {};
    let publicMessageHistories = {};
    let joinedRooms = new Set();
    let activePrivateChats = new Set();
    let usersWithUnreadMessages = new Set();
    let disconnectedPrivateChats = new Set();
    let currentRoomUsers = [];
    let allUsersData = {}; 
    let selectedAvatarFile = null;
    let ignoredNicks = new Set();
    const sonidoMencion = new Audio('notification.mp3');
    sonidoMencion.volume = 0.7;
    let isFirstLogin = true;
    let typingTimer;
    let isTyping = false;
    const TYPING_TIMER_LENGTH = 1500;
    let usersTyping = new Set();
    let suggestionState = { list: [], index: -1, originalWord: "" };

    // Estado de Grabación de Voz (NUEVO)
    let mediaRecorder;
    let audioChunks = [];
    let audioBlob;
    let recordingStartTime;
    let recordingInterval;

    // --- BLOQUE DE FUNCIONES DE AYUDA ---
    function handleTypingIndicator() { if (currentChatContext.type === 'none') return; if (!isTyping) { isTyping = true; socket.emit('typing', { context: currentChatContext, to: currentChatContext.with }); } clearTimeout(typingTimer); typingTimer = setTimeout(() => { isTyping = false; socket.emit('stop typing', { context: currentChatContext, to: currentChatContext.with }); }, TYPING_TIMER_LENGTH); }
    function updateTypingIndicator() { if (usersTyping.size === 0) { typingIndicator.textContent = ''; typingIndicator.classList.add('hidden'); } else { const users = Array.from(usersTyping); let text; if (users.length === 1) { text = `${users[0]} está escribiendo...`; } else if (users.length === 2) { text = `${users[0]} y ${users[1]} están escribiendo...`; } else { text = `Varios usuarios están escribiendo...`; } typingIndicator.textContent = text; typingIndicator.classList.remove('hidden'); } }
    function handleNickSuggestions() { const text = input.value; const cursorPosition = input.selectionStart; const textBeforeCursor = text.substring(0, cursorPosition); const words = textBeforeCursor.split(/[\s\n]/); const currentWord = words.pop(); suggestionState.index = -1; if (currentWord.length === 0) { suggestionState.list = []; commandSuggestions.classList.add('hidden'); return; } suggestionState.list = currentRoomUsers.filter(user => user.nick.toLowerCase().startsWith(currentWord.toLowerCase()) && user.nick !== myNick); suggestionState.originalWord = currentWord; if (suggestionState.list.length > 0) { renderSuggestions(); } else { commandSuggestions.classList.add('hidden'); } }
    function renderSuggestions() { if (suggestionState.list.length === 0) { commandSuggestions.classList.add('hidden'); return; } commandSuggestions.innerHTML = ''; const ul = document.createElement('ul'); suggestionState.list.forEach((user, i) => { const li = document.createElement('li'); li.textContent = user.nick; if (i === suggestionState.index) { li.classList.add('active-suggestion'); } li.addEventListener('mousedown', (e) => { e.preventDefault(); autocompleteNick(user.nick); }); ul.appendChild(li); }); commandSuggestions.appendChild(ul); commandSuggestions.classList.remove('hidden'); }
    function autocompleteNick(nick) { const text = input.value; const textToReplace = suggestionState.originalWord; const lastIndex = text.toLowerCase().lastIndexOf(textToReplace.toLowerCase()); if (lastIndex === -1) return; const before = text.substring(0, lastIndex); const after = text.substring(lastIndex + textToReplace.length); const newText = before + nick + ' ' + after.trimStart(); input.value = newText; commandSuggestions.classList.add('hidden'); suggestionState.list = []; suggestionState.index = -1; const newCursorPosition = (before + nick).length + 1; input.focus(); input.setSelectionRange(newCursorPosition, newCursorPosition); }
    
    // --- MANEJADORES DE ENTRADA DEL USUARIO ---
    input.addEventListener('input', () => { handleTypingIndicator(); handleNickSuggestions(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { commandSuggestions.classList.add('hidden'); suggestionState.list = []; } if (e.key === 'Tab' && suggestionState.list.length > 0) { e.preventDefault(); suggestionState.index = (suggestionState.index + 1) % suggestionState.list.length; const selectedUser = suggestionState.list[suggestionState.index]; const text = input.value; const textToReplace = suggestionState.originalWord; const lastIndex = text.toLowerCase().lastIndexOf(textToReplace.toLowerCase()); if (lastIndex !== -1) { const before = text.substring(0, lastIndex); input.value = before + selectedUser.nick; suggestionState.originalWord = selectedUser.nick; } renderSuggestions(); } });

    // --- LÓGICA DEL POPUP DE AVATAR (HOVER) ---
    chatContainer.addEventListener('mouseover', (e) => { const avatar = e.target.closest('.message-avatar, .user-list-avatar'); if (avatar) { const avatarSrc = avatar.src; if (!avatarSrc || avatarSrc.endsWith('default-avatar.png')) return; const popupImg = avatarHoverPopup.querySelector('img'); popupImg.src = avatarSrc; const rect = avatar.getBoundingClientRect(); const popupWidth = 210; let left = rect.right + 10; if (left + popupWidth > window.innerWidth) { left = rect.left - popupWidth - 10; } avatarHoverPopup.style.left = `${left}px`; avatarHoverPopup.style.top = `${rect.top}px`; avatarHoverPopup.classList.remove('hidden'); setTimeout(() => avatarHoverPopup.classList.add('visible'), 10); } });
    chatContainer.addEventListener('mouseout', (e) => { const avatar = e.target.closest('.message-avatar, .user-list-avatar'); if (avatar) { avatarHoverPopup.classList.remove('visible'); setTimeout(() => avatarHoverPopup.classList.add('hidden'), 200); } });
    
    // --- LÓGICA DE FUNCIONALIDADES DEL CHAT ---
    function showNotification(title, body, requiresInteraction = false) { if (document.hidden) { sonidoMencion.play().catch(e => console.error("Error al reproducir sonido:", e)); } if (!("Notification" in window)) return; const doNotify = () => { new Notification(title, { body, icon: '/image/favicon.png', requireInteraction: requiresInteraction, }); }; if (document.hidden) { if (Notification.permission === "granted") { doNotify(); } else if (Notification.permission !== "denied") { Notification.requestPermission().then((permission) => { if (permission === "granted") doNotify(); }); } } }
    
    function createMessageElement(msg, isPrivate = false) {
        if (!msg.nick && !msg.from) {
            const item = document.createElement('li');
            item.className = `system-message ${msg.type || ''}`;
            item.textContent = msg.text;
            return item;
        }

        const senderNick = isPrivate ? msg.from : msg.nick;
        if (ignoredNicks.has(senderNick.toLowerCase())) {
            return document.createDocumentFragment();
        }

        const item = document.createElement('li'); item.id = `message-${msg.id}`; const isSent = msg.from === myNick || msg.nick === myNick; const senderData = isSent ? myUserData : (allUsersData[senderNick.toLowerCase()] || {}); const avatarUrl = senderData.avatar_url || 'image/default-avatar.png'; const avatarImg = document.createElement('img'); avatarImg.src = avatarUrl; avatarImg.className = 'message-avatar'; item.appendChild(avatarImg); const mainContentWrapper = document.createElement('div'); mainContentWrapper.className = 'message-main-wrapper'; const contentDiv = document.createElement('div'); contentDiv.className = 'message-content'; const icons = getUserIcons(senderData); const headerDiv = document.createElement('div'); headerDiv.className = 'message-header'; const displayName = isPrivate ? (isSent ? 'Yo' : msg.from) : msg.nick; headerDiv.innerHTML = `${icons} <strong>${displayName}</strong>`; contentDiv.appendChild(headerDiv); 
        
        // --- MODIFICACIÓN: MANEJO DE ARCHIVOS DE AUDIO ---
        if (msg.file && msg.type.startsWith('audio/')) {
            const audioWrapper = document.createElement('div');
            audioWrapper.className = 'audio-message-wrapper';

            const audioPlayer = document.createElement('audio');
            audioPlayer.src = msg.file; // La URL directa del S3
            audioPlayer.controls = true;
            audioPlayer.preload = 'none'; // Carga solo metadata, no todo el archivo

            audioWrapper.appendChild(audioPlayer);
            contentDiv.appendChild(audioWrapper);
        } else if (msg.file && msg.type.startsWith('image/')) {
            const link = document.createElement('a');
            link.href = msg.file; // La URL directa del S3
            link.target = '_blank';
            const img = document.createElement('img');
            img.src = msg.file;
            img.classList.add('media-message', 'image-thumbnail');
            link.appendChild(img);
            contentDiv.appendChild(link);
        } else {
            const textSpan = document.createElement('span');
            textSpan.className = 'message-text';
            textSpan.textContent = msg.text;
            contentDiv.appendChild(textSpan);
        } 
        // --- FIN MODIFICACIÓN ---

        if (msg.editedAt) { const editedSpan = document.createElement('span'); editedSpan.className = 'edited-indicator'; editedSpan.textContent = ' (editado)'; contentDiv.appendChild(editedSpan); } mainContentWrapper.appendChild(contentDiv); const iAmModerator = myUserData.role === 'owner' || myUserData.role === 'admin'; if (!isPrivate) { const actionsDiv = document.createElement('div'); actionsDiv.className = 'message-actions'; let shouldShowButtons = false; if (isSent) { const editBtn = document.createElement('button'); editBtn.textContent = '✏️'; editBtn.className = 'action-btn edit-btn'; editBtn.dataset.messageId = msg.id; actionsDiv.appendChild(editBtn); shouldShowButtons = true; } if (iAmModerator || isSent) { const deleteBtn = document.createElement('button'); deleteBtn.textContent = '🗑️'; deleteBtn.className = 'action-btn delete-btn'; deleteBtn.dataset.messageId = msg.id; if (iAmModerator && !isSent) { deleteBtn.dataset.isModAction = 'true'; } actionsDiv.appendChild(deleteBtn); shouldShowButtons = true; } if (shouldShowButtons) { mainContentWrapper.appendChild(actionsDiv); } } item.appendChild(mainContentWrapper); if (isPrivate) { item.classList.add(isSent ? 'sent' : 'received'); } 
        
        if (!isPrivate && msg.isMention) {
            item.classList.add('mencion');
        }
        
        return item;
    }

    function getUserIcons(user) { if (!user) return ''; const roleIcons = { owner: '👑', admin: '🛡️', mod: '🔧' }; const vipIcon = user.isVIP ? '⭐' : ''; const roleIcon = (user.role && roleIcons[user.role]) || ''; return vipIcon || roleIcon ? `<span class="user-icon">${vipIcon}${roleIcon}</span>` : ''; }
    
    // --- Lógica de Manejo de Archivos (modificada para enviar audio grabado) ---
    // Esta función ahora será para subir imágenes desde el input file
    const handleImageUpload = (file) => { 
        if (!file || !currentChatContext.with || !file.type.startsWith('image/')) {
            alert('Por favor, selecciona un archivo de imagen válido.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) { // Límite de 10MB para archivos
            alert('El archivo de imagen es demasiado grande (máx 10MB).');
            return;
        }

        // Ya no se usa el método de chunks de Socket.IO, ahora usaremos fetch para subir.
        // Simulamos el envío para que el UI no se rompa, pero el backend lo gestiona vía HTTP POST
        // La URL de carga ahora será '/api/user/upload-message-file'
        const formData = new FormData();
        formData.append('file', file, file.name);
        formData.append('nick', myNick); // Necesario para el nombre del archivo en S3

        fetch('/api/user/upload-message-file', {
            method: 'POST',
            body: formData,
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const messagePayload = {
                    file: result.fileUrl,
                    type: result.fileType,
                    nick: myNick,
                    from: myNick,
                    roomName: currentChatContext.type === 'room' ? currentChatContext.with : undefined,
                    to: currentChatContext.type === 'private' ? currentChatContext.with : undefined,
                    role: myUserData.role,
                    isVIP: myUserData.isVIP,
                    id: Date.now()
                };

                // Emitir el mensaje con la URL del archivo
                if (currentChatContext.type === 'room') {
                    socket.emit('chat message', messagePayload);
                } else if (currentChatContext.type === 'private') {
                    socket.emit('private message', messagePayload);
                }
            } else {
                alert(`Error al subir la imagen: ${result.error || 'Desconocido'}`);
            }
        })
        .catch(error => {
            console.error('Error al subir imagen:', error);
            alert('Hubo un error al conectar con el servidor para subir la imagen.');
        });
    };

    // Función para enviar audio grabado (NUEVA)
    const sendRecordedAudio = async (audioBlobToSend) => {
        if (!audioBlobToSend || !currentChatContext.with || !audioBlobToSend.type.startsWith('audio/')) {
            alert('No hay grabación de audio para enviar.');
            return;
        }
        if (audioBlobToSend.size > 10 * 1024 * 1024) { // Límite de 10MB para audio
            alert('La nota de voz es demasiado grande (máx 10MB).');
            return;
        }

        const formData = new FormData();
        formData.append('file', audioBlobToSend, `audio-${Date.now()}.webm`);
        formData.append('nick', myNick); // Necesario para el nombre del archivo en S3

        try {
            const response = await fetch('/api/user/upload-message-file', {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();

            if (response.ok && result.success) {
                const messagePayload = {
                    file: result.fileUrl,
                    type: result.fileType,
                    nick: myNick,
                    from: myNick,
                    roomName: currentChatContext.type === 'room' ? currentChatContext.with : undefined,
                    to: currentChatContext.type === 'private' ? currentChatContext.with : undefined,
                    role: myUserData.role,
                    isVIP: myUserData.isVIP,
                    id: Date.now()
                };

                if (currentChatContext.type === 'room') {
                    socket.emit('chat message', messagePayload);
                } else if (currentChatContext.type === 'private') {
                    socket.emit('private message', messagePayload);
                }
            } else {
                alert(`Error al subir el audio: ${result.error || 'Desconocido'}`);
            }
        } catch (error) {
            console.error('Error al subir audio:', error);
            alert('Hubo un error al conectar con el servidor para subir el audio.');
        } finally {
            resetAudioRecording();
        }
    };
    // --- FIN Lógica de Manejo de Archivos ---

    function sendMessage() { const text = input.value.trim(); if (!text) return; commandSuggestions.classList.add('hidden'); suggestionState.list = []; if (isTyping && currentChatContext.type !== 'none') { clearTimeout(typingTimer); isTyping = false; socket.emit('stop typing', { context: currentChatContext, to: currentChatContext.with }); } const { type, with: contextWith } = currentChatContext; if (type === 'room') { socket.emit('chat message', { text, roomName: contextWith }); } else if (type === 'private') { socket.emit('private message', { to: contextWith, text: text }); } input.value = ''; emojiPicker.classList.add('hidden'); }
    function appendMessageToView(msg, isPrivate) { let listElement; if (isPrivate) { listElement = privateChatWindow.querySelector('ul'); if (!listElement) { listElement = document.createElement('ul'); privateChatWindow.innerHTML = ''; privateChatWindow.appendChild(listElement); } } else { listElement = messagesContainer; } const isScrolledToBottom = listElement.scrollHeight - listElement.clientHeight <= listElement.scrollTop + 50; const isMyOwnMessage = msg.from === myNick || msg.nick === myNick; listElement.appendChild(createMessageElement(msg, isPrivate)); if (isMyOwnMessage || isScrolledToBottom) { listElement.scrollTop = listElement.scrollHeight; } }
    
    function addPrivateChat(nick) {
        if (nick === myNick || activePrivateChats.has(nick)) return;
        activePrivateChats.add(nick);
        disconnectedPrivateChats.delete(nick);
        updateConversationList();
    }
    
    function updateConversationList() {
        roomList.innerHTML = '';
        privateChatList.innerHTML = '';
        const createConversationItem = (id, isRoom, isDisconnected = false) => {
            const item = document.createElement('li');
            item.dataset.convId = id;
            item.onclick = () => switchToChat(id, isRoom ? 'room' : 'private');
            
            const icon = isRoom ? (id === '#Staff-Logs' ? '🛡️' : '🌐') : '👤';
            item.innerHTML = `${icon} ${id}`;
            
            const closeBtn = document.createElement('span');
            closeBtn.className = 'close-conversation';
            closeBtn.innerHTML = '×';
            
            if (id === '#Staff-Logs') {
                closeBtn.style.display = 'none';
            } else {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (isRoom) {
                        socket.emit('leave room', { roomName: id });
                    } else {
                        activePrivateChats.delete(id);
                        disconnectedPrivateChats.delete(id);
                        delete privateMessageHistories[id];
                        if (currentChatContext.with === id) {
                            const firstRoom = Array.from(joinedRooms).find(r => r !== '#Staff-Logs') || Array.from(joinedRooms)[0];
                            if (firstRoom) {
                                switchToChat(firstRoom, 'room');
                            } else {
                                mainChatArea.classList.add('hidden');
                                privateChatView.classList.add('hidden');
                            }
                        }
                        updateConversationList();
                    }
                };
            }
            
            item.appendChild(closeBtn);
            if (currentChatContext.with === id) item.classList.add('active');
            if (usersWithUnreadMessages.has(id)) {
                const marker = document.createElement('span');
                marker.className = 'unread-marker';
                item.appendChild(marker);
            }
            
            if (isDisconnected) {
                item.classList.add('disconnected');
                const disconnectMarker = document.createElement('span');
                disconnectMarker.className = 'disconnect-marker';
                item.appendChild(disconnectMarker);
            }
            
            return item;
        };
        
        const sortedRooms = Array.from(joinedRooms).sort();
        sortedRooms.forEach(roomId => roomList.appendChild(createConversationItem(roomId, true, false)));
        activePrivateChats.forEach(userId => {
            const isDisconnected = disconnectedPrivateChats.has(userId);
            privateChatList.appendChild(createConversationItem(userId, false, isDisconnected));
        });
    }

    function switchToChat(contextId, contextType) { if (contextType === 'private') { addPrivateChat(contextId); } usersTyping.clear(); updateTypingIndicator(); currentChatContext = { type: contextType, with: contextId }; usersWithUnreadMessages.delete(contextId); updateConversationList(); userSearchInput.value = ''; let history = []; let view, container; if (contextType === 'room') { if (!publicMessageHistories[contextId]) { publicMessageHistories[contextId] = []; } history = publicMessageHistories[contextId]; view = mainChatArea; container = messagesContainer; roomNameHeader.textContent = `Sala: ${contextId}`; privateChatView.classList.add('hidden'); view.classList.remove('hidden'); socket.emit('request user list', { roomName: contextId }); container.innerHTML = ''; history.forEach(msg => container.appendChild(createMessageElement(msg, false))); container.scrollTop = container.scrollHeight; } else { view = privateChatView; container = privateChatWindow; privateChatWithUser.textContent = `Chat con ${contextId}`; mainChatArea.classList.add('hidden'); view.classList.remove('hidden'); currentRoomUsers = []; renderUserList(); container.innerHTML = ''; if (!privateMessageHistories[contextId]) { socket.emit('request private history', { withNick: contextId }); } else { const ul = document.createElement('ul'); privateMessageHistories[contextId].forEach(msg => { ul.appendChild(createMessageElement(msg, true)); }); container.appendChild(ul); ul.scrollTop = ul.scrollHeight; } } input.focus(); }
    function renderUserList() {
        const searchTerm = userSearchInput.value.toLowerCase().trim();
        const filteredUsers = currentRoomUsers.filter(user => user.nick.toLowerCase().includes(searchTerm));
        userList.innerHTML = '';
        userCount.textContent = filteredUsers.length;

        filteredUsers.forEach(user => {
            const userData = allUsersData[user.nick.toLowerCase()] || user;
            const avatarUrl = userData.avatar_url || 'image/default-avatar.png';
            const item = document.createElement('li');
            item.className = 'user-list-item';
            
            if (ignoredNicks.has(user.nick.toLowerCase())) {
                item.classList.add('ignored');
            }

            const avatarImg = document.createElement('img');
            avatarImg.src = avatarUrl;
            avatarImg.className = 'user-list-avatar';
            item.appendChild(avatarImg);

            const nickSpan = document.createElement('span');
            nickSpan.innerHTML = `${getUserIcons(userData)} ${user.nick}`;
            item.appendChild(nickSpan);

            if (user.nick === myNick) {
                item.classList.add('self');
            } else {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showUserActionPopup(e.currentTarget, user);
                });
            }
            userList.appendChild(item);
        });
    }
    function showUserActionPopup(targetElement, user) {
        document.getElementById('popup-user-nick').textContent = user.nick;
        document.getElementById('popup-user-id').textContent = `ID: ${user.id}`;

        const pmButton = document.getElementById('popup-pm-button');
        const ignoreButton = document.getElementById('popup-ignore-button');
        const reportButton = document.getElementById('popup-report-button');

        pmButton.onclick = () => {
            socket.emit('request private chat', { targetNick: user.nick });
            userActionPopup.classList.add('hidden');
        };

        const isIgnored = ignoredNicks.has(user.nick.toLowerCase());
        ignoreButton.textContent = isIgnored ? 'Dejar de Ignorar' : 'Ignorar';
        ignoreButton.onclick = () => {
            const nickLower = user.nick.toLowerCase();
            if (ignoredNicks.has(nickLower)) {
                ignoredNicks.delete(nickLower);
            } else {
                ignoredNicks.add(nickLower);
            }
            renderUserList();
            userActionPopup.classList.add('hidden');
        };

        reportButton.onclick = () => {
            const reason = prompt(`Por favor, describe brevemente por qué denuncias a ${user.nick}:`, "Acoso/Spam");
            if (reason && reason.trim() !== '') {
                socket.emit('report user', { targetNick: user.nick, reason: reason.trim() });
            }
            userActionPopup.classList.add('hidden');
        };

        const rect = targetElement.getBoundingClientRect();
        userActionPopup.style.top = `${rect.bottom}px`;
        userActionPopup.style.left = `${rect.left}px`;
        userActionPopup.classList.remove('hidden');
    }
    
    // --- MANEJADORES DE EVENTOS DE SOCKET.IO ---
    socket.on('set admin cookie', (data) => { document.cookie = `adminUser=${JSON.stringify(data)}; path=/; max-age=86400`; });
    socket.on('update user list', ({ roomName, users }) => { if (currentChatContext.type === 'room' && currentChatContext.with === roomName) { currentRoomUsers = users; users.forEach(user => { const lowerNick = user.nick.toLowerCase(); if (!allUsersData[lowerNick]) { allUsersData[lowerNick] = {}; } allUsersData[lowerNick] = { ...allUsersData[lowerNick], ...user }; }); renderUserList(); if (!commandSuggestions.classList.contains('hidden')) { handleNickSuggestions(); } } });
    socket.on('user_data_updated', (data) => { const lowerNick = data.nick.toLowerCase(); if (allUsersData[lowerNick]) { Object.assign(allUsersData[lowerNick], data); } if (myNick.toLowerCase() === lowerNick) { Object.assign(myUserData, data); } renderUserList(); });
    socket.on('open private chat', ({ with: partnerNick }) => { if (partnerNick === myNick) return; switchToChat(partnerNick, 'private'); });
    
    socket.on('private chat requested', ({ from: partnerNick }) => {
        if (partnerNick === myNick) return;
        addPrivateChat(partnerNick);
    });
    
    function handlePrivateMessageReception(msg) { 
        const partnerNick = msg.from === myNick ? msg.to : msg.from; 
        if (!privateMessageHistories[partnerNick]) { privateMessageHistories[partnerNick] = []; } 
        privateMessageHistories[partnerNick].push(msg); 
        if (currentChatContext.type === 'private' && currentChatContext.with === partnerNick) { appendMessageToView(msg, true); } else { if (msg.from !== myNick) { addPrivateChat(partnerNick); usersWithUnreadMessages.add(partnerNick); updateConversationList(); const notificationBody = msg.file ? (msg.type.startsWith('image/') ? `Te ha enviado una imagen.` : `Te ha enviado un audio.`) : msg.text; showNotification(`Nuevo mensaje de ${msg.from}`, notificationBody, true); } } }
    socket.on('private message', handlePrivateMessageReception);
    socket.on('private file message', handlePrivateMessageReception);
    
    function handlePublicMessage(msg) {
        if (!publicMessageHistories[msg.roomName]) {
            publicMessageHistories[msg.roomName] = [];
        }

        const isMention = myNick && msg.nick && msg.text && msg.nick !== myNick && msg.text.toLowerCase().includes(myNick.toLowerCase());
        if (isMention) {
            msg.isMention = true;
            showNotification(`Nueva mención de ${msg.nick}`, msg.text);
        }
        
        publicMessageHistories[msg.roomName].push(msg);

        if (currentChatContext.type === 'room' && currentChatContext.with === msg.roomName) {
            appendMessageToView(msg, false);
        } else {
            usersWithUnreadMessages.add(msg.roomName);
            updateConversationList();
        }
    }
    socket.on('chat message', handlePublicMessage);
    socket.on('file message', handlePublicMessage);

    socket.on('system message', (msg) => {
        if (msg.roomName) {
            if (!publicMessageHistories[msg.roomName]) {
                publicMessageHistories[msg.roomName] = [];
            }
            publicMessageHistories[msg.roomName].push(msg);

            if (currentChatContext.type === 'room' && currentChatContext.with === msg.roomName) {
                appendMessageToView(msg, false);
            } else {
                 if (['owner', 'admin', 'mod'].includes(myUserData.role)) {
                    usersWithUnreadMessages.add(msg.roomName);
                    updateConversationList();
                }
            }
        } else {
            let targetList;
            if (currentChatContext.type === 'room') {
                targetList = messagesContainer;
            } else if (currentChatContext.type === 'private') {
                const ul = privateChatWindow.querySelector('ul');
                targetList = ul || privateChatWindow;
            }
            if (targetList) {
                const item = document.createElement('li');
                item.className = `system-message ${msg.type || ''}`;
                item.textContent = msg.text;
                targetList.appendChild(item);
                targetList.scrollTop = targetList.scrollHeight;
            }
        }
    });
    
    socket.on('join_success', ({ user, roomName, joinedRooms: serverJoinedRooms }) => { const isFirstJoinInSession = !myNick; if (isFirstJoinInSession) { myUserData = user; myNick = user.nick; allUsersData[myNick.toLowerCase()] = myUserData; welcomeContainer.classList.add('hidden'); chatContainer.classList.remove('hidden'); actionButtonsContainer.innerHTML = ''; if (myUserData.role && myUserData.role !== 'guest') { const profileButton = document.createElement('button'); profileButton.id = 'profile-button'; profileButton.textContent = 'Mi Perfil'; profileButton.onclick = openProfileModal; actionButtonsContainer.appendChild(profileButton); } if (['owner', 'admin', 'mod'].includes(myUserData.role)) { actionButtonsContainer.appendChild(adminPanelButton); adminPanelButton.classList.remove('hidden'); } } if (isFirstLogin) { const welcomePopup = document.getElementById('welcome-popup-overlay'); if (welcomePopup) welcomePopup.classList.remove('hidden'); isFirstLogin = false; } joinedRooms = new Set(serverJoinedRooms); updateConversationList(); switchToChat(roomName, 'room'); roomSwitcher.classList.remove('show'); });
    socket.on('leave_success', ({ roomName, joinedRooms: serverJoinedRooms }) => { joinedRooms = new Set(serverJoinedRooms); delete publicMessageHistories[roomName]; if (currentChatContext.with === roomName) { const firstRoom = Array.from(joinedRooms).find(r => r !== '#Staff-Logs') || (joinedRooms.size > 0 ? joinedRooms.values().next().value : null); if (firstRoom) { switchToChat(firstRoom, 'room'); } else { currentChatContext = { type: 'none', with: null }; mainChatArea.classList.add('hidden'); privateChatView.classList.add('hidden'); } } updateConversationList(); });
    
    socket.on('update room data', (roomListArray) => {
        guestRoomSelect.innerHTML = '';
        loginRoomSelect.innerHTML = '';
        roomSwitcherList.innerHTML = '';

        roomListArray.forEach(room => {
            if (room.name !== '#Staff-Logs') {
                const option = document.createElement('option');
                option.value = room.name;
                option.textContent = `${room.name} (${room.userCount})`;
                guestRoomSelect.appendChild(option.cloneNode(true));
                loginRoomSelect.appendChild(option);
            }

            if (room.name === '#Staff-Logs' && !joinedRooms.has('#Staff-Logs')) {
                return;
            }
            
            const li = document.createElement('li');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = room.name;
            const countSpan = document.createElement('span');
            countSpan.className = 'user-count';
            countSpan.textContent = room.userCount;
            li.appendChild(nameSpan);
            li.appendChild(countSpan);

            if (joinedRooms.has(room.name)) {
                li.classList.add('current-room');
            } else {
                li.onclick = () => socket.emit('join room', { roomName: room.name });
            }
            roomSwitcherList.appendChild(li);
        });
    });

    socket.on('typing', ({ nick, context }) => { if (context.type === currentChatContext.type && context.with === currentChatContext.with) { usersTyping.add(nick); updateTypingIndicator(); } });
    socket.on('stop typing', ({ nick, context }) => { if (context.type === currentChatContext.type && context.with === currentChatContext.with) { usersTyping.delete(nick); updateTypingIndicator(); } });
    // load history y load private history ya no cargan de DB, pero se mantienen para compatibilidad
    socket.on('load history', ({ roomName, history }) => { publicMessageHistories[roomName] = history; if (currentChatContext.type === 'room' && currentChatContext.with === roomName) { const container = messagesContainer; container.innerHTML = ''; history.forEach(msg => container.appendChild(createMessageElement(msg, false))); container.scrollTop = container.scrollHeight; } });
    socket.on('load private history', ({ withNick, history }) => { privateMessageHistories[withNick] = history; if (currentChatContext.type === 'private' && currentChatContext.with === withNick) { const container = privateChatWindow; container.innerHTML = ''; const ul = document.createElement('ul'); history.forEach(msg => { ul.appendChild(createMessageElement(msg, true)); }); container.appendChild(ul); ul.scrollTop = ul.scrollHeight; } });
    
    socket.on('user_avatar_changed', ({ nick, newAvatarUrl }) => { const lowerNick = nick.toLowerCase(); if (allUsersData[lowerNick]) { allUsersData[lowerNick].avatar_url = newAvatarUrl; } if (myNick.toLowerCase() === lowerNick) { myUserData.avatar_url = newAvatarUrl; } if (currentChatContext.type === 'room') { renderUserList(); } const conversationIsVisible = (currentChatContext.type === 'room') || (currentChatContext.type === 'private'); if (conversationIsVisible) { document.querySelectorAll('.message-avatar').forEach(img => { const messageLi = img.closest('li'); if (!messageLi) return; const strongTag = messageLi.querySelector('.message-header strong'); if (!strongTag) return; const messageNick = strongTag.textContent.trim(); if (messageNick.toLowerCase() === lowerNick || (messageNick === "Yo" && myNick.toLowerCase() === lowerNick)) { img.src = newAvatarUrl; } }); } });
    
    // --- NUEVO LISTENER PARA DESCONEXIONES ---
    socket.on('user disconnected', ({ nick }) => {
        if (activePrivateChats.has(nick)) {
            disconnectedPrivateChats.add(nick);
            updateConversationList();

            if (currentChatContext.type === 'private' && currentChatContext.with === nick) {
                const item = document.createElement('li');
                item.className = 'system-message';
                item.textContent = `${nick} se ha desconectado.`;
                const chatWindowUL = privateChatWindow.querySelector('ul');
                if (chatWindowUL) {
                    chatWindowUL.appendChild(item);
                }
            }
        }
    });
    
    // --- MANEJADORES DE UI GENERAL ---
    const welcomePopup = document.getElementById('welcome-popup-overlay'); const closeWelcomePopupButton = document.getElementById('close-welcome-popup'); const confirmWelcomePopupButton = document.getElementById('confirm-welcome-popup'); function hideWelcomePopup() { if(welcomePopup) welcomePopup.classList.add('hidden'); } if (closeWelcomePopupButton) closeWelcomePopupButton.addEventListener('click', hideWelcomePopup); if (confirmWelcomePopupButton) confirmWelcomePopupButton.addEventListener('click', hideWelcomePopup); if (welcomePopup) welcomePopup.addEventListener('click', (e) => { if (e.target === welcomePopup) hideWelcomePopup(); });
    const authTabs = document.querySelectorAll('.auth-tab'); const authForms = document.querySelectorAll('.auth-form'); authTabs.forEach(tab => { tab.addEventListener('click', () => { const targetFormId = tab.dataset.form; authTabs.forEach(t => t.classList.remove('active')); authForms.forEach(f => f.classList.add('hidden')); tab.classList.add('active'); document.getElementById(targetFormId).classList.remove('hidden'); authError.classList.add('hidden'); authSuccess.classList.add('hidden'); }); });
    guestJoinButton.addEventListener('click', () => { const nick = guestNickInput.value.trim(); const roomName = guestRoomSelect.value; if (nick && roomName) socket.emit('guest_join', { nick, roomName }); });
    loginButton.addEventListener('click', () => { const nick = loginNickInput.value.trim(); const password = loginPasswordInput.value; const roomName = loginRoomSelect.value; if (nick && password && roomName) socket.emit('login', { nick, password, roomName }); });
    registerButton.addEventListener('click', () => { const nick = registerNickInput.value.trim(); const password = registerPasswordInput.value; const confirm = registerPasswordConfirm.value; if (password !== confirm) { authError.textContent = "Las contraseñas no coinciden."; authError.classList.remove('hidden'); return; } if (nick && password) socket.emit('register', { nick, password }); });
    
    // Manejador del input de imagen
    imageUpload.addEventListener('change', (e) => { handleImageUpload(e.target.files[0]); e.target.value = ''; });
    // audioUpload ya no es un input, es un botón, no se usa aquí.

    document.querySelectorAll('.group-header').forEach(header => { header.addEventListener('click', () => { header.parentElement.classList.toggle('collapsed'); }); });
    socket.on('auth_error', ({ message }) => { authSuccess.classList.add('hidden'); authError.textContent = message; authError.classList.remove('hidden'); });
    socket.on('register_success', ({ message }) => { authError.classList.add('hidden'); authSuccess.textContent = message; authSuccess.classList.remove('hidden'); document.getElementById('show-login-tab').click(); loginNickInput.value = registerNickInput.value; registerNickInput.value = ''; registerPasswordInput.value = ''; registerPasswordConfirm.value = ''; });
    roomHeaderContainer.addEventListener('click', (e) => { e.stopPropagation(); roomSwitcher.classList.toggle('show'); });
    document.addEventListener('click', (e) => {
        if (roomSwitcher.classList.contains('show')) roomSwitcher.classList.remove('show');
        if (!commandSuggestions.contains(e.target) && e.target !== input) commandSuggestions.classList.add('hidden');
        if (!userActionPopup.contains(e.target) && !e.target.closest('.user-list-item')) {
            userActionPopup.classList.add('hidden');
        }
    });
    const emojis = ['😀', '😂', '❤️', '👍', '🤔', '🎉', '🔥', '💀', '😭', '😡', '🙏', '👋', '😊', '😍', '🥳', '🤯', '😴', '🥺', '😏', '🥶', '😱', '🤢', '🤡', '💯', '✅', '❌', '👉', '👈', '👆', '👇', '👌', '🤝', '🙌', '👀', '🍿', '💸']; emojiPicker.innerHTML = ''; emojis.forEach(emoji => { const span = document.createElement('span'); span.textContent = emoji; span.addEventListener('click', () => { input.value += emoji; input.focus(); }); emojiPicker.appendChild(span); }); emojiButton.addEventListener('click', (e) => { e.stopPropagation(); emojiPicker.classList.toggle('hidden'); }); document.addEventListener('click', (e) => { if (!emojiPicker.contains(e.target) && e.target !== emojiButton) emojiPicker.classList.add('hidden'); }, true);

    // Los manejadores de edición/borrado ahora muestran un mensaje, no intentan DB
    messagesContainer.addEventListener('click', (e) => { const target = e.target; if (target.classList.contains('edit-btn')) { const messageId = target.dataset.messageId; promptForEdit(messageId); } else if (target.classList.contains('delete-btn')) { const messageId = target.dataset.messageId; const isModAction = target.dataset.isModAction === 'true'; const confirmationMessage = isModAction ? '¿Estás seguro de que quieres borrar este mensaje como moderador?' : '¿Estás seguro de que quieres eliminar este mensaje?'; if (confirm(confirmationMessage)) { const eventName = isModAction ? 'delete any message' : 'delete message'; socket.emit(eventName, { messageId, roomName: currentChatContext.with }); } } });
    function promptForEdit(messageId) { socket.emit('system message', {text: "La edición de mensajes no está disponible.", type: "error"}); }
    // No hay necesidad de definir handlers específicos para 'message edited' o 'message deleted' si las funciones del servidor ya envían un system message
    
    // --- LÓGICA DEL PANEL DE MODERACIÓN ---
    const adminModal = document.getElementById('admin-modal');
    const closeModalButton = adminModal.querySelector('.modal-close-button');
    const adminTabs = document.querySelectorAll('.admin-tab');
    const adminPanels = document.querySelectorAll('.admin-panel');
    const bannedUsersList = document.getElementById('banned-users-list');
    const mutedUsersList = document.getElementById('muted-users-list');
    const onlineUsersList = document.getElementById('online-users-list');
    const activityLogsList = document.getElementById('activity-logs-list');
    let activityMonitorInterval;

    async function fetchAndShowBannedUsers() { try { const response = await fetch('/api/admin/banned'); if (!response.ok) throw new Error('No se pudo cargar la lista de baneados.'); const users = await response.json(); bannedUsersList.innerHTML = ''; users.forEach(user => { const row = document.createElement('tr'); row.innerHTML = ` <td>${user.id}</td> <td>${user.nick}</td> <td>${user.ip || 'N/A'}</td> <td>${user.by}</td> <td>${user.reason}</td> <td>${new Date(user.at).toLocaleString()}</td> <td><button class="action-button unban-btn" data-id="${user.id}">Quitar Ban</button></td> `; bannedUsersList.appendChild(row); }); } catch (error) { console.error(error); bannedUsersList.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`; } }
    async function fetchAndShowMutedUsers() { try { const response = await fetch('/api/admin/muted'); if (!response.ok) throw new Error('No se pudo cargar la lista de silenciados.'); const users = await response.json(); mutedUsersList.innerHTML = ''; users.forEach(user => { const row = document.createElement('tr'); row.innerHTML = ` <td>${user.nick}</td> <td>${user.role}</td> <td>${user.isVIP ? 'Sí' : 'No'}</td> <td>${user.mutedBy || 'N/A'}</td> <td>${user.lastIP || 'N/A'}</td> <td><button class="action-button unmute-btn" data-nick="${user.nick}">Quitar Mute</button></td> `; mutedUsersList.appendChild(row); }); } catch (error) { console.error(error); mutedUsersList.innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`; } }
    async function fetchAndShowOnlineUsers() { try { const response = await fetch('/api/admin/online-users'); if (!response.ok) throw new Error('No se pudo cargar la lista de usuarios online.'); const users = await response.json(); onlineUsersList.innerHTML = ''; users.forEach(user => { const row = document.createElement('tr'); row.innerHTML = `<td>${user.nick}</td><td>${user.role}</td><td>${user.ip || 'N/A'}</td><td>${user.rooms.join(', ')}</td>`; onlineUsersList.appendChild(row); }); } catch (error) { onlineUsersList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`; } }
    async function fetchAndShowActivityLogs() { try { const response = await fetch('/api/admin/activity-logs?limit=100'); if (!response.ok) throw new Error('No se pudo cargar el registro de actividad.'); const logs = await response.json(); activityLogsList.innerHTML = ''; logs.forEach(log => { const row = document.createElement('tr'); let eventClass = ''; if (log.event_type === 'CONNECT' || log.event_type === 'JOIN_ROOM') eventClass = 'event-connect'; if (log.event_type === 'DISCONNECT' || log.event_type === 'LEAVE_ROOM') eventClass = 'event-disconnect'; row.innerHTML = `<td>${new Date(log.timestamp).toLocaleString()}</td><td class="${eventClass}"><strong>${log.event_type}</strong></td><td>${log.nick}</td><td>${log.userRole}</td><td>${log.ip || 'N/A'}</td><td>${log.details || '---'}</td>`; activityLogsList.appendChild(row); }); } catch (error) { activityLogsList.innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`; } }

    adminPanelButton.addEventListener('click', () => { adminModal.classList.remove('hidden'); document.querySelector('.admin-tab[data-target="banned-users-panel"]').click(); activityMonitorInterval = setInterval(() => { if (document.querySelector('.admin-tab[data-target="activity-monitor-panel"]').classList.contains('active')) { fetchAndShowOnlineUsers(); } }, 5000); });
    const stopAdminPanelRefresh = () => { adminModal.classList.add('hidden'); clearInterval(activityMonitorInterval); };
    closeModalButton.addEventListener('click', stopAdminPanelRefresh);
    adminModal.addEventListener('click', async (e) => {
        const target = e.target;
        if (target === adminModal) {
            stopAdminPanelRefresh();
        }

        if (target.classList.contains('unban-btn')) {
            const userId = target.dataset.id;
            if (confirm(`¿Estás seguro de que quieres desbanear a ${userId}?`)) {
                try {
                    const response = await fetch('/api/admin/unban', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId })
                    });
                    const result = await response.json();
                    alert(result.message || result.error);
                    if (response.ok) {
                        fetchAndShowBannedUsers();
                    }
                } catch (err) {
                    alert('Error al procesar la solicitud.');
                }
            }
        }

        if (target.classList.contains('unmute-btn')) {
            const nick = target.dataset.nick;
            if (confirm(`¿Estás seguro de que quieres quitar el mute a ${nick}?`)) {
                try {
                    const response = await fetch('/api/admin/unmute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nick })
                    });
                    const result = await response.json();
                    alert(result.message || result.error);
                    if (response.ok) {
                        fetchAndShowMutedUsers();
                    }
                } catch (err) {
                    alert('Error al procesar la solicitud.');
                }
            }
        }
    });
    adminTabs.forEach(tab => { tab.addEventListener('click', () => { adminTabs.forEach(t => t.classList.remove('active')); tab.classList.add('active'); const targetId = tab.dataset.target; adminPanels.forEach(panel => { panel.classList.toggle('hidden', panel.id !== targetId); }); if (targetId === 'banned-users-panel') fetchAndShowBannedUsers(); if (targetId === 'muted-users-panel') fetchAndShowMutedUsers(); if (targetId === 'activity-monitor-panel') { fetchAndShowOnlineUsers(); fetchAndShowActivityLogs(); } }); });
    socket.on('admin panel refresh', () => { if (adminModal.classList.contains('hidden')) return; const activeTab = document.querySelector('.admin-tab.active'); if (activeTab) { const targetId = activeTab.dataset.target; if (targetId === 'banned-users-panel') fetchAndShowBannedUsers(); if (targetId === 'muted-users-panel') fetchAndShowMutedUsers(); if (targetId === 'activity-monitor-panel') { fetchAndShowOnlineUsers(); fetchAndShowActivityLogs(); } } });
    
    // --- LÓGICA DEL MODAL DE PERFIL ---
    function openProfileModal() { profileNickSpan.textContent = myNick; avatarFileInput.value = ''; selectedAvatarFile = null; profileAvatarPreview.src = myUserData.avatar_url || 'image/default-avatar.png'; profileModal.classList.remove('hidden'); }
    closeProfileModalButton.addEventListener('click', () => profileModal.classList.add('hidden'));
    profileModal.addEventListener('click', (e) => { if (e.target === profileModal) { profileModal.classList.add('hidden'); } });
    avatarFileInput.addEventListener('change', () => { const file = avatarFileInput.files[0]; if (file) { selectedAvatarFile = file; const reader = new FileReader(); reader.onload = (e) => { profileAvatarPreview.src = e.target.result; }; reader.readAsDataURL(file); } });
    saveProfileButton.addEventListener('click', async () => { if (!selectedAvatarFile) { alert('Por favor, selecciona una imagen para subir.'); return; } saveProfileButton.disabled = true; saveProfileButton.textContent = 'Subiendo...'; const formData = new FormData(); formData.append('nick', myNick); formData.append('avatarFile', selectedAvatarFile); try { const response = await fetch('/api/user/avatar', { method: 'POST', body: formData, }); const result = await response.json(); if (response.ok) { alert(result.message); profileModal.classList.add('hidden'); } else { alert(`Error: ${result.error || 'No se pudo subir la imagen.'}`); } } catch (error) { console.error('Error al guardar perfil:', error); alert('Hubo un error al conectar con el servidor.'); } finally { saveProfileButton.disabled = false; saveProfileButton.textContent = 'Guardar Cambios'; selectedAvatarFile = null; avatarFileInput.value = ''; } });

    // --- LÓGICA DE GRABACIÓN DE VOZ (NUEVA) ---
    recordAudioButton.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecordingAndPrepare();
        } else {
            startRecording();
        }
    });

    stopRecordingButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecordingAndPrepare();
        }
    });

    sendAudioButton.addEventListener('click', () => {
        if (audioBlob) {
            sendRecordedAudio(audioBlob);
        }
    });

    cancelRecordingButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop(); // Detiene la grabación para liberar recursos
        }
        resetAudioRecording();
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' }); // Formato webm por compatibilidad

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                // Si se detuvo sin cancelar, preparamos el Blob
                if (audioRecordingControls.classList.contains('recording-active')) { // Check if controls were active
                    audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    // Mostrar botones de enviar/cancelar, ocultar botón de stop
                    stopRecordingButton.classList.add('hidden');
                    sendAudioButton.classList.remove('hidden');
                    cancelRecordingButton.classList.remove('hidden');
                }
                // Detener el stream del micrófono
                stream.getTracks().forEach(track => track.stop());
            };

            audioChunks = [];
            mediaRecorder.start();
            recordingStartTime = Date.now();
            recordingTimer.textContent = '00:00';
            recordingInterval = setInterval(updateRecordingTimer, 1000);

            // Mostrar controles de grabación, ocultar botón de micro
            recordAudioButton.classList.add('hidden');
            audioRecordingControls.classList.remove('hidden');
            audioRecordingControls.classList.add('recording-active'); // Marcar que hay una grabación en curso
            stopRecordingButton.classList.remove('hidden');
            sendAudioButton.classList.add('hidden'); // Ocultar enviar hasta que se pare
            cancelRecordingButton.classList.add('hidden'); // Ocultar cancelar hasta que se pare

            input.disabled = true; // Deshabilitar input de texto durante la grabación
            sendButton.disabled = true; // Deshabilitar botón de enviar texto
            imageUpload.disabled = true; // Deshabilitar subida de imagen
            emojiButton.disabled = true; // Deshabilitar emoji

        } catch (err) {
            console.error('Error al acceder al micrófono:', err);
            alert('No se pudo acceder al micrófono. Asegúrate de dar permiso y de que esté conectado.');
            resetAudioRecording();
        }
    }

    function stopRecordingAndPrepare() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            clearInterval(recordingInterval);
        }
    }

    function updateRecordingTimer() {
        const elapsedTime = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsedTime / 1000) % 60;
        const minutes = Math.floor(elapsedTime / (1000 * 60));
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        recordingTimer.textContent = formattedTime;
    }

    function resetAudioRecording() {
        if (mediaRecorder) {
            if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop(); // Asegura que el MediaRecorder esté inactivo
                mediaRecorder.stream.getTracks().forEach(track => track.stop()); // Detiene las pistas del micrófono
            }
            mediaRecorder = null;
        }
        audioChunks = [];
        audioBlob = null;
        clearInterval(recordingInterval);
        recordingTimer.textContent = '00:00';

        // Mostrar botón de micro, ocultar controles de grabación
        recordAudioButton.classList.remove('hidden');
        audioRecordingControls.classList.add('hidden');
        audioRecordingControls.classList.remove('recording-active'); // Quitar la marca de grabación
        stopRecordingButton.classList.add('hidden');
        sendAudioButton.classList.add('hidden');
        cancelRecordingButton.classList.add('hidden');

        input.disabled = false; // Habilitar input de texto
        sendButton.disabled = false; // Habilitar botón de enviar texto
        imageUpload.disabled = false; // Habilitar subida de imagen
        emojiButton.disabled = false; // Habilitar emoji
    }


    // POPUP DE ACCIONES DE USUARIO
    // const userActionPopup = document.getElementById('user-action-popup'); // ELIMINADA ESTA LÍNEA DUPLICADA
    
});