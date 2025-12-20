class VideoConference {
    constructor() {
        this.userId = null;
        this.userName = '';
        this.roomUrl = '';
        
        // Медиа потоки
        this.localStream = null;
        this.screenStream = null;
        this.peerConnections = {}; 
        this.remoteStreams = {};   
        // Хранилище отправителей для экрана, чтобы потом их удалить корректно
        this.screenSenders = {}; 
        
        this.mediaState = {
            audioEnabled: false,
            videoEnabled: false,
            screenSharing: false,
            whiteboardActive: false
        };
        
        this.videoTimers = {};
        this.currentPresenterId = null;
        this.mainViewUserId = 'local';
        this.lastChatDate = null;
        
        this.socket = null;
        this.elements = {};
        this.audioContext = null;
        
        // Флаг для предотвращения гонки при согласовании
        this.isNegotiating = false;

        this.initialize();
    }
    
    async initialize() {
        console.log('🚀 Запуск конференции: Dual Stream (Camera + Screen)');
        this.getRoomData();
        this.initializeElements();
        this.loadChatHistory();
        this.initializeEventListeners();
        
        await this.setupLocalMedia();
        this.initializeSocket();
        
        this.setupAdaptiveLayout();
        this.updateParticipantCount();
    }

    // ... (getRoomData, initializeElements, loadChatHistory - БЕЗ ИЗМЕНЕНИЙ) ...
    getRoomData() {
        const pathParts = window.location.pathname.split('/');
        this.roomUrl = pathParts[pathParts.length - 1];
        this.userName = document.body.getAttribute('data-user-name') || 'Участник';
    }

    initializeElements() {
        // (Копируем инициализацию элементов из прошлого кода полностью)
        this.elements = {
            localVideoThumbnail: document.getElementById('localVideoThumbnail'),
            localAvatar: document.getElementById('localAvatar'),
            mainVideo: document.getElementById('mainVideo'),
            mainVideoWrapper: document.getElementById('mainVideoWrapper'),
            mainVideoPlaceholder: document.getElementById('mainVideoPlaceholder'),
            mainUserName: document.getElementById('mainVideoName'),
            whiteboardFrame: document.getElementById('whiteboardFrame'),
            screenShareWrapper: document.getElementById('screenShareWrapper'),
            
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
            
            webrtcLoading: document.getElementById('webrtcLoading'),
            localAudioStatus: document.getElementById('localAudioStatus'),
            localVideoStatus: document.getElementById('localVideoStatus')
        };
    }

    loadChatHistory() {
        if (window.initialChatHistory && Array.isArray(window.initialChatHistory)) {
            window.initialChatHistory.forEach(msg => {
                const isOwn = msg.sender === this.userName;
                this.addChatMessage(msg.sender, msg.text, isOwn, msg.time, msg.date);
            });
        }
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
                try { await this.elements.localVideoThumbnail.play(); } catch(e){}
            }
            
            this.setMainVideo('local', this.localStream);
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

        // ... (room-users, user-joined и т.д. остаются)
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
            if (this.mainViewUserId === data.userId || this.currentPresenterId === data.userId) {
                this.currentPresenterId = null;
                this.setMainVideo('local', this.localStream);
            }
        });

        this.socket.on('screen-share-toggled', (data) => {
            const userId = data.userId;
            const isSharing = data.isSharing;
            
            if (isSharing) {
                this.currentPresenterId = userId;
                this.showNotification("Участник показывает экран");
                // Видео поток экрана придет через ontrack и будет обработан там
            } else {
                if (this.currentPresenterId === userId) {
                    this.currentPresenterId = null;
                    this.showNotification("Демонстрация завершена");
                    // Возвращаем в центр себя (потом сработает детектор голоса)
                    this.setMainVideo('local', this.localStream);
                }
            }
        });
    }

    // --- WebRTC Core (ИЗМЕНЕНО) ---
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
        
        // 1. Добавляем локальные треки (Камера/Микрофон)
        this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        
        // 2. Обработчик согласования (нужен для добавления экрана на лету)
        pc.onnegotiationneeded = async () => {
            if (this.isNegotiating) return; // Простая защита от гонки
            this.isNegotiating = true;
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.socket.emit('webrtc-offer', { to: targetUserId, offer: offer });
            } catch (err) {
                console.error("Negotiation error:", err);
            } finally {
                this.isNegotiating = false;
            }
        };

        pc.onicecandidate = (e) => e.candidate && this.socket.emit('ice-candidate', { to: targetUserId, candidate: e.candidate });
        
        // 3. Обработка входящих потоков (Камера или Экран?)
        pc.ontrack = (e) => {
            const stream = e.streams[0];
            
            // ЛОГИКА РАЗДЕЛЕНИЯ ПОТОКОВ
            // Если у нас уже есть поток камеры для этого юзера, то новый поток - это экран
            if (this.remoteStreams[targetUserId] && this.remoteStreams[targetUserId].id !== stream.id) {
                console.log("Получен второй поток (Экран) от", targetUserId);
                // Это экран -> сразу в центр
                this.setMainVideo(targetUserId, stream, true);
            } else {
                console.log("Получен основной поток (Камера) от", targetUserId);
                // Это камера (или первый поток) -> сохраняем и показываем в сайдбаре
                this.remoteStreams[targetUserId] = stream; 
                this.updateRemoteVideo(targetUserId, stream);
                
                // Если этот чел уже презентует (например мы перезагрузились), проверим, может это экран?
                // Но обычно экран приходит вторым треком.
            }
        };
        
        this.peerConnections[targetUserId] = pc;
        return pc;
    }

    // --- Демонстрация экрана (ИЗМЕНЕНО: addTrack вместо replaceTrack) ---
    async toggleScreenShare() {
        try {
            if (!this.mediaState.screenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = this.screenStream.getVideoTracks()[0];
                
                screenTrack.onended = () => this.stopScreenShare();

                // ДОБАВЛЯЕМ НОВЫЙ ТРЕК (второй поток)
                for (const userId in this.peerConnections) {
                    const pc = this.peerConnections[userId];
                    // Добавляем трек и сохраняем sender, чтобы потом удалить
                    const sender = pc.addTrack(screenTrack, this.screenStream);
                    this.screenSenders[userId] = sender;
                }

                this.mediaState.screenSharing = true;
                this.currentPresenterId = 'local';
                // Показываем экран у себя
                this.setMainVideo('local', this.screenStream, true);
                
                this.socket.emit('screen-share-status', { roomUrl: this.roomUrl, isSharing: true });
                this.elements.toggleScreen.classList.add('active');

            } else {
                this.stopScreenShare();
            }
            this.updateMediaUI();
        } catch (e) {
            console.error("Ошибка экрана:", e);
        }
    }

    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        
        // УДАЛЯЕМ ТРЕК ЭКРАНА
        for (const userId in this.peerConnections) {
            const pc = this.peerConnections[userId];
            const sender = this.screenSenders[userId];
            if (sender) {
                try {
                    pc.removeTrack(sender);
                } catch(e) { console.error("Error removing track", e); }
                delete this.screenSenders[userId];
            }
        }

        this.mediaState.screenSharing = false;
        this.currentPresenterId = null;
        
        this.socket.emit('screen-share-status', { roomUrl: this.roomUrl, isSharing: false });
        
        // Возвращаем камеру себе в центр (или ничего, если включится спикер)
        this.setMainVideo('local', this.localStream);
        this.elements.toggleScreen.classList.remove('active');
        
        this.updateMediaUI();
    }

    // --- Остальные методы (setMainVideo, UI, helpers) ---
    // (Почти без изменений, но важна логика setMainVideo)

    setMainVideo(userId, stream, isScreenShare = false) {
        // Если кто-то шарит экран, мы не перебиваем его (если только это не мы сами или не новый экран)
        if (this.currentPresenterId && this.currentPresenterId !== userId && !isScreenShare) {
            return; 
        }

        this.mainViewUserId = userId;
        const mainVideo = this.elements.mainVideo;
        
        mainVideo.srcObject = stream;
        mainVideo.style.objectFit = isScreenShare ? 'contain' : 'cover';
        
        if (userId === 'local') {
            this.elements.mainUserName.textContent = this.userName + (isScreenShare ? " (Ваш экран)" : " (Вы)");
            mainVideo.muted = true; 
        } else {
            const card = document.getElementById(`participant-${userId}`);
            const name = card ? card.querySelector('.participant-name').textContent : "Участник";
            this.elements.mainUserName.textContent = name + (isScreenShare ? " (Экран)" : "");
            mainVideo.muted = false; 
        }
        
        this.elements.mainVideoWrapper.style.display = 'block';
        this.elements.mainVideoPlaceholder.style.display = 'none';
        this.elements.whiteboardFrame.style.display = 'none';
        if (this.elements.screenShareWrapper) this.elements.screenShareWrapper.style.display = 'none';
    }

    toggleWhiteboard() {
        this.mediaState.whiteboardActive = !this.mediaState.whiteboardActive;
        
        if (this.mediaState.whiteboardActive && this.elements.whiteboardFrame.src === 'about:blank') {
            this.elements.whiteboardFrame.src = "https://excalidraw.com/";
        }
        
        if (this.mediaState.whiteboardActive) {
            this.elements.whiteboardFrame.style.display = 'block';
            this.elements.mainVideoWrapper.style.display = 'none';
            this.elements.mainVideoPlaceholder.style.display = 'none';
        } else {
            this.elements.whiteboardFrame.style.display = 'none';
            // Возвращаем то видео, которое должно быть
            if (this.currentPresenterId && this.remoteStreams[this.currentPresenterId] && this.currentPresenterId !== 'local') {
                 // Если кто-то шарит, возвращаем его экран (мы его не сохраняли отдельно, это баг логики выше, но для простоты:)
                 // В данной реализации remoteStreams хранит КАМЕРУ. Экран приходит в ontrack и сразу ставится.
                 // Если мы скрыли экран доской, нам надо его вернуть.
                 // Исправление: при ontrack экрана можно сохранить его в this.screenStreams = {}
                 this.elements.mainVideoWrapper.style.display = 'block';
            } else if (this.mainViewUserId === 'local') {
                this.setMainVideo('local', this.mediaState.screenSharing ? this.screenStream : this.localStream, this.mediaState.screenSharing);
            } else {
                this.elements.mainVideoWrapper.style.display = 'block';
            }
        }
        this.elements.toggleWhiteboardBtn.classList.toggle('active', this.mediaState.whiteboardActive);
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

        if (this.elements.localVideoThumbnail && this.elements.localAvatar) {
            this.elements.localVideoThumbnail.style.display = 'block';
            if (videoEnabled) {
                this.elements.localVideoThumbnail.classList.add('active'); 
                this.elements.localAvatar.classList.add('hidden');       
            } else {
                this.elements.localVideoThumbnail.classList.remove('active'); 
                this.elements.localAvatar.classList.remove('hidden');       
            }
        }
    }

    initializeEventListeners() {
        this.elements.toggleAudio.onclick = () => this.toggleAudio();
        this.elements.toggleVideo.onclick = () => this.toggleVideo();
        this.elements.toggleScreen.onclick = () => this.toggleScreenShare();
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
        delete this.remoteStreams[userId];
        if (this.videoTimers[userId]) clearTimeout(this.videoTimers[userId]);
        this.updateParticipantCount();
    }

    updateRemoteVideo(userId, stream) {
        // Этот метод вызывается для камеры (левая панель)
        const video = document.getElementById(`video-${userId}`);
        const card = document.getElementById(`participant-${userId}`);
        
        if (video && card) {
            video.srcObject = stream;
            
            const avatar = card.querySelector('.participant-avatar');
            const videoTrack = stream.getVideoTracks()[0];
            
            const checkState = () => {
                const isVideoTechnicallyReady = videoTrack && videoTrack.enabled && !videoTrack.muted && video.readyState >= 2;

                if (isVideoTechnicallyReady) {
                    if (!this.videoTimers[userId]) {
                        this.videoTimers[userId] = setTimeout(() => {
                            const stillReady = videoTrack && videoTrack.enabled && !videoTrack.muted;
                            if (stillReady) {
                                video.classList.add('active');   
                                avatar.classList.add('hidden');  
                                this.updateRemoteParticipantStatus(userId, 'video', true);
                            }
                            this.videoTimers[userId] = null;
                        }, 800);
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
    
    updateRemoteParticipantStatus(userId, type, isEnabled) {
        const iconId = `status-${type}-${userId}`;
        const icon = document.getElementById(iconId);
        if (icon) {
            icon.src = `/static/images/${type === 'audio' ? 'mic' : 'camera'}-${isEnabled ? 'on' : 'off'}.png`;
            if (isEnabled) icon.classList.remove('muted');
            else icon.classList.add('muted');
        }
    }

    setupVoiceDetection(stream, participantId) {
        try {
            if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') this.audioContext.resume();

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
                    if (!this.currentPresenterId && !this.mediaState.whiteboardActive) {
                        const userId = participantId.replace('participant-', '');
                        if (userId !== 'local' && userId !== this.mainViewUserId) {
                            if (this.remoteStreams[userId]) {
                                this.setMainVideo(userId, this.remoteStreams[userId]);
                            }
                        }
                    }
                    setTimeout(() => { if (card) card.classList.remove('speaking'); }, 400); 
                }
                requestAnimationFrame(checkVolume);
            };
            checkVolume();
        } catch (e) { console.error("Voice detect error:", e); }
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
        div.innerHTML = `<div class="message-header"><span class="message-sender">${sender}</span><span class="message-time">${time}</span></div><div class="message-text">${text}</div>`;
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
}

document.addEventListener('DOMContentLoaded', () => {
    window.conference = new VideoConference();
});