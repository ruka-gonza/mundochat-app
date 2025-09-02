import state from '../state.js';
import * as dom from '../domElements.js';
import { switchToChat } from './chatInput.js';
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================

export function addPrivateChat(nick) {
    if (nick === state.myNick || state.activePrivateChats.has(nick)) return;
    state.activePrivateChats.add(nick);
    state.disconnectedPrivateChats.delete(nick);
    updateConversationList();
}

export function updateConversationList() {
    dom.roomList.innerHTML = '';
    dom.privateChatList.innerHTML = '';

    const createConversationItem = (id, isRoom, isDisconnected = false) => {
        const item = document.createElement('li');
        item.dataset.convId = id;
        
        item.onclick = () => {
            switchToChat(id, isRoom ? 'room' : 'private');
            dom.conversationsPanel.classList.remove('show');
            dom.mobileOverlay.classList.remove('show');
        };
        
        const icon = isRoom ? (id === '#Staff-Logs' ? '🛡️' : '🌐') : '👤';
        item.innerHTML = `<span>${icon} ${id}</span>`;
        
        const closeBtn = document.createElement('span');
        closeBtn.className = 'close-conversation';
        closeBtn.innerHTML = '×';
        
        const canBeClosed = isRoom ? id !== '#General' && id !== '#Staff-Logs' : true;

        if (canBeClosed) {
            item.appendChild(closeBtn);
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                if (isRoom) {
                    state.socket.emit('leave room', { roomName: id });
                } else {
                    state.activePrivateChats.delete(id);
                    state.disconnectedPrivateChats.delete(id);
                    delete state.privateMessageHistories[id];
                    if (state.currentChatContext.with === id) {
                        const firstRoom = Array.from(state.joinedRooms).find(r => r !== '#Staff-Logs') || Array.from(state.joinedRooms)[0];
                        if (firstRoom) {
                            switchToChat(firstRoom, 'room');
                        } else {
                            state.currentChatContext = { type: 'none', with: null };
                            dom.mainChatArea.classList.add('hidden');
                            dom.privateChatView.classList.add('hidden');
                        }
                    }
                    updateConversationList();
                }
            };
        }
        
        if (state.currentChatContext.with === id) item.classList.add('active');
        if (state.usersWithUnreadMessages.has(id)) {
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
    
    const sortedRooms = Array.from(state.joinedRooms).sort();
    sortedRooms.forEach(roomId => dom.roomList.appendChild(createConversationItem(roomId, true, false)));
    state.activePrivateChats.forEach(userId => {
        const isDisconnected = state.disconnectedPrivateChats.has(userId);
        dom.privateChatList.appendChild(createConversationItem(userId, false, isDisconnected));
    });
}

export function initConversations() {
    document.querySelectorAll('.group-header').forEach(header => {
        header.addEventListener('click', () => {
            header.parentElement.classList.toggle('collapsed');
        });
    });

    dom.roomHeaderContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.roomSwitcher.classList.toggle('show');
    });
}