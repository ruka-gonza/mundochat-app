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

function initLogoutButton() {
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            // Borra la cookie de sesión del navegador.
            document.cookie = "user_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            
            // Notifica al servidor para una limpieza inmediata.
            if (state.socket) {
                state.socket.emit('logout');
            }

            // Recarga la página para volver a la pantalla de bienvenida.
            setTimeout(() => {
                location.reload();
            }, 100); 
        });
    }
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
    connectionOverlay.style.position = 'fixed';
    connectionOverlay.style.bottom = '0';
    connectionOverlay.style.left = '0';
    connectionOverlay.style.width = '100%';
    connectionOverlay.style.padding = '10px';
    connectionOverlay.style.backgroundColor = 'rgba(217, 83, 79, 0.9)';
    connectionOverlay.style.color = 'white';
    connectionOverlay.style.textAlign = 'center';
    connectionOverlay.style.zIndex = '9999';
    connectionOverlay.style.display = 'none';
    document.body.appendChild(connectionOverlay);

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    // Esta bandera nos ayuda a saber si es la primera conexión o una reconexión.
    let isConnectedBefore = false;

    state.socket.on('connect', () => {
        // Oculta el banner inmediatamente al conectar.
        connectionOverlay.style.display = 'none';
        
        // Si ya estábamos conectados antes, esto es una reconexión.
        if (isConnectedBefore) {
            console.log("Reconnected to server. Attempting to re-authenticate...");
        } else {
            console.log("Successfully connected to server for the first time.");
        }
        isConnectedBefore = true; // Marcamos que ya hemos tenido una conexión exitosa.
        
        // La lógica de re-autenticación se mantiene igual.
        const authCookie = document.cookie.split('; ').find(row => row.startsWith('user_auth='));
        if (authCookie) {
            try {
                const userData = JSON.parse(decodeURIComponent(authCookie.split('=')[1]));
                if (userData && userData.id && userData.nick) {
                    state.socket.emit('reauthenticate', userData);
                }
            } catch (e) {
                console.error("Error parsing auth cookie:", e);
            }
        }
    });

    state.socket.on('disconnect', (reason) => {
        console.warn(`Disconnected from server. Reason: ${reason}`);
        // Muestra el banner inmediatamente para informar al usuario.
        connectionOverlay.innerHTML = '🔴 Desconectado. Intentando reconectar...';
        connectionOverlay.style.display = 'block';
    });
    // =========================================================================
    // ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    
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
    initLogoutButton();

    console.log("Cliente de MundoChat inicializado correctamente.");
});