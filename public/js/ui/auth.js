import state from '../state.js';
import * as dom from '../domElements.js';
import { isValidNick, unlockAudioContext } from '../utils.js';

function setupAuthTabs() {
    const authTabs = document.querySelectorAll('.auth-tab');
    const authForms = document.querySelectorAll('.auth-form');
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetFormId = tab.dataset.form;
            authTabs.forEach(t => t.classList.remove('active'));
            authForms.forEach(f => f.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(targetFormId).classList.remove('hidden');
            dom.authError.classList.add('hidden');
            dom.authSuccess.classList.add('hidden');
        });
    });
}

function setupForgotPasswordModal() {
    dom.showForgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        dom.forgotIdentifierInput.value = '';
        dom.forgotPasswordMessage.classList.add('hidden');
        dom.forgotPasswordModal.classList.remove('hidden');
    });

    dom.closeForgotPasswordModalButton.addEventListener('click', () => {
        dom.forgotPasswordModal.classList.add('hidden');
    });

    dom.forgotPasswordModal.addEventListener('click', (e) => {
        if (e.target === dom.forgotPasswordModal) {
            dom.forgotPasswordModal.classList.add('hidden');
        }
    });

    dom.sendResetLinkButton.addEventListener('click', async () => {
        const identifier = dom.forgotIdentifierInput.value.trim();
        dom.forgotPasswordMessage.classList.add('hidden');
        dom.forgotPasswordMessage.classList.remove('error-message', 'success-message');

        if (!identifier) {
            dom.forgotPasswordMessage.textContent = 'Por favor, introduce tu nick o correo electrónico.';
            dom.forgotPasswordMessage.classList.remove('hidden');
            dom.forgotPasswordMessage.classList.add('error-message');
            return;
        }

        dom.sendResetLinkButton.disabled = true;
        dom.sendResetLinkButton.textContent = 'Enviando...';

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier })
            });
            const data = await response.json();
            dom.forgotPasswordMessage.textContent = data.message || data.error || 'Error al procesar la solicitud.';
            dom.forgotPasswordMessage.classList.remove('hidden');
            dom.forgotPasswordMessage.classList.toggle('success-message', response.ok);
            dom.forgotPasswordMessage.classList.toggle('error-message', !response.ok);
        } catch (error) {
            console.error('Error al solicitar restablecimiento:', error);
            dom.forgotPasswordMessage.textContent = 'Error de conexión al servidor.';
            dom.forgotPasswordMessage.classList.remove('hidden');
            dom.forgotPasswordMessage.classList.add('error-message');
        } finally {
            dom.sendResetLinkButton.disabled = false;
            dom.sendResetLinkButton.textContent = 'Enviar Enlace';
        }
    });
}

// =========================================================================
// ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
export function initAuth() { // <-- AÑADIR LA PALABRA "export" AQUÍ
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================
    setupAuthTabs();
    setupForgotPasswordModal();
    
    dom.guestJoinButton.addEventListener('click', async () => {
        unlockAudioContext();
        const nick = dom.guestNickInput.value.trim();
        const roomName = dom.guestRoomSelect.value;
        if (!isValidNick(nick)) {
            dom.authError.textContent = "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_).";
            dom.authError.classList.remove('hidden');
            return;
        }
        if (nick && roomName) {
            try {
                const response = await fetch('/api/guest/join', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nick }),
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error);
                }
                state.socket.emit('guest_join', { ...result.userData, roomName });
            } catch (error) {
                dom.authError.textContent = error.message;
                dom.authError.classList.remove('hidden');
            }
        }
    });

    dom.loginButton.addEventListener('click', async () => {
        unlockAudioContext();
        const nick = dom.loginNickInput.value.trim();
        const password = dom.loginPasswordInput.value;
        const roomName = dom.loginRoomSelect.value;
        if (nick && password && roomName) {
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nick, password }),
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error);
                }
                state.socket.emit('login', { ...result.userData, roomName });
            } catch (error) {
                dom.authError.textContent = error.message;
                dom.authError.classList.remove('hidden');
            }
        }
    });
    
    dom.registerButton.addEventListener('click', async () => {
        const nick = dom.registerNickInput.value.trim();
        const email = dom.registerEmailInput.value.trim();
        const password = dom.registerPasswordInput.value;
        const confirm = dom.registerPasswordConfirm.value;

        if (password !== confirm) {
            dom.authError.textContent = "Las contraseñas no coinciden.";
            dom.authError.classList.remove('hidden');
            return;
        }
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            dom.authError.textContent = "Formato de correo electrónico inválido.";
            dom.authError.classList.remove('hidden');
            return;
        }
        if (!isValidNick(nick)) {
            dom.authError.textContent = "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_).";
            dom.authError.classList.remove('hidden');
            return;
        }
        
        try {
             const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nick, email, password })
            });
            const result = await response.json();
            if (response.ok) {
                dom.authError.classList.add('hidden');
                dom.authSuccess.textContent = result.message;
                dom.authSuccess.classList.remove('hidden');
                document.getElementById('show-login-tab').click();
                dom.loginNickInput.value = nick;
            } else {
                dom.authSuccess.classList.add('hidden');
                dom.authError.textContent = result.error;
                dom.authError.classList.remove('hidden');
            }
        } catch (error) {
            dom.authSuccess.classList.add('hidden');
            dom.authError.textContent = "Error de conexión al servidor.";
            dom.authError.classList.remove('hidden');
        }
    });
}