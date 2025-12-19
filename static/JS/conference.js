class VideoConference {
    constructor() {
        this.userId = null;
        this.lastChatDate = null;
        this.userName = '';
        this.roomUrl = '';
        
        this.localStream = null;
        this.screenStream = null;
        this.peerConnections = {}; 
        this.remoteStreams = {};   
        
        // Таймеры для фикса черного экрана
        this.videoTimers = {}; 
        
        this.mediaState = {
            audioEnabled: false,
            videoEnabled: false,
            screenSharing: false,
            whiteboardActive: false
        };
        
        this.socket = null;
        this.elements = {};
        
        this.initialize();
    }
    
    async initialize() {
        console.log('🚀 Запуск конфигурации (Стабильная версия)');
        this.getRoomData();
        this.initializeElements();

        this.loadChatHistory();
        
        this.initializeEventListeners();
        
        await this.setupLocalMedia();
        this.initializeSocket();
        
        this.setupAdaptiveLayout();
        this.updateParticipantCount();
    }

    loadChatHistory() {
        if (window.initialChatHistory && Array.isArray(window.initialChatHistory)) {
            window.initialChatHistory.forEach(msg => {
                const isOwn = msg.sender === this.userName;
                this.addChatMessage(msg.sender, msg.text, isOwn, msg.time, msg.date);
            });
        }
    }

    getRoomData() {
        const pathParts = window.location.pathname.split('/');
        this.roomUrl = pathParts[pathParts.length - 1];
        this.userName = document.body.getAttribute('data-user-name') || 'Участник';
    }

    initializeElements() {
        this.elements = {
            localVideoThumbnail: document.getElementById('localVideoThumbnail'),
            localAvatar: document.getElementById('localAvatar'),
            mainVideo: document.getElementById('mainVideo'),
            mainVideoWrapper: document.getElementById('mainVideoWrapper'),
            mainVideoPlaceholder: document.getElementById('mainVideoPlaceholder'),
            
            toggleAudio: document.getElementById('toggleAudio'),
            toggleVideo: document.getElementById('toggleVideo'),
            toggleScreen: document.getElementById('toggleScreen'),
            toggleWhiteboardBtn: document.getElementById('toggleWhiteboardBtn'),
            toggleChatBtn: document.getElementById('toggleChatBtn'),
            leaveCall: document.getElementById('leaveCall'),
            
            toggleAudioIcon: document.getElementById('toggleAudioIcon'),
            toggleVideoIcon: document.getElementById('toggleVideoIcon'),
            toggleScreenIcon: document.getElementById('toggleScreenIcon'),
            
            videoParticipantsList: document.getElementById('videoParticipantsList'),
            participantCount: document.getElementById('participantCount'),
            leftPanel: document.getElementById('leftPanel'),
            centerPanel: document.getElementById('centerPanel'),
            expandLeftPanel: document.getElementById('expandLeftPanel'),
            chatSidebar: document.getElementById('chatSidebar'),
            participantsSidebar: document.getElementById('participantsListSidebar'),
            chatMessages: document.getElementById('chatMessages'),
            chatInput: document.getElementById('chatInput'),
            sendMessage: document.getElementById('sendMessage'),
            participantsListSidebar: document.getElementById('participantsList'),

            whiteboardFrame: document.getElementById('whiteboardFrame'), 
            screenShareVideo: document.getElementById('screenShareVideo'),
            screenShareWrapper: document.getElementById('screenShareWrapper'),
            
            webrtcLoading: document.getElementById('webrtcLoading'),
            localAudioStatus: document.getElementById('localAudioStatus'),
            localVideoStatus: document.getElementById('localVideoStatus')
        };
    }

    async setupLocalMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { width: 1280, height: 720 }
            });
            
            this.localStream.getAudioTracks().forEach(t => t.enabled = false);
            this.localStream.getVideoTracks().forEach(t => t.enabled = false);

            if (this.elements.localVideoThumbnail) {
                this.elements.localVideoThumbnail.srcObject = this.localStream;
                this.elements.localVideoThumbnail.muted = true;
            }
            if (this.elements.mainVideo) {
                this.elements.mainVideo.srcObject = this.localStream;
                this.elements.mainVideo.muted = true;
            }

            this.setupVoiceDetection(this.localStream, 'participant-local');
            this.updateMediaUI();
        } catch (e) {
            console.error("❌ Ошибка медиа:", e);
            this.localStream = new MediaStream();
        }
    }

    initializeSocket() {
        this.socket = io({ transports: ['websocket'] });

        this.socket.on('connect', () => {
            this.userId = this.socket.id;
            this.socket.emit('join-room', { roomUrl: this.roomUrl, userName: this.userName });
        });

        this.socket.on('room-users', async (data) => {
            const otherUsers = data.users.filter(u => u.id !== this.socket.id);
            for (const user of otherUsers) {
                this.addRemoteParticipant(user.id, user.name);
                await this.initiateCall(user.id);
            }
            this.hideLoading();
            this.updateParticipantCount();
        });

        this.socket.on('user-joined', (data) => {
            this.addRemoteParticipant(data.userId, data.userName);
            this.updateParticipantCount();
            this.showNotification(`${data.userName} присоединился`);
        });

        this.socket.on('new-chat-message', (data) => {
            this.addChatMessage(data.sender, data.text, false, data.time, data.date);
            if (this.elements.chatSidebar.style.display === 'none') {
                 this.showNotification(`Сообщение от ${data.sender}`);
                 this.elements.toggleChatBtn.classList.add('active'); 
            }
        });

        this.socket.on('media-toggled', (data) => {
            this.updateRemoteParticipantStatus(data.userId, data.type, data.enabled);
        });

        this.socket.on('webrtc-offer', async (data) => {
            await this.handleOffer(data.offer, data.from);
        });

        this.socket.on('webrtc-answer', async (data) => {
            const pc = this.peerConnections[data.from];
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        });

        this.socket.on('ice-candidate', async (data) => {
            const pc = this.peerConnections[data.from];
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        });

        this.socket.on('user-left', (data) => {
            this.removeParticipant(data.userId);
            this.showNotification(`${data.userName} покинул встречу`);
        });

        this.socket.on('whiteboard-updated', (data) => {
            this.mediaState.whiteboardActive = data.state;
            
            // Ссылка для iframe (Excalidraw collab)
            if (data.state && !this.elements.whiteboardFrame.src.includes('#room=')) {
                const collabUrl = `https://excalidraw.com/#room=${this.roomUrl.substring(0,20)},InsightRoomCollaborator`;
                this.elements.whiteboardFrame.src = collabUrl;
            }
            
            this.updateMainVideoDisplay();
            if (this.elements.toggleWhiteboardBtn) {
                this.elements.toggleWhiteboardBtn.classList.toggle('active', data.state);
            }
        });
    }

    async initiateCall(targetUserId) {
        const pc = this.createPeerConnection(targetUserId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socket.emit('webrtc-offer', { to: targetUserId, offer: offer });
    }

    async handleOffer(offer, fromUserId) {
        const pc = this.createPeerConnection(fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc-answer', { to: fromUserId, answer: answer });
    }

    createPeerConnection(targetUserId) {
        if (this.peerConnections[targetUserId]) return this.peerConnections[targetUserId];
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        pc.onicecandidate = (e) => e.candidate && this.socket.emit('ice-candidate', { to: targetUserId, candidate: e.candidate });
        pc.ontrack = (e) => this.updateRemoteVideo(targetUserId, e.streams[0]);
        this.peerConnections[targetUserId] = pc;
        return pc;
    }

    toggleWhiteboard() {
        const newState = !this.mediaState.whiteboardActive;
        this.socket.emit('toggle-whiteboard', {
            roomUrl: this.roomUrl,
            state: newState
        });
    }

    updateMainVideoDisplay() {
        const { whiteboardActive, screenSharing, videoEnabled } = this.mediaState;

        this.elements.whiteboardFrame.style.display = 'none';
        this.elements.screenShareWrapper.style.display = 'none';
        this.elements.mainVideoWrapper.style.display = 'none';
        this.elements.mainVideoPlaceholder.style.display = 'none';

        if (whiteboardActive) {
            this.elements.whiteboardFrame.style.display = 'block';
        } else if (screenSharing) {
            this.elements.screenShareWrapper.style.display = 'block';
        } else if (videoEnabled) {
            this.elements.mainVideoWrapper.style.display = 'block';
        } else {
            this.elements.mainVideoPlaceholder.style.display = 'flex';
        }
    }

    updateRemoteParticipantStatus(userId, type, isEnabled) {
        const iconId = `status-${type}-${userId}`;
        const icon = document.getElementById(iconId);
        if (icon) {
            icon.src = `/static/images/${type === 'audio' ? 'mic' : 'camera'}-${isEnabled ? 'on' : 'off'}.png`;
            if (isEnabled) icon.classList.remove('muted');
            else icon.classList.add('muted');
        }
        
        // Логика переключения Видео <-> Аватарка (для ручного переключения кнопки)
        if (type === 'video') {
            const card = document.getElementById(`participant-${userId}`);
            if (card) {
                // Мы не меняем display, мы меняем классы active/hidden
                // Но этот метод вызывается также при входе, так что тут аккуратно
            }
        }
    }

    toggleAudio() {
        this.mediaState.audioEnabled = !this.mediaState.audioEnabled;
        this.localStream.getAudioTracks().forEach(t => t.enabled = this.mediaState.audioEnabled);
        this.updateMediaUI();
        this.socket.emit('toggle-media', { roomUrl: this.roomUrl, type: 'audio', enabled: this.mediaState.audioEnabled });
    }

    toggleVideo() {
        this.mediaState.videoEnabled = !this.mediaState.videoEnabled;
        this.localStream.getVideoTracks().forEach(t => t.enabled = this.mediaState.videoEnabled);
        this.updateMediaUI();
        this.updateMainVideoDisplay();
        this.socket.emit('toggle-media', { roomUrl: this.roomUrl, type: 'video', enabled: this.mediaState.videoEnabled });
    }

    updateMediaUI() {
        const { audioEnabled, videoEnabled, screenSharing } = this.mediaState;
        
        this.elements.toggleAudio.classList.toggle('muted', !audioEnabled);
        this.elements.toggleAudioIcon.src = `/static/images/mic-${audioEnabled ? 'on' : 'off'}.png`;
        this.elements.localAudioStatus.src = `/static/images/mic-${audioEnabled ? 'on' : 'off'}.png`;

        this.elements.toggleVideo.classList.toggle('muted', !videoEnabled);
        this.elements.toggleVideoIcon.src = `/static/images/camera-${videoEnabled ? 'on' : 'off'}.png`;
        this.elements.localVideoStatus.src = `/static/images/camera-${videoEnabled ? 'on' : 'off'}.png`;

        this.elements.toggleScreen.classList.toggle('active', screenSharing);

        this.elements.localVideoThumbnail.style.display = videoEnabled ? 'block' : 'none';
        this.elements.localAvatar.style.display = videoEnabled ? 'none' : 'flex';
    }

    initializeEventListeners() {
        this.elements.toggleAudio.onclick = () => this.toggleAudio();
        this.elements.toggleVideo.onclick = () => this.toggleVideo();
        this.elements.toggleScreen.onclick = () => this.toggleScreenShare(); // Функция экрана есть, но в этом коде она была старой (getDisplayMedia)
        this.elements.toggleWhiteboardBtn.onclick = () => this.toggleWhiteboard();
        this.elements.toggleChatBtn.onclick = () => this.toggleChat();
        this.elements.sendMessage.onclick = () => this.sendChatMessage();
        this.elements.leaveCall.onclick = () => this.leaveConference();
        this.elements.expandLeftPanel.onclick = () => this.toggleLeftPanel();
        
        this.elements.chatInput.onkeypress = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        };
    }

    addRemoteParticipant(userId, userName) {
        if (document.getElementById(`participant-${userId}`)) return;
        
        const initials = userName.slice(0, 2).toUpperCase();
        
        const card = document.createElement('div');
        card.className = 'video-participant-card remote-user';
        card.id = `participant-${userId}`;
        
        // ВАЖНО: Аватар и видео есть, управляем через CSS
        card.innerHTML = `
            <div class="video-placeholder">
                <video class="remote-video" autoplay playsinline id="video-${userId}"></video>
                <div class="participant-avatar">${initials}</div>
            </div>
            <div class="participant-name">${userName}</div>
            <div class="participant-status">
                <img src="/static/images/mic-off.png" alt="Микрофон" class="status-icon muted" id="status-audio-${userId}">
                <img src="/static/images/camera-off.png" alt="Камера" class="status-icon muted" id="status-video-${userId}">
            </div>
        `;
        this.elements.videoParticipantsList.appendChild(card);
        this.addParticipantToSidebarList(userId, userName);
    }

    addParticipantToSidebarList(userId, userName) {
        if (document.getElementById(`list-item-${userId}`)) return;
        const item = document.createElement('div');
        item.className = 'participant-list-item';
        item.id = `list-item-${userId}`;
        item.innerHTML = `<div class="participant-info"><div class="participant-details"><div class="participant-name">${userName}</div></div></div>`;
        if (this.elements.participantsListSidebar) this.elements.participantsListSidebar.appendChild(item);
    }

    removeParticipant(userId) {
        const videoCard = document.getElementById(`participant-${userId}`);
        if (videoCard) videoCard.remove();
        const listItem = document.getElementById(`list-item-${userId}`);
        if (listItem) listItem.remove();
        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }
        if (this.videoTimers[userId]) clearTimeout(this.videoTimers[userId]);
        this.updateParticipantCount();
    }

    updateRemoteVideo(userId, stream) {
        const video = document.getElementById(`video-${userId}`);
        const card = document.getElementById(`participant-${userId}`);
        
        if (video && card) {
            video.srcObject = stream;
            
            const avatar = card.querySelector('.participant-avatar');
            const videoTrack = stream.getVideoTracks()[0];
            
            // ФУНКЦИЯ ФИКСА ЧЕРНОГО ЭКРАНА С ЗАДЕРЖКОЙ
            const checkState = () => {
                const isVideoTechnicallyReady = videoTrack && videoTrack.enabled && !videoTrack.muted && video.readyState >= 2;

                if (isVideoTechnicallyReady) {
                    if (!this.videoTimers[userId]) {
                        this.videoTimers[userId] = setTimeout(() => {
                            const stillReady = videoTrack && videoTrack.enabled && !videoTrack.muted;
                            if (stillReady) {
                                video.classList.add('active');   // opacity: 1
                                avatar.classList.add('hidden');  // opacity: 0
                                this.updateRemoteParticipantStatus(userId, 'video', true);
                            }
                            this.videoTimers[userId] = null;
                        }, 800); // Задержка 0.8с
                    }
                } else {
                    if (this.videoTimers[userId]) {
                        clearTimeout(this.videoTimers[userId]);
                        this.videoTimers[userId] = null;
                    }
                    video.classList.remove('active');
                    avatar.classList.remove('hidden');
                    if (videoTrack && !videoTrack.enabled) {
                        this.updateRemoteParticipantStatus(userId, 'video', false);
                    }
                }
            };

            if (videoTrack) {
                videoTrack.onmute = checkState;
                videoTrack.onunmute = checkState;
                videoTrack.onended = checkState;
                video.onloadeddata = checkState;
                video.oncanplay = checkState;
                video.onplay = checkState;
                
                const interval = setInterval(() => {
                    if (!document.getElementById(`participant-${userId}`)) clearInterval(interval);
                    else checkState();
                }, 1000);
            }
            checkState();
        }
        
        if (stream.getAudioTracks().length > 0) {
            const audioTrack = stream.getAudioTracks()[0];
            this.updateRemoteParticipantStatus(userId, 'audio', audioTrack.enabled);
            this.setupVoiceDetection(stream, `participant-${userId}`);
        }
    }
    
    updateParticipantCount() {
        const count = document.querySelectorAll('.video-participant-card').length;
        if (this.elements.participantCount) this.elements.participantCount.textContent = `👥 ${count}`;
        const sidebarTitle = document.querySelector('.sidebar-title');
        if (sidebarTitle) sidebarTitle.textContent = `Участники (${count})`;
    }

    toggleChat() {
        const isVisible = this.elements.chatSidebar.style.display === 'flex';
        this.elements.chatSidebar.style.display = isVisible ? 'none' : 'flex';
        this.elements.participantsSidebar.style.display = isVisible ? 'flex' : 'none';
        this.elements.toggleChatBtn.classList.toggle('active', !isVisible);
    }

    sendChatMessage() {
        const val = this.elements.chatInput.value.trim();
        if (val) {
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            const dateStr = now.toLocaleDateString('ru-RU');
            this.addChatMessage('Вы', val, true, timeStr, dateStr);
            this.socket.emit('chat-message', { roomUrl: this.roomUrl, text: val });
            this.elements.chatInput.value = '';
        }
    }

    addChatMessage(sender, text, isOwn, time = '', date = null) {
        const chatContainer = this.elements.chatMessages;
        const msgDate = date || new Date().toLocaleDateString('ru-RU');
        if (this.lastChatDate !== msgDate) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'chat-date-separator';
            dateDiv.innerHTML = `<span>${msgDate}</span>`;
            chatContainer.appendChild(dateDiv);
            this.lastChatDate = msgDate;
        }
        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own-message' : 'remote-message'}`;
        div.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${text}</div>
        `;
        chatContainer.appendChild(div);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    toggleLeftPanel() {
        this.elements.leftPanel.classList.toggle('collapsed');
        this.elements.centerPanel.classList.toggle('expanded');
    }

    showNotification(m) {
        const n = document.createElement('div');
        n.className = 'media-notification';
        n.textContent = m;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3000);
    }

    hideLoading() { if (this.elements.webrtcLoading) this.elements.webrtcLoading.style.display = 'none'; }

    leaveConference() { 
        if (confirm('Выйти?')) {
            this.socket.disconnect();
            window.location.href = '/'; 
        }
    }

    setupAdaptiveLayout() {
        window.onresize = () => { if (window.innerWidth <= 768) this.elements.leftPanel.classList.add('collapsed'); };
    }

    setupVoiceDetection(stream, participantId) {
        try {
            if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            source.connect(analyser);
            const checkVolume = () => {
                const card = document.getElementById(participantId);
                if (!card) return requestAnimationFrame(checkVolume);
                analyser.getByteFrequencyData(dataArray);
                let values = 0;
                for (let i = 0; i < bufferLength; i++) values += dataArray[i];
                const average = values / bufferLength;
                if (average > 20) {
                    card.classList.add('speaking');
                    setTimeout(() => { if (card) card.classList.remove('speaking'); }, 400); 
                }
                requestAnimationFrame(checkVolume);
            };
            checkVolume();
        } catch (e) { console.error("Ошибка детектора голоса:", e); }
    }

    // --- Экран (без сложных проверок, просто заглушка на вызов метода) ---
    async toggleScreenShare() {
        try {
            if (!this.mediaState.screenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                this.elements.screenShareVideo.srcObject = this.screenStream;
                this.mediaState.screenSharing = true;
                this.screenStream.getVideoTracks()[0].onended = () => this.stopScreenShare();
            } else {
                this.stopScreenShare();
            }
            this.updateMediaUI();
            this.updateMainVideoDisplay();
        } catch (e) { console.error("Ошибка экрана:", e); }
    }
    
    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        this.mediaState.screenSharing = false;
        this.updateMediaUI();
        this.updateMainVideoDisplay();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.conference = new VideoConference();
});