import state from '../state.js';
import * as dom from '../domElements.js';
import { isValidNick, unlockAudioContext } from '../utils.js'; // <-- MODIFICACIÓN: Importar unlockAudioContext

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

export function initAuth() {
    setupAuthTabs();
    setupForgotPasswordModal();

    dom.guestJoinButton.addEventListener('click', () => {
        unlockAudioContext(); // <-- MODIFICACIÓN: Desbloquear audio aquí
        const nick = dom.guestNickInput.value.trim();
        const roomName = dom.guestRoomSelect.value;
        if (!isValidNick(nick)) {
            dom.authError.textContent = "El nick solo puede contener letras, números, guiones (-) y guiones bajos (_).";
            dom.authError.classList.remove('hidden');
            return;
        }
        if (nick && roomName) state.socket.emit('guest_join', { nick, roomName });
    });

    dom.loginButton.addEventListener('click', () => {
        unlockAudioContext(); // <-- MODIFICACIÓN: Desbloquear audio aquí
        const nick = dom.loginNickInput.value.trim();
        const password = dom.loginPasswordInput.value;
        const roomName = dom.loginRoomSelect.value;
        if (nick && password && roomName) state.socket.emit('login', { nick, password, roomName });
    });

    dom.registerButton.addEventListener('click', () => {
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
        if (nick && email && password) {
            state.socket.emit('register', { nick, email, password });
        }
    });
}