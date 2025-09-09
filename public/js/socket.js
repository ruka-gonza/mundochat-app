import state from './state.js';
import * as dom from './domElements.js';
import { showNotification, replaceEmoticons } from './utils.js';
import { addPrivateChat, updateConversationList } from './ui/conversations.js'; 
import { renderUserList } from './ui/userInteractions.js';
import { appendMessageToView, createMessageElement } from './ui/renderer.js';
import { switchToChat, updateTypingIndicator } from './ui/chatInput.js'; 
import { openProfileModal, showSexoWarningModal, fetchAndShowBannedUsers, fetchAndShowMutedUsers, fetchAndShowOnlineUsers, fetchAndShowActivityLogs, fetchAndShowReports, showRoomCreatorHelpModal } from './ui/modals.js';

function renderHistoryInBatches(history, isPrivate) {
    const container = isPrivate ? dom.privateChatWindow : dom.messagesContainer;
    if (!container) return;

    container.innerHTML = '';

    if (isPrivate && !container.querySelector('ul')) {
        container.appendChild(document.createElement('ul'));
    }
    const listElement = isPrivate ? container.querySelector('ul') : container;

    let index = 0;
    const batchSize = 5;

    function renderBatch() {
        const fragment = document.createDocumentFragment();
        const batchEnd = Math.min(index + batchSize, history.length);

        for (let i = index; i < batchEnd; i++) {
            fragment.appendChild(createMessageElement(history[i], isPrivate));
        }

        listElement.appendChild(fragment);
        index = batchEnd;

        if (index < history.length) {
            requestAnimationFrame(renderBatch);
        } else {
            container.scrollTop = container.scrollHeight;
        }
    }

    renderBatch();
}

export function updateUnreadCounts() {
    let privateUnreadCount = 0;
    for (const id of state.usersWithUnreadMessages) {
        if (!id.startsWith('#')) {
            privateUnreadCount++;
        }
    }
    if (privateUnreadCount > 0) {
        dom.privateUnreadBadge.textContent = privateUnreadCount;
        dom.privateUnreadBadge.classList.remove('hidden');
    } else {
        dom.privateUnreadBadge.classList.add('hidden');
    }
}

function handlePrivateMessageReception(msg) { 
    const partnerNick = msg.from === state.myNick ? msg.to : msg.from; 
    if (!state.privateMessageHistories[partnerNick]) { state.privateMessageHistories[partnerNick] = []; } 
    state.privateMessageHistories[partnerNick].push(msg); 
    if (state.currentChatContext.type === 'private' && state.currentChatContext.with === partnerNick) { appendMessageToView(msg, true); } else { if (msg.from !== state.myNick) { addPrivateChat(partnerNick); state.usersWithUnreadMessages.add(partnerNick); updateConversationList(); updateUnreadCounts(); const notificationBody = msg.file ? `Te ha enviado un archivo.` : msg.text; showNotification(`Nuevo mensaje de ${msg.from}`, notificationBody, true); } } }

function handlePublicMessage(msg) {
    if (!state.publicMessageHistories[msg.roomName]) {
        state.publicMessageHistories[msg.roomName] = [];
    }

    const isMention = state.myNick && msg.nick && msg.text && msg.nick !== state.myNick && msg.text.toLowerCase().includes(state.myNick.toLowerCase());
    if (isMention) {
        msg.isMention = true;
        showNotification(`Nueva mención de ${msg.nick}`, msg.text);
    }
    
    state.publicMessageHistories[msg.roomName].push(msg);

    if (state.currentChatContext.type === 'room' && state.currentChatContext.with === msg.roomName) {
        appendMessageToView(msg, false);
    } else {
        state.usersWithUnreadMessages.add(msg.roomName);
        updateConversationList();
    }
}

