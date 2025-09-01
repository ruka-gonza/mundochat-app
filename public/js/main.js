import state from './state.js';
import * as dom from './domElements.js';
import { initializeSocketEvents } from './socket.js';
import { initAuth } from './ui/auth.js';
import { initChatInput, switchToChat } from './ui/chatInput.js';
import { initConversations } from './ui/conversations.js';
import { initModals } from './ui/modals.js';
import { initUserInteractions } from './ui/userInteractions.js';

function initResponsiveHandlers() {
    const { conversationsPanel, userListContainer, mobileOverlay } = dom;
    const toggleConversationsBtn = document.getElementById('toggle-conversations-btn');
    const toggleUsersBtn = document.getElementById('toggle-users-btn');
    const privateChatBackButton = document.getElementById('private-chat-back-button');

    const closePanels = () => {
        conversationsPanel.classList.remove('show');
        userListContainer.classList.remove('show');
        mobileOverlay.classList.remove('show');
    };

    toggleConversationsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userListContainer.classList.remove('show'); 
        conversationsPanel.classList.toggle('show');
        mobileOverlay.classList.toggle('show', conversationsPanel.classList.contains('show'));
    });

    toggleUsersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        conversationsPanel.classList.remove('show'); 
        userListContainer.classList.toggle('show');
        mobileOverlay.classList.toggle('show', userListContainer.classList.contains('show'));
    });

    mobileOverlay.addEventListener('click', closePanels);

    privateChatBackButton.addEventListener('click', () => {
        const roomToReturn = state.lastActiveRoom || '#General';
        switchToChat(roomToReturn, 'room');
    });
}

function initThemeSwitcher() {
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        dom.themeToggleCheckbox.checked = true;
    }

    dom.themeToggleCheckbox.addEventListener('change', function() {
        if (this.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    state.socket = io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
    });

    // --- Lógica para manejar visualmente la desconexión/reconexión ---
    const connectionOverlay = document.createElement('div');
    connectionOverlay.id = 'connection-overlay';
    connectionOverlay.innerHTML = '🔴 Desconectado. Intentando reconectar...';
    document.body.appendChild(connectionOverlay);

    state.socket.on('disconnect', (reason) => {
        console.warn(`Desconectado del servidor. Razón: ${reason}`);
        connectionOverlay.style.display = 'flex';
    });

    state.socket.on('connect', () => {
        console.log("¡Conectado de nuevo al servidor!");
        connectionOverlay.style.display = 'none';
        
        if (state.myNick && state.currentChatContext.type === 'room' && state.currentChatContext.with) {
            console.log(`Re-uniéndose a la sala: ${state.currentChatContext.with} tras reconexión.`);
            setTimeout(() => {
                state.socket.emit('join room', { roomName: state.currentChatContext.with });
            }, 500);
        }
    });
    
    state.socket.on('reconnect_failed', () => {
        console.error("Fallo en la reconexión.");
        connectionOverlay.innerHTML = '❌ No se pudo reconectar. Por favor, recarga la página.';
    });

    // El resto de la inicialización sigue igual
    initializeSocketEvents(state.socket);
    initAuth();
    initChatInput();
    initConversations();
    initModals();
    initUserInteractions();
    initResponsiveHandlers();
    initThemeSwitcher();

    console.log("Cliente de MundoChat inicializado correctamente.");
});