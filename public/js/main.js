import { initializeSocketEvents } from './socket.js';
import { initAuth } from './ui/auth.js';
import { initChatInput, switchToChat } from './ui/chatInput.js';
import { initConversations } from './ui/conversations.js';
import { initModals } from './ui/modals.js';
import { initUserInteractions } from './ui/userInteractions.js';
import * as dom from './domElements.js';
import state from './state.js';

function initResponsiveHandlers() {
    const conversationsPanel = document.getElementById('conversations-panel');
    const usersPanel = document.getElementById('user-list-container');
    const toggleConversationsBtn = document.getElementById('toggle-conversations-btn');
    const toggleUsersBtn = document.getElementById('toggle-users-btn');
    const overlay = document.getElementById('mobile-overlay');
    const privateChatBackButton = document.getElementById('private-chat-back-button');

    const closePanels = () => {
        conversationsPanel.classList.remove('show');
        usersPanel.classList.remove('show');
        overlay.classList.remove('show');
    };

    toggleConversationsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        usersPanel.classList.remove('show'); 
        conversationsPanel.classList.toggle('show');
        overlay.classList.toggle('show', conversationsPanel.classList.contains('show'));
    });

    toggleUsersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        conversationsPanel.classList.remove('show'); 
        usersPanel.classList.toggle('show');
        overlay.classList.toggle('show', usersPanel.classList.contains('show'));
    });

    overlay.addEventListener('click', closePanels);

    privateChatBackButton.addEventListener('click', () => {
        if (state.lastActiveRoom) {
            switchToChat(state.lastActiveRoom, 'room');
        }
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


import state from './state.js'; // <-- AÑADE ESTA LÍNEA

document.addEventListener('DOMContentLoaded', () => {
    state.socket = io(); // <-- ¡LA CORRECCIÓN MÁGICA!

    initializeSocketEvents(state.socket); // Pasamos el socket del estado
    initAuth();
    initChatInput();
    initConversations();
    initModals();
    initUserInteractions();
    
    initResponsiveHandlers();
    initThemeSwitcher();

    console.log("Cliente de MundoChat inicializado modularmente.");
});