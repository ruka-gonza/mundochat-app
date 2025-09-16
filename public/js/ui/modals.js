import state from '../state.js';
import * as dom from '../domElements.js';
import { isValidNick } from '../utils.js';
import { unlockAudioContext } from '../utils.js';

export function openImageModal(imageSrc) {
    if (dom.modalImage && dom.imageModalOverlay) {
        dom.modalImage.src = imageSrc;
        dom.imageModalOverlay.classList.remove('hidden');
    }
}

export async function fetchWithCredentials(url, options = {}) {
    options.credentials = 'include';
    
    // Si no hay cabeceras, las inicializamos
    if (!options.headers) {
        options.headers = {};
    }

    // AÑADIMOS LA CABECERA DE AUTORIZACIÓN CON EL TOKEN
    if (state.authToken) {
        options.headers['Authorization'] = `Bearer ${state.authToken}`;
    }
    
    const response = await fetch(url, options);
    
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `La petición falló con el estado ${response.status}`);
        }
        return result;
    } else {
        if (!response.ok) {
            const textError = await response.text();
            throw new Error(textError || `La petición falló con el estado ${response.status}`);
        }
        return response;
    }
}

export async function fetchAndShowReports() {
    try {
        const reports = await fetchWithCredentials('/api/admin/reports');
        dom.reportsList.innerHTML = '';
        if (reports.length === 0) {
            dom.reportsList.innerHTML = `<tr><td colspan="4">No hay denuncias recientes.</td></tr>`;
            return;
        }
        reports.forEach(report => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${new Date(report.timestamp).toLocaleString()}</td>
                <td>${report.reporter}</td>
                <td>${report.reported}</td>
                <td>${report.reason}</td>
            `;
            dom.reportsList.appendChild(row);
        });
    } catch (error) {
        console.error(error);
        dom.reportsList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
    }
}

export async function fetchAndShowBannedUsers() {
    try {
        const users = await fetchWithCredentials('/api/admin/banned');
        dom.bannedUsersList.innerHTML = '';
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${user.id}</td><td>${user.nick}</td><td>${user.ip || 'N/A'}</td><td>${user.by}</td><td>${user.reason}</td><td>${new Date(user.at).toLocaleString()}</td><td><button class="action-button unban-btn" data-id="${user.id}">Quitar Ban</button></td>`;
            dom.bannedUsersList.appendChild(row);
        });
    } catch (error) {
        console.error(error);
        dom.bannedUsersList.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
    }
}

export async function fetchAndShowMutedUsers() {
    try {
        const users = await fetchWithCredentials('/api/admin/muted');
        dom.mutedUsersList.innerHTML = '';
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${user.nick}</td><td>${user.role}</td><td>${user.isVIP ? 'Sí' : 'No'}</td><td>${user.mutedBy || 'N/A'}</td><td>${user.lastIP || 'N/A'}</td><td><button class="action-button unmute-btn" data-nick="${user.nick}">Quitar Mute</button></td>`;
            dom.mutedUsersList.appendChild(row);
        });
    } catch (error) {
        console.error(error);
        dom.mutedUsersList.innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`;
    }
}

export async function fetchAndShowOnlineUsers() {
    try {
        const users = await fetchWithCredentials('/api/admin/online-users');
        dom.onlineUsersList.innerHTML = '';
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${user.nick}</td><td>${user.role}</td><td>${user.ip || 'N/A'}</td><td>${user.rooms.join(', ')}</td>`;
            dom.onlineUsersList.appendChild(row);
        });
    } catch (error) {
        dom.onlineUsersList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
    }
}

export async function fetchAndShowActivityLogs() {
    try {
        const logs = await fetchWithCredentials('/api/admin/activity-logs?limit=100');
        dom.activityLogsList.innerHTML = '';
        logs.forEach(log => {
            const row = document.createElement('tr');
            let eventClass = '';
            if (log.event_type === 'CONNECT' || log.event_type === 'JOIN_ROOM') eventClass = 'event-connect';
            if (log.event_type === 'DISCONNECT' || log.event_type === 'LEAVE_ROOM') eventClass = 'event-disconnect';
            row.innerHTML = `<td>${new Date(log.timestamp).toLocaleString()}</td><td class="${eventClass}"><strong>${log.event_type}</strong></td><td>${log.nick}</td><td>${log.userRole}</td><td>${log.ip || 'N/A'}</td><td>${log.details || '---'}</td>`;
            dom.activityLogsList.appendChild(row);
        });
    } catch (error) {
        dom.activityLogsList.innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`;
    }
}

