document.addEventListener('DOMContentLoaded', () => {
    const bannedUsersList = document.getElementById('banned-users-list');
    const reportsList = document.getElementById('reports-list');
    const mutedUsersList = document.getElementById('muted-users-list');
    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.admin-panel');

    // Función para obtener y mostrar los usuarios baneados
    async function fetchBannedUsers() {
        try {
            const response = await fetch('/api/admin/banned');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'No tienes permiso para ver esta información.');
            }
            const bannedUsers = await response.json();
            bannedUsersList.innerHTML = '';
            if (bannedUsers.length === 0) {
                bannedUsersList.innerHTML = `<tr><td colspan="7">No hay usuarios baneados.</td></tr>`;
                return;
            }
            bannedUsers.forEach(user => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.id}</td>
                    <td>${user.nick}</td>
                    <td>${user.ip}</td>
                    <td>${user.by}</td>
                    <td>${user.reason}</td>
                    <td>${new Date(user.at).toLocaleString()}</td>
                    <td><button class="action-button unban-btn" data-id="${user.id}">Quitar Ban</button></td>
                `;
                bannedUsersList.appendChild(row);
            });
        } catch (error) {
            bannedUsersList.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
        }
    }

    // Función para obtener y mostrar las denuncias
    async function fetchReports() {
        try {
            const response = await fetch('/api/admin/reports');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'No tienes permiso para ver esta información.');
            }
            const reports = await response.json();
            reportsList.innerHTML = '';
             if (reports.length === 0) {
                reportsList.innerHTML = `<tr><td colspan="4">No hay denuncias pendientes.</td></tr>`;
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
                reportsList.appendChild(row);
            });
        } catch (error) {
            reportsList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
        }
    }

    // Función para obtener y mostrar los usuarios silenciados
    async function fetchMutedUsers() {
        try {
            const response = await fetch('/api/admin/muted');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'No tienes permiso para ver esta información.');
            }
            const mutedUsers = await response.json();
            mutedUsersList.innerHTML = '';
             if (mutedUsers.length === 0) {
                mutedUsersList.innerHTML = `<tr><td colspan="4">No hay usuarios silenciados.</td></tr>`;
                return;
            }
            mutedUsers.forEach(user => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.nick}</td>
                    <td>${user.lastIP}</td>
                    <td>${user.mutedBy}</td>
                    <td><button class="action-button unmute-btn" data-nick="${user.nick}">Quitar Mute</button></td>
                `;
                mutedUsersList.appendChild(row);
            });
        } catch (error) {
            mutedUsersList.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
        }
    }

    // Manejador de eventos para los botones de desbanear
    bannedUsersList.addEventListener('click', async (event) => {
        if (event.target.classList.contains('unban-btn')) {
            const userId = event.target.dataset.id;
            if (confirm(`¿Estás seguro de que quieres desbanear a ${userId}?`)) {
                try {
                    const response = await fetch('/api/admin/unban', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId })
                    });
                    const result = await response.json();
                    if (response.ok) {
                        alert(result.message);
                        fetchBannedUsers(); // Recargar la lista de baneados
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    alert(`Error al desbanear: ${error.message}`);
                }
            }
        }
    });

    // Manejador de eventos para los botones de des-silenciar
    mutedUsersList.addEventListener('click', async (event) => {
        if (event.target.classList.contains('unmute-btn')) {
            const nick = event.target.dataset.nick;
            if (confirm(`¿Estás seguro de que quieres quitar el silencio a ${nick}?`)) {
                try {
                    const response = await fetch('/api/admin/unmute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nick })
                    });
                    const result = await response.json();
                    if (response.ok) {
                        alert(result.message);
                        fetchMutedUsers(); // Recargar la lista de silenciados
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    alert(`Error al quitar silencio: ${error.message}`);
                }
            }
        }
    });

    // Manejador de eventos para las pestañas
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetPanelId = tab.dataset.target;
            panels.forEach(panel => {
                panel.classList.toggle('hidden', panel.id !== targetPanelId);
            });
             // Recargar datos al cambiar de pestaña
            if (targetPanelId === 'banned-users-panel') fetchBannedUsers();
            if (targetPanelId === 'reports-panel') fetchReports();
            if (targetPanelId === 'muted-users-panel') fetchMutedUsers();
        });
    });

    // Cargar datos iniciales
    fetchBannedUsers();
});
