export function initChatInput() {
    let recordingStartTime;
    let recordingInterval;
    let sendButton = document.getElementById('send-icon-button');
    let hasMicPermission = false; // Variable para rastrear el estado del permiso

    function resetAudioRecorderUI() {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
        }
        if (state.audioStream) {
            state.audioStream.getTracks().forEach(track => track.stop());
        }
        clearInterval(recordingInterval);
        
        dom.form.classList.remove('is-recording');
        const recordingControls = document.getElementById('audio-recording-controls');
        const recordButton = document.getElementById('record-audio-button');
        
        if (recordButton) recordButton.classList.remove('hidden');
        if (recordingControls) recordingControls.classList.add('hidden');

        dom.input.disabled = false;
        if(sendButton) sendButton.disabled = false;
        document.getElementById('image-upload').disabled = false;
        dom.emojiButton.disabled = false;

        state.audioChunks = [];
        state.audioBlob = null;
        state.mediaRecorder = null;
        state.audioStream = null;
    }

    // =========================================================================
    // ===                    INICIO DE LA CORRECCIÓN CLAVE                    ===
    // =========================================================================
    async function handleMicClick() {
        if (!state.currentChatContext.with || state.currentChatContext.type === 'none') {
            alert('Selecciona una sala o chat privado para enviar notas de voz.');
            return;
        }

        // Si ya tenemos permiso, iniciamos la grabación directamente.
        if (hasMicPermission) {
            startRecording();
            return;
        }

        // Si no, pedimos permiso primero.
        try {
            // Pedimos el stream solo para verificar el permiso.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Si llegamos aquí, el permiso fue concedido.
            hasMicPermission = true;
            // Cerramos este stream de prueba inmediatamente.
            stream.getTracks().forEach(track => track.stop());
            
            // Ahora que tenemos permiso, llamamos a la función de grabar.
            startRecording();

        } catch (err) {
            console.error('Error al solicitar permiso de micrófono:', err);
            alert('No se pudo acceder al micrófono. Asegúrate de haber concedido el permiso en la configuración de tu navegador para este sitio.');
            hasMicPermission = false;
        }
    }

    async function startRecording() {
        try {
            state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const recordingControls = document.getElementById('audio-recording-controls');
            const recordButton = document.getElementById('record-audio-button');
            const stopBtn = document.getElementById('stop-recording-button');
            const sendBtn = document.getElementById('send-audio-button');
            const cancelBtn = document.getElementById('cancel-recording-button');
            
            dom.form.classList.add('is-recording');
            if (recordButton) recordButton.classList.add('hidden');
            if (recordingControls) recordingControls.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (sendBtn) sendBtn.classList.add('hidden');
            if (cancelBtn) cancelBtn.classList.remove('hidden');

            dom.input.disabled = true;
            if(sendButton) sendButton.disabled = true;
            document.getElementById('image-upload').disabled = true;
            dom.emojiButton.disabled = true;

            const options = { mimeType: 'audio/webm; codecs=opus' };
            state.mediaRecorder = new MediaRecorder(state.audioStream, options);
            state.audioChunks = [];

            state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) state.audioChunks.push(event.data);
            };

            state.mediaRecorder.onstop = () => {
                const blobOptions = { type: 'audio/webm' };
                state.audioBlob = new Blob(state.audioChunks, blobOptions);
                if(stopBtn) stopBtn.classList.add('hidden');
                if(sendBtn) sendBtn.classList.remove('hidden');
            };

            state.mediaRecorder.start();
            
            recordingStartTime = Date.now();
            const timer = document.getElementById('recording-timer');
            if(timer) timer.textContent = '00:00';
            recordingInterval = setInterval(() => {
                if (!timer) return;
                const elapsed = Date.now() - recordingStartTime;
                const seconds = String(Math.floor(elapsed / 1000) % 60).padStart(2, '0');
                const minutes = String(Math.floor(elapsed / (1000 * 60))).padStart(2, '0');
                timer.textContent = `${minutes}:${seconds}`;
            }, 1000);

        } catch (err) {
            console.error('Error al iniciar la grabación:', err);
            alert('Hubo un problema al iniciar la grabación, por favor intenta de nuevo.');
            resetAudioRecorderUI();
        }
    }

    function stopRecording() {
        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.stop();
            clearInterval(recordingInterval);
        }
    }

    const recordButton = document.getElementById('record-audio-button');
    const stopRecordingButton = document.getElementById('stop-recording-button');
    const cancelRecordingButton = document.getElementById('cancel-recording-button');
    const sendAudioButton = document.getElementById('send-audio-button');

    // El botón de micrófono ahora llama a nuestra función manejadora
    if(recordButton) recordButton.addEventListener('click', handleMicClick);
    
    // El resto de listeners no cambian
    if(stopRecordingButton) stopRecordingButton.addEventListener('click', stopRecording);
    if(cancelRecordingButton) cancelRecordingButton.addEventListener('click', resetAudioRecorderUI);
    if(sendAudioButton) sendAudioButton.addEventListener('click', () => {
        if (state.audioBlob) {
            const fileName = `audio-${Date.now()}.webm`;
            handleFileUpload(new File([state.audioBlob], fileName, { type: state.audioBlob.type }));
            resetAudioRecorderUI();
        }
    });

    dom.input.addEventListener('input', () => {
        handleTypingIndicator();
        handleNickSuggestions();
    });

    dom.form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    dom.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dom.commandSuggestions.classList.add('hidden');
            state.suggestionState.list = [];
        }
        if (e.key === 'Tab' && state.suggestionState.list.length > 0) {
            e.preventDefault();
            autocompleteNick(state.suggestionState.list[0].nick);
        }
    });

    dom.imageUpload.addEventListener('change', (e) => {
        handleFileUpload(e.target.files[0]);
        e.target.value = '';
    });
    
    let emojisInitialized = false;
    dom.emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!emojisInitialized) {
            const emojis = [
                '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', 
                '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🤲', '🙏', '🤝',
                '❤️', '💔', '🔥', '✨', '⭐', '🎉', '🎈', '🎁', '🎂', '🍕', '🍔', '🍟', '🍿', '☕', '🍺', '🍷',
                '💯', '✅', '❌', '⚠️', '❓', '❗', '💀', '💩', '🤡', '👻', '👽', '👾', '🤖'
            ];
            dom.emojiPicker.innerHTML = '';
            emojis.forEach(emoji => {
                const span = document.createElement('span');
                span.textContent = emoji;
                span.addEventListener('click', () => { dom.input.value += emoji; dom.input.focus(); });
                dom.emojiPicker.appendChild(span);
            });
            emojisInitialized = true;
        }
        dom.emojiPicker.classList.toggle('hidden');
    });
    
    document.addEventListener('click', (e) => { 
        if (dom.emojiPicker && !dom.emojiPicker.contains(e.target) && e.target !== dom.emojiButton) {
            dom.emojiPicker.classList.add('hidden');
        }
    }, true);

    dom.cancelReplyButton.addEventListener('click', hideReplyContextBar);
}
// =========================================================================
// ===                     FIN DE LA CORRECCIÓN CLAVE                    ===
// =========================================================================