export function openProfileModal() {
    dom.profileNickSpan.textContent = state.myNick;
    dom.newNickInput.value = state.myNick;
    dom.avatarFileInput.value = '';
    state.selectedAvatarFile = null;
    dom.profileAvatarPreview.src = state.myUserData.avatar_url || 'image/default-avatar.png';
    
    const fileNameDisplay = document.getElementById('file-name-display');
    if (fileNameDisplay) {
        fileNameDisplay.textContent = 'Ningún archivo seleccionado';
    }

    dom.profileModal.classList.remove('hidden');
}

export function showSexoWarningModal() {
    if (dom.sexoWarningModal) {
        dom.sexoWarningModal.classList.remove('hidden');
    }
}

export function initModals() {
    const welcomePopup = dom.welcomePopup;
    function hideWelcomePopup() { if (welcomePopup) welcomePopup.classList.add('hidden'); }

    if (dom.confirmWelcomePopupButton) {
        dom.confirmWelcomePopupButton.addEventListener('click', () => {
            unlockAudioContext();
            hideWelcomePopup();
        });
    }

    if (dom.closeWelcomePopupButton) {
        dom.closeWelcomePopupButton.addEventListener('click', hideWelcomePopup);
    }
    if (welcomePopup) {
        welcomePopup.addEventListener('click', (e) => { 
            if (e.target === welcomePopup) {
                hideWelcomePopup();
            }
        });
    }

    if (dom.acceptSexoWarningButton) {
        dom.acceptSexoWarningButton.addEventListener('click', () => {
            if (dom.sexoWarningModal) {
                dom.sexoWarningModal.classList.add('hidden');
            }
        });
    }

    dom.adminPanelButton.addEventListener('click', () => {
        dom.adminModal.classList.remove('hidden');
        document.querySelector('.admin-tab[data-target="banned-users-panel"]').click();
        state.activityMonitorInterval = setInterval(() => {
            if (document.querySelector('.admin-tab[data-target="activity-monitor-panel"]').classList.contains('active')) {
                fetchAndShowOnlineUsers();
            }
        }, 5000);
    });

    const stopAdminPanelRefresh = () => {
        dom.adminModal.classList.add('hidden');
        clearInterval(state.activityMonitorInterval);
    };
    dom.adminCloseModalButton.addEventListener('click', stopAdminPanelRefresh);

    dom.adminModal.addEventListener('click', async (e) => {
        const target = e.target;
        if (target === dom.adminModal) stopAdminPanelRefresh();
        if (target.classList.contains('unban-btn')) {
            const userId = target.dataset.id;
            if (confirm(`¿Estás seguro de que quieres desbanear a ${userId}?`)) {
                try {
                    const result = await fetchWithCredentials('/api/admin/unban', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
                    alert(result.message);
                    fetchAndShowBannedUsers();
                } catch (err) { alert('Error al procesar la solicitud: ' + err.message); }
            }
        }
        if (target.classList.contains('unmute-btn')) {
            const nick = target.dataset.nick;
            if (confirm(`¿Estás seguro de que quieres quitar el mute a ${nick}?`)) {
                try {
                    const result = await fetchWithCredentials('/api/admin/unmute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nick }) });
                    alert(result.message);
                    fetchAndShowMutedUsers();
                } catch (err) { alert('Error al procesar la solicitud: ' + err.message); }
            }
        }
    });

    dom.adminTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dom.adminTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.dataset.target;
            dom.adminPanels.forEach(panel => panel.classList.toggle('hidden', panel.id !== targetId));
            if (targetId === 'banned-users-panel') fetchAndShowBannedUsers();
            if (targetId === 'muted-users-panel') fetchAndShowMutedUsers();
            if (targetId === 'reports-panel') fetchAndShowReports();
            if (targetId === 'activity-monitor-panel') { fetchAndShowOnlineUsers(); fetchAndShowActivityLogs(); }
        });
    });

    dom.closeProfileModalButton.addEventListener('click', () => dom.profileModal.classList.add('hidden'));
    dom.profileModal.addEventListener('click', (e) => { if (e.target === dom.profileModal) dom.profileModal.classList.add('hidden'); });

    dom.avatarFileInput.addEventListener('change', () => {
        const file = dom.avatarFileInput.files[0];
        const fileNameDisplay = document.getElementById('file-name-display');

        if (file) {
            state.selectedAvatarFile = file;
            if (fileNameDisplay) {
                fileNameDisplay.textContent = file.name;
            }
            const reader = new FileReader();
            reader.onload = (e) => { dom.profileAvatarPreview.src = e.target.result; };
            reader.readAsDataURL(file);
        } else {
             if (fileNameDisplay) {
                fileNameDisplay.textContent = 'Ningún archivo seleccionado';
            }
        }
    });
    
    dom.saveProfileButton.addEventListener('click', async () => {
        if (!state.selectedAvatarFile) {
            alert('Por favor, selecciona una imagen para subir.');
            return;
        }
        dom.saveProfileButton.disabled = true;
        dom.saveProfileButton.textContent = 'Subiendo...';

        const reader = new FileReader();
        reader.readAsDataURL(state.selectedAvatarFile);
        reader.onload = async () => {
            const avatarBase64 = reader.result;
            try {
                const result = await fetchWithCredentials('/api/user/avatar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatarBase64 })
                });
                alert(result.message);
                dom.profileModal.classList.add('hidden');
            } catch (error) {
                console.error('Error al guardar perfil:', error);
                alert('Hubo un error al conectar con el servidor: ' + error.message);
            } finally {
                dom.saveProfileButton.disabled = false;
                dom.saveProfileButton.textContent = 'Guardar Avatar';
                state.selectedAvatarFile = null;
                dom.avatarFileInput.value = '';
            }
        };
        reader.onerror = (error) => {
            console.error('Error al leer el archivo:', error);
            alert('No se pudo leer el archivo de imagen.');
            dom.saveProfileButton.disabled = false;
            dom.saveProfileButton.textContent = 'Guardar Avatar';
        };
    });

    dom.changeNickButton.addEventListener('click', async () => {
        const newNick = dom.newNickInput.value.trim();
        if (!isValidNick(newNick)) {
            alert('Nick inválido. Debe tener entre 3-15 caracteres y solo puede contener letras, números, guiones y guiones bajos.'); return;
        }
        dom.changeNickButton.disabled = true; dom.changeNickButton.textContent = 'Cambiando...';
        try {
            const result = await fetchWithCredentials('/api/user/nick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newNick }) });
            alert(result.message);
            dom.profileModal.classList.add('hidden');
        } catch (error) {
            console.error('Error al cambiar nick:', error);
            alert('Hubo un error al conectar con el servidor: ' + error.message);
        } finally {
            dom.changeNickButton.disabled = false;
            dom.changeNickButton.textContent = 'Cambiar';
        }
    });

    const roomCreatorHelpModal = document.getElementById('room-creator-help-modal');
    if (roomCreatorHelpModal) {
        const closeBtn = roomCreatorHelpModal.querySelector('.modal-close-button');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                roomCreatorHelpModal.classList.add('hidden');
            });
        }
        roomCreatorHelpModal.addEventListener('click', (e) => {
            if (e.target === roomCreatorHelpModal) {
                roomCreatorHelpModal.classList.add('hidden');
            }
        });
    }
}

export function showRoomCreatorHelpModal() {
    const modal = document.getElementById('room-creator-help-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

export function showAdminAgreementModal(targetNick, senderNick) {
    console.log('[DEBUG] showAdminAgreementModal called.');
    const modal = document.getElementById('admin-agreement-modal');
    const agreementTextElement = document.getElementById('admin-agreement-text');
    const acceptButton = document.getElementById('accept-agreement-button');
    const declineButton = document.getElementById('decline-agreement-button');
    const checkbox = document.getElementById('agreement-checkbox');

    if (modal && agreementTextElement && acceptButton && declineButton && checkbox) {
        checkbox.checked = false;
        acceptButton.disabled = true;

        checkbox.onchange = () => {
            acceptButton.disabled = !checkbox.checked;
        };

        acceptButton.onclick = () => {
            state.socket.emit('admin_agreement_accepted', { targetNick, senderNick });
            modal.classList.add('hidden');
        };

        declineButton.onclick = () => {
            modal.classList.add('hidden');
        };

        modal.classList.remove('hidden');
    } else {
        console.error('[DEBUG] Admin agreement modal elements not found.');
    }
}