export function initializeSocketEvents(socket) {
    state.socket = socket;

    socket.on('kicked_from_room', ({ roomName, by, reason }) => {
        alert(`Has sido expulsado de la sala ${roomName} por ${by}.\nRazón: ${reason}`);
    });

    socket.on('set admin cookie', (data) => { document.cookie = `adminUser=${JSON.stringify(data)}; path=/; max-age=86400`; });

    socket.on('update user list', ({ roomName, users }) => {
        if (!state.roomUserLists) state.roomUserLists = {};
        state.roomUserLists[roomName] = users;

        if (state.currentChatContext.type === 'room' && state.currentChatContext.with === roomName) {
            state.currentRoomUsers = users;
            users.forEach(user => {
                const lowerNick = user.nick.toLowerCase();
                if (!state.allUsersData[lowerNick]) state.allUsersData[lowerNick] = {};
                state.allUsersData[lowerNick] = { ...state.allUsersData[lowerNick], ...user };
            });
            renderUserList();
        }
    });

    socket.on('user_data_updated', (data) => {
        const lowerOldNick = (data.oldNick || data.nick).toLowerCase();
        const lowerNewNick = data.nick.toLowerCase();
    
        if (data.oldNick && lowerOldNick !== lowerNewNick) {
            state.allUsersData[lowerNewNick] = state.allUsersData[lowerOldNick] || {};
            delete state.allUsersData[lowerOldNick];
        }
        state.allUsersData[lowerNewNick] = { ...state.allUsersData[lowerNewNick], ...data };
        
        if (state.myNick.toLowerCase() === lowerOldNick) {
            state.myNick = data.nick;
            state.myUserData = { ...state.myUserData, ...data };
            if (data.isAFK !== undefined) state.isAFK = data.isAFK;
            if (dom.profileNickSpan) dom.profileNickSpan.textContent = state.myNick;
            if (dom.newNickInput) dom.newNickInput.value = state.myNick;
        }
    
        Object.values(state.roomUserLists || {}).forEach(list => {
            const userInList = list.find(u => u.nick.toLowerCase() === lowerOldNick);
            if (userInList) {
                Object.assign(userInList, data);
                if (data.oldNick) {
                  userInList.nick = data.nick;
                }
            }
        });

        if (state.currentChatContext.type === 'room') {
            renderUserList();
        }
    
        if (data.oldNick && lowerOldNick !== lowerNewNick) {
            if (state.activePrivateChats.has(data.oldNick)) {
                state.activePrivateChats.delete(data.oldNick);
                state.activePrivateChats.add(data.nick);
            }
            if (state.disconnectedPrivateChats.has(data.oldNick)) {
                state.disconnectedPrivateChats.delete(data.oldNick);
                state.disconnectedPrivateChats.add(data.nick);
            }
            if (state.usersWithUnreadMessages.has(data.oldNick)) {
                state.usersWithUnreadMessages.delete(data.oldNick);
                state.usersWithUnreadMessages.add(data.nick);
            }
            if (state.currentChatContext.type === 'private' && state.currentChatContext.with.toLowerCase() === lowerOldNick) {
                state.currentChatContext.with = data.nick;
                dom.privateChatWithUser.textContent = `Chat con ${data.nick}`;
            }
        }
    
        updateConversationList();
    });

    socket.on('open private chat', ({ with: partnerNick }) => { if (partnerNick !== state.myNick) switchToChat(partnerNick, 'private'); });
    socket.on('private chat requested', ({ from: partnerNick }) => { if (partnerNick !== state.myNick) addPrivateChat(partnerNick); });
    
    socket.on('private message', handlePrivateMessageReception);
    socket.on('private file message', handlePrivateMessageReception);
    
    socket.on('chat message', handlePublicMessage);
    socket.on('file message', handlePublicMessage);

    socket.on('system message', (msg) => {
        if (msg.roomName) {
            if (!state.publicMessageHistories[msg.roomName]) state.publicMessageHistories[msg.roomName] = [];
            state.publicMessageHistories[msg.roomName].push(msg);
            if (state.currentChatContext.type === 'room' && state.currentChatContext.with === msg.roomName) {
                appendMessageToView(msg, false);
            } else {
                 if ((state.myUserData && ['owner', 'admin', 'mod', 'operator'].includes(state.myUserData.role)) || !msg.roomName.startsWith('#')) {
                    state.usersWithUnreadMessages.add(msg.roomName);
                    updateConversationList();
                }
            }
        } else {
            let targetList;
            if (state.currentChatContext.type === 'room') targetList = dom.messagesContainer;
            else if (state.currentChatContext.type === 'private') targetList = dom.privateChatWindow.querySelector('ul') || dom.privateChatWindow;
            
            if (targetList) {
                const item = document.createElement('li');
                item.className = `system-message ${msg.type || ''}`;
                item.textContent = msg.text;
                targetList.appendChild(item);
                targetList.scrollTop = targetList.scrollHeight;
            }
        }
    });
    
    socket.on('join_success', ({ user, roomName, joinedRooms: serverJoinedRooms, users }) => {
        const isFirstJoinInSession = !state.myNick;
        state.myUserData = user;
        state.myNick = user.nick;
        state.allUsersData[state.myNick.toLowerCase()] = state.myUserData;
        if (isFirstJoinInSession) {
            dom.welcomeContainer.classList.add('hidden');
            dom.chatContainer.classList.remove('hidden');
            dom.profileNickSpan.textContent = state.myNick;
            dom.newNickInput.value = state.myNick;
        }
        dom.actionButtonsContainer.innerHTML = ''; 
        if (state.myUserData.role !== 'guest') {
            const profileButton = document.createElement('button');
            profileButton.id = 'profile-button';
            profileButton.textContent = 'Mi Perfil';
            profileButton.onclick = openProfileModal;
            dom.actionButtonsContainer.appendChild(profileButton);
        }
        if (state.myUserData.isStaff) {
            dom.actionButtonsContainer.appendChild(dom.adminPanelButton);
            dom.adminPanelButton.classList.remove('hidden');
        } else {
            dom.adminPanelButton.classList.add('hidden');
        }
        if (users) {
            if (!state.roomUserLists) state.roomUserLists = {};
            state.roomUserLists[roomName] = users;
            state.currentRoomUsers = users;
            renderUserList();
        }
        if (state.isFirstLogin) {
            dom.welcomePopup.classList.remove('hidden');
            state.isFirstLogin = false;
        }
        
        if (roomName.toLowerCase() === 'sexo') {
            showSexoWarningModal();
        }

        state.joinedRooms = new Set(serverJoinedRooms);
        updateConversationList();
        switchToChat(roomName, 'room');
        dom.roomSwitcher.classList.remove('show');
    });

    socket.on('leave_success', ({ roomName, joinedRooms: serverJoinedRooms }) => {
        state.joinedRooms = new Set(serverJoinedRooms);
        delete state.publicMessageHistories[roomName];
        if (state.currentChatContext.with === roomName) {
            const firstRoom = Array.from(state.joinedRooms).find(r => r !== '#Staff-Logs') || (state.joinedRooms.size > 0 ? state.joinedRooms.values().next().value : null);
            if (firstRoom) {
                switchToChat(firstRoom, 'room');
            } else {
                state.currentChatContext = { type: 'none', with: null };
                dom.mainChatArea.classList.add('hidden');
                dom.privateChatView.classList.add('hidden');
            }
        }
        updateConversationList();
        updateUnreadCounts();
    });
    
    socket.on('update room data', (roomListArray) => {
        dom.guestRoomSelect.innerHTML = '';
        dom.loginRoomSelect.innerHTML = '';
        dom.roomSwitcherList.innerHTML = '';
        roomListArray.forEach(room => {
            if (room.name !== '#Staff-Logs') {
                const option = document.createElement('option');
                option.value = room.name;
                option.textContent = `${room.name} (${room.userCount})`;
                dom.guestRoomSelect.appendChild(option.cloneNode(true));
                dom.loginRoomSelect.appendChild(option);
            }
            if ((state.myUserData && ['owner', 'admin', 'mod', 'operator'].includes(state.myUserData.role)) || room.name !== '#Staff-Logs') {
                const li = document.createElement('li');
                li.innerHTML = `<span>${room.name}</span><span class="user-count">${room.userCount}</span>`;
                if (state.joinedRooms.has(room.name)) {
                    li.classList.add('current-room');
                } else {
                    li.onclick = () => switchToChat(room.name, 'room');
                }
                dom.roomSwitcherList.appendChild(li);
            }
        });
    });

    socket.on('typing', ({ nick, context }) => { if (context.type === state.currentChatContext.type && context.with === state.currentChatContext.with) { state.usersTyping.add(nick); updateTypingIndicator(); } });
    socket.on('stop typing', ({ nick, context }) => { if (context.type === state.currentChatContext.type && context.with === state.currentChatContext.with) { state.usersTyping.delete(nick); updateTypingIndicator(); } });
    
    socket.on('load history', ({ roomName, history }) => {
        state.publicMessageHistories[roomName] = history;
        if (state.currentChatContext.type === 'room' && state.currentChatContext.with === roomName) {
            renderHistoryInBatches(history, false);
        }
    });

    socket.on('load private history', ({ withNick, history }) => {
        state.privateMessageHistories[withNick] = history;
        if (state.currentChatContext.type === 'private' && state.currentChatContext.with === withNick) {
            renderHistoryInBatches(history, true);
        }
    });

    socket.on('user disconnected', ({ nick }) => {
        if (state.activePrivateChats.has(nick)) {
            state.disconnectedPrivateChats.add(nick);
            updateConversationList();
            if (state.currentChatContext.type === 'private' && state.currentChatContext.with === nick) {
                const item = createMessageElement({ text: `${nick} se ha desconectado.` });
                dom.privateChatWindow.querySelector('ul')?.appendChild(item);
            }
        }
    });

    socket.on('auth_error', ({ message }) => { dom.authSuccess.classList.add('hidden'); dom.authError.textContent = message; dom.authError.classList.remove('hidden'); });
    
    socket.on('register_success', ({ message }) => { 
        dom.authError.classList.add('hidden'); 
        dom.authSuccess.textContent = message; 
        dom.authSuccess.classList.remove('hidden'); 
        document.getElementById('show-login-tab').click(); 
        dom.loginNickInput.value = dom.registerNickInput.value; 
        dom.registerNickInput.value = ''; 
        dom.registerEmailInput.value = ''; 
        dom.registerPasswordInput.value = ''; 
        dom.registerPasswordConfirm.value = ''; 
    });

    socket.on('message edited', ({ messageId, newText, roomName }) => {
        if (state.publicMessageHistories[roomName]) {
            const message = state.publicMessageHistories[roomName].find(m => Number(m.id) === Number(messageId));
            if (message) {
                message.text = newText;
                message.editedAt = new Date().toISOString();
            }
        }
        if (state.currentChatContext.with === roomName) {
            const messageElement = document.getElementById(`message-${messageId}`);
            if (messageElement) {
                                const textSpan = messageElement.querySelector('.message-text');
                if (textSpan) {
                    textSpan.innerHTML = twemoji.parse(replaceEmoticons(newText));
                }
                let editedIndicator = messageElement.querySelector('.edited-indicator');
                if (!editedIndicator) {
                    editedIndicator = document.createElement('span');
                    editedIndicator.className = 'edited-indicator';
                    editedIndicator.textContent = ' (editado)';
                    messageElement.querySelector('.message-content').appendChild(editedIndicator);
                }
            }
        }
    });
    
    socket.on('message deleted', ({ messageId, roomName }) => {
        if (state.publicMessageHistories[roomName]) {
            state.publicMessageHistories[roomName] = state.publicMessageHistories[roomName].filter(m => Number(m.id) !== Number(messageId));
        }
        if (state.currentChatContext.with === roomName) {
            document.getElementById(`message-${messageId}`)?.remove();
        }
    });

    socket.on('admin panel refresh', () => {
        if (dom.adminModal.classList.contains('hidden')) return;
        const activeTab = document.querySelector('.admin-tab.active');
        if (activeTab) {
            const targetId = activeTab.dataset.target;
            if (targetId === 'banned-users-panel') fetchAndShowBannedUsers();
            if (targetId === 'muted-users-panel') fetchAndShowMutedUsers();
            if (targetId === 'reports-panel') fetchAndShowReports();
            if (targetId === 'activity-monitor-panel') {
                fetchAndShowOnlineUsers();
                fetchAndShowActivityLogs();
            }
        }
    });

    socket.on('reauth_success', () => {
        console.log("Re-autenticación exitosa. Re-uniéndose a la última sala activa...");
        if (state.pendingRoomJoin) {
            socket.emit('join room', { roomName: state.pendingRoomJoin });
            state.pendingRoomJoin = null;
        } 
        else if (state.lastActiveRoom) {
            socket.emit('join room', { roomName: state.lastActiveRoom });
        } 
        else {
            socket.emit('join room', { roomName: '#General' });
        }
    });

    socket.on('reauth_failed', () => {
        console.error("La re-autenticación falló. Forzando recarga de página.");
        document.cookie = "user_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        location.reload();
    });

    socket.on('room_created_success', () => {
        showRoomCreatorHelpModal();
    });
}