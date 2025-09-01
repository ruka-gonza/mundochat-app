import state from './state.js';
import * as dom from './domElements.js';
import { initializeSocketEvents } from './socket.js';

// Importación de módulos de interfaz de usuario (UI)
import { initAuth } from './ui/auth.js';
import { initChatInput, switchToChat } from './ui/chatInput.js';
import { initConversations } from './ui/conversations.js';
import { initModals } from './ui/modals.js';
import { initUserInteractions } from './ui/userInteractions.js';

/**
 * Configura los manejadores de eventos para la interfaz responsiva en móviles.
 * Controla la visibilidad de los paneles laterales y la superposición.
 */
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

/**
 * Inicializa el selector de tema (claro/oscuro) y aplica el tema guardado.
 */
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
        
        const authCookie = document.cookie.split('; ').find(row => row.startsWith('user_auth='));
        if (authCookie) {
            try {
                const userData = JSON.parse(decodeURIComponent(authCookie.split('=')[1]));
                if (userData && userData.id && userData.nick) {
                    console.log("Intentando re-autenticar con:", userData);
                    state.socket.emit('reauthenticate', userData);
                }
            } catch (e) {
                console.error("Error al parsear cookie de autenticación:", e);
            }
        }
    });
    
    state.socket.on('reconnect_failed', () => {
        console.error("Fallo en la reconexión.");
        connectionOverlay.innerHTML = '❌ No se pudo reconectar. Por favor, recarga la página.';
    });

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