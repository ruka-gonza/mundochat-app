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
    const { conversationsPanel, userListContainer, mobileOverlay, privateChatView } = dom;
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

    overlay.addEventListener('click', closePanels);

    privateChatBackButton.addEventListener('click', () => {
        // Vuelve a la última sala activa si existe, sino a la sala general
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


/**
 * Punto de entrada principal de la aplicación del cliente.
 * Se ejecuta cuando el DOM está completamente cargado.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Inicializa la conexión del socket y la guarda en el estado global
    state.socket = io();

    // Inicializa todos los módulos de la aplicación
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