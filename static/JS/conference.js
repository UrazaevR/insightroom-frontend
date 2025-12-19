// conference.js
class VideoConference {
    constructor() {
        // Состояние
        this.localStream = null;
        this.screenStream = null;
        this.mediaState = {
            audioEnabled: false,
            videoEnabled: false,
            screenSharing: false,
            whiteboardActive: false
        };
        
        // WebRTC
        this.peerConnections = {};
        this.remoteStreams = {};
        this.socket = null;
        this.roomUrl = null;
        this.userName = '';
        this.userId = null; // Уникальный ID пользователя
        this.yourSocketId = null;
        
        // Таймер встречи
        this.meetingStartTime = Date.now();
        this.meetingTimerInterval = null;
        
        // Анализ аудио
        this.audioContext = null;
        this.analyser = null;
        this.speakingCheckInterval = null;
        
        // Данные участников
        this.participants = {};
        this.remoteStatusIntervals = {};
        
        // Инициализация
        this.initializeElements();
        this.initializeEventListeners();
        this.generateUserId();
        this.initWebRTC();
        this.addLocalParticipant();
        this.startMeetingTimer();
        this.forceRedButtons();
        this.setupAdaptiveLayout();
    }

    initializeElements() {
        // Основные элементы
        this.mainVideo = document.getElementById('mainVideo');
        this.mainVideoPlaceholder = document.getElementById('mainVideoPlaceholder');
        this.screenShareVideo = document.getElementById('screenShareVideo');
        this.whiteboardFrame = document.getElementById('whiteboardFrame');
        this.mainUserAvatar = document.getElementById('mainUserAvatar');
        this.mainUserName = document.getElementById('mainUserName');
        
        // Левая панель - миниатюры
        this.videoParticipantsList = document.getElementById('videoParticipantsList');
        this.leftPanel = document.getElementById('leftPanel');
        this.toggleLeftPanelBtn = document.getElementById('toggleLeftPanel');
        this.expandLeftPanelBtn = document.getElementById('expandLeftPanel');
        
        // Правая панель - участники и чат
        this.participantsList = document.getElementById('participantsList');
        this.participantsSidebar = document.getElementById('participantsSidebar');
        this.chatSidebar = document.getElementById('chatSidebar');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.sendMessageBtn = document.getElementById('sendMessage');
        this.participantsTab = document.getElementById('participantsTab');
        this.chatTab = document.getElementById('chatTab');
        
        // Панель управления
        this.toggleAudioBtn = document.getElementById('toggleAudio');
        this.toggleVideoBtn = document.getElementById('toggleVideo');
        this.toggleScreenBtn = document.getElementById('toggleScreen');
        this.toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
        this.toggleWhiteboardMainBtn = document.getElementById('toggleWhiteboard');
        this.toggleChatViewBtn = document.getElementById('toggleChatView');
        this.leaveCallBtn = document.getElementById('leaveCall');
        
        // Информация о встрече
        this.participantCount = document.getElementById('participantCount');
        this.participantsCount = document.getElementById('participantsCount');
        this.meetingId = document.getElementById('meetingId');
        this.meetingTimer = document.getElementById('meetingTimer');
        
        // Данные пользователя
        this.userName = document.body.getAttribute('data-user-name') || 'Участник';
        
        // Получаем URL комнаты из пути
        const pathParts = window.location.pathname.split('/');
        this.roomUrl = pathParts[pathParts.length - 1];
    }

    generateUserId() {
        // Генерируем уникальный ID пользователя, сохраняем в localStorage
        let userId = localStorage.getItem('conference_user_id');
        if (!userId) {
            userId = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('conference_user_id', userId);
        }
        this.userId = userId;
    }

    initializeEventListeners() {
        // Панель управления
        this.toggleAudioBtn.addEventListener('click', () => this.toggleAudio());
        this.toggleVideoBtn.addEventListener('click', () => this.toggleVideo());
        this.toggleScreenBtn.addEventListener('click', () => this.toggleScreenShare());
        this.toggleWhiteboardBtn.addEventListener('click', () => this.toggleWhiteboard());
        this.toggleWhiteboardMainBtn.addEventListener('click', () => this.toggleWhiteboard());
        this.toggleChatViewBtn.addEventListener('click', () => this.toggleChatView());
        this.leaveCallBtn.addEventListener('click', () => this.leaveConference());
        
        // Левая панель
        if (this.toggleLeftPanelBtn) {
            this.toggleLeftPanelBtn.addEventListener('click', () => this.toggleLeftPanel());
        }
        if (this.expandLeftPanelBtn) {
            this.expandLeftPanelBtn.addEventListener('click', () => this.toggleLeftPanel());
        }
        
        // Правая панель - вкладки
        if (this.participantsTab) {
            this.participantsTab.addEventListener('click', () => this.switchTab('participants'));
        }
        if (this.chatTab) {
            this.chatTab.addEventListener('click', () => this.switchTab('chat'));
        }
        
        // Чат
        if (this.sendMessageBtn) {
            this.sendMessageBtn.addEventListener('click', () => this.sendChatMessage());
        }
        if (this.chatInput) {
            this.chatInput.addEventListener('keypress', (e) => this.handleChatInputKeypress(e));
            this.chatInput.addEventListener('input', () => this.autoResizeTextarea());
        }
        
        // Обработка закрытия страницы
        window.addEventListener('beforeunload', () => this.cleanup());
        window.addEventListener('resize', () => this.handleResize());
    }

    async initWebRTC() {
        try {
            // Инициализация SocketIO
            this.socket = io();
            
            this.socket.on('connect', () => {
                console.log('✅ Подключен к серверу сигналинга');
                this.socket.emit('join-room', {
                    roomUrl: this.roomUrl,
                    userName: this.userName,
                    userId: this.userId
                });
            });
            
            this.socket.on('connected', (data) => {
                console.log('✅ Сокет подключен:', data);
                this.yourSocketId = data.sid;
            });
            
            this.socket.on('room-users', (data) => {
                console.log('👥 Текущие участники:', data.users);
                this.yourSocketId = data.yourId;
                
                // Добавляем существующих участников
                data.users.forEach(user => {
                    if (user.id !== this.userId && !this.participants[user.id]) {
                        this.addParticipant(user.id, user.name, false);
                        this.createPeerConnection(user.id, user.name);
                    }
                });
                
                this.updateParticipantCount();
            });
            
            this.socket.on('user-joined', (data) => {
                console.log('👤 Новый участник присоединился:', data);
                if (!this.participants[data.userId]) {
                    this.addParticipant(data.userId, data.userName, false);
                    this.createPeerConnection(data.userId, data.userName);
                    this.updateParticipantCount();
                    this.showNotification(`${data.userName} присоединился к встрече`);
                }
            });
            
            this.socket.on('user-left', (data) => {
                console.log('👋 Участник вышел:', data);
                this.removeParticipant(data.userId);
                this.removePeerConnection(data.userId);
                this.updateParticipantCount();
                this.showNotification(`${data.userName} покинул встречу`);
            });
            
            this.socket.on('webrtc-offer', async (data) => {
                console.log('📨 Получен OFFER от:', data.from);
                await this.handleOffer(data.offer, data.from);
            });
            
            this.socket.on('webrtc-answer', async (data) => {
                console.log('📨 Получен ANSWER от:', data.from);
                await this.handleAnswer(data.answer, data.from);
            });
            
            this.socket.on('ice-candidate', async (data) => {
                console.log('🧊 Получен ICE кандидат от:', data.from);
                await this.handleIceCandidate(data.candidate, data.from);
            });
            
            this.socket.on('media-state', (data) => {
                console.log('🎬 Обновление состояния медиа:', data);
                if (this.participants[data.userId]) {
                    this.participants[data.userId].audioEnabled = data.audioEnabled;
                    this.participants[data.userId].videoEnabled = data.videoEnabled;
                    this.updateParticipantUI(data.userId);
                }
            });
            
            this.socket.on('chat-history', (data) => {
                console.log('📜 История чата:', data.messages);
                if (data.messages && data.messages.length > 0) {
                    data.messages.forEach(msg => {
                        const isOwn = msg.user_id === this.userId;
                        this.addChatMessage(msg.user_name, msg.message, isOwn);
                    });
                }
            });
            
            this.socket.on('chat-message', (data) => {
                console.log('💬 Новое сообщение:', data);
                const isOwn = data.user_id === this.userId;
                this.addChatMessage(data.user_name, data.message, isOwn);
            });
            
            this.socket.on('error', (data) => {
                console.error('❌ Ошибка сокета:', data);
                this.showNotification(`Ошибка: ${data.message}`);
            });
            
        } catch (error) {
            console.error('❌ Ошибка инициализации WebRTC:', error);
            this.showNotification('Ошибка подключения к конференции');
        }
    }

    addLocalParticipant() {
        // Добавляем локального пользователя в данные
        this.participants[this.userId] = {
            id: this.userId,
            name: this.userName,
            audioEnabled: false,
            videoEnabled: false,
            stream: null,
            isLocal: true
        };
        
        // Добавляем в интерфейс
        this.addVideoThumbnail(this.userId, this.userName, true);
        this.addToParticipantsList(this.userId, this.userName, true);
        this.updateParticipantUI(this.userId);
    }

    async initializeMedia(requestAudio = false, requestVideo = false) {
        try {
            const constraints = {};
            
            if (requestVideo) {
                constraints.video = {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                };
            } else {
                constraints.video = false;
            }
            
            if (requestAudio) {
                constraints.audio = {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                };
            } else {
                constraints.audio = false;
            }
            
            console.log('🎬 Запрашиваем медиа с constraints:', constraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Если локальный поток уже существует, обновляем его
            if (this.localStream) {
                // Останавливаем старые треки
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            this.localStream = stream;
            
            // Обновляем состояние
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            
            if (audioTrack) {
                this.mediaState.audioEnabled = audioTrack.enabled;
                this.participants[this.userId].audioEnabled = audioTrack.enabled;
            }
            
            if (videoTrack) {
                this.mediaState.videoEnabled = videoTrack.enabled;
                this.participants[this.userId].videoEnabled = videoTrack.enabled;
                
                // Обновляем главное видео
                this.mainVideo.srcObject = this.localStream;
                this.mainVideo.play().catch(e => console.error('Ошибка воспроизведения:', e));
            }
            
            // Обновляем все PeerConnections
            Object.keys(this.peerConnections).forEach(userId => {
                this.updatePeerConnectionTracks(userId);
            });
            
            // Настраиваем анализ аудио
            if (this.mediaState.audioEnabled) {
                this.setupAudioAnalysis();
            }
            
            // Обновляем UI
            this.updateLocalParticipantUI();
            this.updateMainVideoDisplay();
            
            // Отправляем состояние медиа другим участникам
            this.sendMediaState();
            
            this.showNotification('Медиа устройства подключены');
            
        } catch (error) {
            console.error('❌ Ошибка доступа к медиа:', error);
            
            if (error.name === 'NotAllowedError') {
                this.showNotification('Доступ к камере/микрофону запрещен. Разрешите доступ в настройках браузера.');
            } else if (error.name === 'NotFoundError') {
                this.showNotification('Камера или микрофон не найдены.');
            } else {
                this.showNotification('Не удалось получить доступ к медиа устройствам: ' + error.message);
            }
        }
    }

    updatePeerConnectionTracks(userId) {
        const pc = this.peerConnections[userId];
        if (!pc || !this.localStream) return;
        
        // Получаем текущие отправители
        const senders = pc.getSenders();
        
        // Обновляем аудио трек
        const audioTrack = this.localStream.getAudioTracks()[0];
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        
        if (audioTrack) {
            if (audioSender) {
                audioSender.replaceTrack(audioTrack);
            } else {
                pc.addTrack(audioTrack, this.localStream);
            }
        } else if (audioSender) {
            pc.removeTrack(audioSender);
        }
        
        // Обновляем видео трек
        const videoTrack = this.localStream.getVideoTracks()[0];
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        
        if (videoTrack) {
            if (videoSender) {
                videoSender.replaceTrack(videoTrack);
            } else {
                pc.addTrack(videoTrack, this.localStream);
            }
        } else if (videoSender) {
            pc.removeTrack(videoSender);
        }
    }

    sendMediaState() {
        if (this.socket) {
            this.socket.emit('media-state', {
                userId: this.userId,
                roomUrl: this.roomUrl,
                audioEnabled: this.mediaState.audioEnabled,
                videoEnabled: this.mediaState.videoEnabled
            });
        }
    }

    async toggleAudio() {
        if (!this.localStream) {
            await this.initializeMedia(true, false);
            return;
        }
        
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            this.mediaState.audioEnabled = !audioTracks[0].enabled;
            audioTracks[0].enabled = this.mediaState.audioEnabled;
            this.participants[this.userId].audioEnabled = this.mediaState.audioEnabled;
            
            if (this.mediaState.audioEnabled) {
                this.setupAudioAnalysis();
            } else if (this.speakingCheckInterval) {
                clearInterval(this.speakingCheckInterval);
                this.speakingCheckInterval = null;
            }
            
            this.updateLocalParticipantUI();
            this.sendMediaState();
            
            this.showNotification(this.mediaState.audioEnabled ? 
                'Микрофон включён' : 'Микрофон выключен');
        } else {
            await this.initializeMedia(true, false);
        }
    }

    async toggleVideo() {
        if (!this.localStream) {
            await this.initializeMedia(false, true);
            return;
        }
        
        const videoTracks = this.localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            this.mediaState.videoEnabled = !videoTracks[0].enabled;
            videoTracks[0].enabled = this.mediaState.videoEnabled;
            this.participants[this.userId].videoEnabled = this.mediaState.videoEnabled;
            
            this.updateLocalParticipantUI();
            this.updateMainVideoDisplay();
            this.sendMediaState();
            
            this.showNotification(this.mediaState.videoEnabled ? 
                'Камера включена' : 'Камера выключена');
        } else {
            await this.initializeMedia(false, true);
        }
    }

    createPeerConnection(userId, userName) {
        if (this.peerConnections[userId]) {
            console.log('✅ PeerConnection уже существует для:', userId);
            return this.peerConnections[userId];
        }
        
        console.log('🔄 Создание нового PeerConnection для:', userName, '(' + userId + ')');
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };
        
        const peerConnection = new RTCPeerConnection(configuration);
        
        // Добавляем локальный поток если он есть
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
            console.log('✅ Локальные треки добавлены в PeerConnection');
        }
        
        // События WebRTC
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                console.log('🧊 Отправляем ICE кандидат для:', userId);
                this.socket.emit('ice-candidate', {
                    to: userId,
                    candidate: event.candidate,
                    from: this.userId
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            console.log('📹 Получен удаленный поток от:', userId);
            
            if (event.streams && event.streams[0]) {
                this.remoteStreams[userId] = event.streams[0];
                
                if (this.participants[userId]) {
                    this.participants[userId].stream = event.streams[0];
                    
                    // Обновляем видео элемент
                    const videoElement = document.querySelector(`#video-thumb-${userId} .remote-video`);
                    if (videoElement) {
                        videoElement.srcObject = event.streams[0];
                        videoElement.onloadedmetadata = () => {
                            videoElement.play().catch(e => 
                                console.error('Ошибка воспроизведения видео:', e)
                            );
                        };
                    }
                    
                    // Начинаем отслеживание статуса
                    this.startRemoteStatusMonitoring(userId, event.streams[0]);
                    
                    // Обновляем UI
                    this.updateParticipantUI(userId);
                }
            }
        };
        
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`🔗 Состояние ICE соединения с ${userId}:`, peerConnection.iceConnectionState);
            
            if (peerConnection.iceConnectionState === 'connected' || 
                peerConnection.iceConnectionState === 'completed') {
                console.log(`✅ P2P соединение установлено с ${userName}`);
            } else if (peerConnection.iceConnectionState === 'disconnected' ||
                       peerConnection.iceConnectionState === 'failed') {
                console.log(`❌ Проблемы с соединением с ${userName}`);
            }
        };
        
        peerConnection.onnegotiationneeded = async () => {
            console.log('🔄 Требуется переговоры для:', userId);
            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peerConnection.setLocalDescription(offer);
                
                if (this.socket) {
                    this.socket.emit('webrtc-offer', {
                        to: userId,
                        offer: offer,
                        from: this.userId
                    });
                    console.log('📨 Отправлен OFFER для:', userId);
                }
            } catch (error) {
                console.error('❌ Ошибка создания offer:', error);
            }
        };
        
        this.peerConnections[userId] = peerConnection;
        
        // Инициируем создание offer
        setTimeout(() => {
            if (peerConnection.signalingState === 'stable') {
                peerConnection.onnegotiationneeded();
            }
        }, 1000);
        
        return peerConnection;
    }

    async handleOffer(offer, fromUserId) {
        console.log('🔄 Обрабатываем OFFER от:', fromUserId);
        
        let peerConnection = this.peerConnections[fromUserId];
        if (!peerConnection) {
            const participant = this.participants[fromUserId];
            peerConnection = this.createPeerConnection(fromUserId, participant ? participant.name : 'Участник');
        }
        
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            if (this.socket) {
                this.socket.emit('webrtc-answer', {
                    to: fromUserId,
                    answer: answer,
                    from: this.userId
                });
                console.log('📨 Отправлен ANSWER для:', fromUserId);
            }
        } catch (error) {
            console.error('❌ Ошибка обработки offer:', error);
        }
    }

    async handleAnswer(answer, fromUserId) {
        console.log('🔄 Обрабатываем ANSWER от:', fromUserId);
        
        try {
            const peerConnection = this.peerConnections[fromUserId];
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✅ ANSWER установлен для:', fromUserId);
            } else {
                console.error('❌ PeerConnection не найден для answer от:', fromUserId);
            }
        } catch (error) {
            console.error('❌ Ошибка обработки answer:', error);
        }
    }

    async handleIceCandidate(candidate, fromUserId) {
        console.log('🔄 Обрабатываем ICE кандидат от:', fromUserId);
        
        try {
            const peerConnection = this.peerConnections[fromUserId];
            if (peerConnection && peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ ICE кандидат добавлен для:', fromUserId);
            } else {
                console.warn('⚠️ PeerConnection не готов для ICE кандидата от:', fromUserId);
            }
        } catch (error) {
            console.error('❌ Ошибка добавления ICE кандидата:', error);
        }
    }

    addVideoThumbnail(userId, userName, isLocal = false) {
        // Удаляем существующий элемент
        const existing = document.getElementById(`video-thumb-${userId}`);
        if (existing) existing.remove();
        
        const initials = userName ? userName.slice(0, 2).toUpperCase() : 'УЧ';
        const backgroundColor = this.getRandomColor(userName);
        const isSpeaking = isLocal ? false : (this.participants[userId]?.audioEnabled || false);
        
        const videoCard = document.createElement('div');
        videoCard.className = `video-participant-card ${isLocal ? 'local-user' : 'remote-user'} ${isSpeaking ? 'speaking' : ''}`;
        videoCard.id = `video-thumb-${userId}`;
        
        videoCard.innerHTML = `
            <div class="video-placeholder" style="background: ${backgroundColor}">
                <div class="participant-avatar">${initials}</div>
                <video class="remote-video" autoplay playsinline style="display: none;"></video>
            </div>
            <div class="participant-name">${userName} ${isLocal ? '(Вы)' : ''}</div>
            <div class="participant-status">
                <img src="/static/images/mic-off.png" alt="Микрофон" class="status-icon muted" id="audio-${userId}">
                <img src="/static/images/camera-off.png" alt="Камера" class="status-icon muted" id="video-${userId}">
            </div>
        `;
        
        this.videoParticipantsList.appendChild(videoCard);
    }

    addToParticipantsList(userId, userName, isLocal = false) {
        // Удаляем существующий элемент
        const existing = document.getElementById(`list-item-${userId}`);
        if (existing) existing.remove();
        
        const listItem = document.createElement('div');
        listItem.className = `participant-list-item ${isLocal ? 'local-user' : 'remote-user'}`;
        listItem.id = `list-item-${userId}`;
        
        listItem.innerHTML = `
            <div class="participant-info">
                <div class="participant-details">
                    <div class="participant-name">${userName} ${isLocal ? '(Вы)' : ''}</div>
                </div>
                <div class="participant-controls">
                    <img src="/static/images/mic-off.png" 
                        alt="Микрофон" class="status-icon" id="list-audio-${userId}">
                    <img src="/static/images/camera-off.png" 
                        alt="Камера" class="status-icon" id="list-video-${userId}">
                </div>
            </div>
        `;
        
        this.participantsList.appendChild(listItem);
    }

    updateLocalParticipantUI() {
        const participant = this.participants[this.userId];
        if (!participant) return;
        
        // Обновляем панель управления
        const audioIcon = this.mediaState.audioEnabled ? 'mic-on' : 'mic-off';
        const videoIcon = this.mediaState.videoEnabled ? 'camera-on' : 'camera-off';
        
        this.toggleAudioBtn.innerHTML = `<img src="/static/images/${audioIcon}.png" alt="Микрофон" class="control-icon">`;
        this.toggleVideoBtn.innerHTML = `<img src="/static/images/${videoIcon}.png" alt="Камера" class="control-icon">`;
        
        this.toggleAudioBtn.classList.toggle('muted', !this.mediaState.audioEnabled);
        this.toggleVideoBtn.classList.toggle('muted', !this.mediaState.videoEnabled);
        
        // Обновляем миниатюру
        this.updateVideoThumbnailUI(this.userId);
        
        // Обновляем список участников
        this.updateListParticipantUI(this.userId);
    }

    updateVideoThumbnailUI(userId) {
        const participant = this.participants[userId];
        if (!participant) return;
        
        const videoCard = document.getElementById(`video-thumb-${userId}`);
        if (!videoCard) return;
        
        // Обновляем индикаторы
        const audioIcon = document.getElementById(`audio-${userId}`);
        const videoIcon = document.getElementById(`video-${userId}`);
        
        if (audioIcon) {
            const audioSrc = participant.audioEnabled ? 
                '/static/images/mic-on.png' : 
                '/static/images/mic-off.png';
            audioIcon.src = audioSrc;
            audioIcon.classList.toggle('muted', !participant.audioEnabled);
        }
        
        if (videoIcon) {
            const videoSrc = participant.videoEnabled ? 
                '/static/images/camera-on.png' : 
                '/static/images/camera-off.png';
            videoIcon.src = videoSrc;
            videoIcon.classList.toggle('muted', !participant.videoEnabled);
        }
        
        // Обновляем видео элемент
        const videoElement = videoCard.querySelector('.remote-video');
        const placeholder = videoCard.querySelector('.video-placeholder');
        const avatar = videoCard.querySelector('.participant-avatar');
        
        if (videoElement && participant.stream) {
            if (participant.videoEnabled && participant.stream.getVideoTracks().length > 0) {
                placeholder.style.display = 'none';
                videoElement.style.display = 'block';
                avatar.style.display = 'none';
            } else {
                placeholder.style.display = 'flex';
                videoElement.style.display = 'none';
                avatar.style.display = 'flex';
            }
        }
        
        // Подсветка говорящего
        videoCard.classList.toggle('speaking', participant.audioEnabled && !participant.isLocal);
    }

    updateListParticipantUI(userId) {
        const participant = this.participants[userId];
        if (!participant) return;
        
        const listItem = document.getElementById(`list-item-${userId}`);
        if (!listItem) return;
        
        const audioIcon = document.getElementById(`list-audio-${userId}`);
        const videoIcon = document.getElementById(`list-video-${userId}`);
        
        if (audioIcon) {
            const audioSrc = participant.audioEnabled ? 
                '/static/images/mic-on.png' : 
                '/static/images/mic-off.png';
            audioIcon.src = audioSrc;
            audioIcon.classList.toggle('muted', !participant.audioEnabled);
        }
        
        if (videoIcon) {
            const videoSrc = participant.videoEnabled ? 
                '/static/images/camera-on.png' : 
                '/static/images/camera-off.png';
            videoIcon.src = videoSrc;
            videoIcon.classList.toggle('muted', !participant.videoEnabled);
        }
    }

    addParticipant(userId, userName, isLocal = false) {
        if (this.participants[userId]) return;
        
        this.participants[userId] = {
            id: userId,
            name: userName,
            audioEnabled: false,
            videoEnabled: false,
            stream: null,
            isLocal: isLocal
        };
        
        // Добавляем в интерфейс
        if (!isLocal) {
            this.addVideoThumbnail(userId, userName, false);
            this.addToParticipantsList(userId, userName, false);
        }
    }

    removeParticipant(userId) {
        // Удаляем из данных
        delete this.participants[userId];
        
        // Удаляем из левой панели
        const videoCard = document.getElementById(`video-thumb-${userId}`);
        if (videoCard) videoCard.remove();
        
        // Удаляем из правой панели
        const listItem = document.getElementById(`list-item-${userId}`);
        if (listItem) listItem.remove();
        
        // Останавливаем интервал отслеживания статуса
        if (this.remoteStatusIntervals[userId]) {
            clearInterval(this.remoteStatusIntervals[userId]);
            delete this.remoteStatusIntervals[userId];
        }
    }

    removePeerConnection(userId) {
        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }
        
        delete this.remoteStreams[userId];
    }

    startRemoteStatusMonitoring(userId, stream) {
        // Останавливаем предыдущий интервал
        if (this.remoteStatusIntervals[userId]) {
            clearInterval(this.remoteStatusIntervals[userId]);
        }
        
        // Запускаем новый интервал
        this.remoteStatusIntervals[userId] = setInterval(() => {
            if (stream) {
                const audioTracks = stream.getAudioTracks();
                const videoTracks = stream.getVideoTracks();
                
                const audioEnabled = audioTracks.length > 0 && audioTracks[0].enabled;
                const videoEnabled = videoTracks.length > 0 && videoTracks[0].enabled;
                
                if (this.participants[userId]) {
                    this.participants[userId].audioEnabled = audioEnabled;
                    this.participants[userId].videoEnabled = videoEnabled;
                    this.updateParticipantUI(userId);
                }
            }
        }, 1000);
    }

    updateParticipantUI(userId) {
        this.updateVideoThumbnailUI(userId);
        this.updateListParticipantUI(userId);
    }

    updateParticipantCount() {
        const remoteCount = Object.keys(this.participants).length - 1; // минус локальный
        const total = Math.max(remoteCount + 1, 1);
        
        if (this.participantCount) {
            this.participantCount.textContent = `👥 ${total}`;
        }
        
        if (this.participantsCount) {
            this.participantsCount.textContent = total;
        }
    }

        async toggleScreenShare() {
        try {
            if (!this.mediaState.screenSharing) {
                // Запуск демонстрации экрана
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                        displaySurface: 'window'
                    },
                    audio: true
                });
                
                this.screenShareVideo.srcObject = this.screenStream;
                this.mediaState.screenSharing = true;
                
                // Обновляем отображение
                this.updateMainVideoDisplay();
                
                this.toggleScreenBtn.classList.add('active');
                this.showNotification('Демонстрация экрана начата');
                
                // Обработчик окончания демонстрации
                this.screenStream.getVideoTracks()[0].onended = () => {
                    this.stopScreenShare();
                };
                
            } else {
                this.stopScreenShare();
            }
        } catch (error) {
            console.error('❌ Ошибка демонстрации экрана:', error);
            this.showNotification('Не удалось начать демонстрацию экрана');
        }
    }

    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        this.mediaState.screenSharing = false;
        this.toggleScreenBtn.classList.remove('active');
        
        // Возвращаем обычное видео
        this.updateMainVideoDisplay();
        
        this.showNotification('Демонстрация экрана остановлена');
    }

    toggleWhiteboard() {
        this.mediaState.whiteboardActive = !this.mediaState.whiteboardActive;
        this.updateMainVideoDisplay();
        
        if (this.mediaState.whiteboardActive) {
            this.toggleWhiteboardBtn.classList.add('active');
            this.toggleWhiteboardMainBtn.classList.add('active');
            this.showNotification('Доска открыта');
        } else {
            this.toggleWhiteboardBtn.classList.remove('active');
            this.toggleWhiteboardMainBtn.classList.remove('active');
            this.showNotification('Доска закрыта');
        }
    }

    toggleChatView() {
        this.mediaState.chatActive = !this.mediaState.chatActive;
        if (this.mediaState.chatActive) {
            this.switchTab('chat');
            this.showNotification('Чат открыт');
        } else {
            this.switchTab('participants');
        }
    }

    updateMainVideoDisplay() {
        const showVideo = this.mediaState.videoEnabled && this.localStream;
        const showScreen = this.mediaState.screenSharing;
        const showWhiteboard = this.mediaState.whiteboardActive;
        
        if (showWhiteboard) {
            // Показываем доску
            this.mainVideo.style.display = 'none';
            this.screenShareVideo.style.display = 'none';
            this.mainVideoPlaceholder.style.display = 'none';
            this.whiteboardFrame.style.display = 'block';
        } else if (showScreen) {
            // Показываем демонстрацию экрана
            this.mainVideo.style.display = 'none';
            this.screenShareVideo.style.display = 'block';
            this.mainVideoPlaceholder.style.display = 'none';
            this.whiteboardFrame.style.display = 'none';
        } else if (showVideo) {
            // Показываем камеру
            this.mainVideo.style.display = 'block';
            this.screenShareVideo.style.display = 'none';
            this.mainVideoPlaceholder.style.display = 'none';
            this.whiteboardFrame.style.display = 'none';
        } else {
            // Показываем аватар
            this.mainVideo.style.display = 'none';
            this.screenShareVideo.style.display = 'none';
            this.mainVideoPlaceholder.style.display = 'flex';
            this.whiteboardFrame.style.display = 'none';
        }
    }

    startMeetingTimer() {
        this.meetingTimerInterval = setInterval(() => {
            this.updateMeetingTimer();
        }, 1000);
    }

    updateMeetingTimer() {
        const now = Date.now();
        const diff = now - this.meetingStartTime;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        if (this.meetingTimer) {
            this.meetingTimer.textContent = `⏰ ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    switchTab(tabName) {
        if (tabName === 'participants') {
            this.participantsTab.classList.add('active');
            this.chatTab.classList.remove('active');
            this.participantsSidebar.classList.add('active');
            this.chatSidebar.classList.remove('active');
        } else {
            this.participantsTab.classList.remove('active');
            this.chatTab.classList.add('active');
            this.participantsSidebar.classList.remove('active');
            this.chatSidebar.classList.add('active');
        }
    }

    toggleLeftPanel() {
        this.leftPanel.classList.toggle('collapsed');
        this.expandLeftPanelBtn.style.display = this.leftPanel.classList.contains('collapsed') ? 'flex' : 'none';
    }

    setupAdaptiveLayout() {
        this.handleResize();
    }

    handleResize() {
        const width = window.innerWidth;
        if (width <= 768) {
            this.leftPanel.classList.add('collapsed');
            this.expandLeftPanelBtn.style.display = 'flex';
        } else {
            this.leftPanel.classList.remove('collapsed');
            this.expandLeftPanelBtn.style.display = 'none';
        }
    }

    setupAudioAnalysis() {
        if (!this.localStream || !this.mediaState.audioEnabled) {
            if (this.speakingCheckInterval) {
                clearInterval(this.speakingCheckInterval);
                this.speakingCheckInterval = null;
            }
            return;
        }
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            source.connect(this.analyser);
            this.analyser.fftSize = 256;
            
            this.speakingCheckInterval = setInterval(() => this.checkSpeakingActivity(), 100);
        } catch (error) {
            console.error('❌ Ошибка настройки анализа аудио:', error);
        }
    }

    checkSpeakingActivity() {
        if (!this.analyser || !this.mediaState.audioEnabled) return;
        
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Подсветка локального пользователя когда говорит
        const videoCard = document.getElementById(`video-thumb-${this.userId}`);
        if (videoCard) {
            if (average > 20) {
                videoCard.classList.add('speaking');
            } else {
                videoCard.classList.remove('speaking');
            }
        }
    }

    getRandomColor(name) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
        ];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    sendChatMessage() {
        const message = this.chatInput.value.trim();
        if (message && this.socket) {
            // Добавляем свое сообщение
            this.addChatMessage(this.userName, message, true);
            
            // Отправляем другим участникам
            this.socket.emit('chat-message', {
                roomUrl: this.roomUrl,
                userName: this.userName,
                userId: this.userId,
                message: message
            });
            
            this.chatInput.value = '';
            this.autoResizeTextarea();
        }
    }

    addChatMessage(sender, text, isOwn = false) {
        const now = new Date();
        const timeString = now.getHours().toString().padStart(2, '0') + ':' + 
                         now.getMinutes().toString().padStart(2, '0');
        
        const messageDiv = document.createElement('div');
        messageDiv.className = isOwn ? 'message own-message' : 'message remote-message';
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${timeString}</span>
            </div>
            <div class="message-text">${text}</div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        // Убираем пустое состояние
        const emptyState = this.chatMessages.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
    }

    handleChatInputKeypress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendChatMessage();
        }
    }

    autoResizeTextarea() {
        if (this.chatInput) {
            this.chatInput.style.height = 'auto';
            this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 120) + 'px';
        }
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'media-notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 3000);
    }

    leaveConference() {
        if (confirm('Вы уверены, что хотите покинуть встречу?')) {
            // Отправляем событие выхода
            if (this.socket) {
                this.socket.emit('leave-room', {
                    roomUrl: this.roomUrl,
                    userId: this.userId
                });
            }
            
            this.cleanup();
            window.location.href = '/';
        }
    }

    cleanup() {
        // Останавливаем медиа
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Очищаем интервалы
        if (this.speakingCheckInterval) {
            clearInterval(this.speakingCheckInterval);
        }
        if (this.meetingTimerInterval) {
            clearInterval(this.meetingTimerInterval);
        }
        
        // Очищаем аудиоконтекст
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        // Закрываем все PeerConnections
        Object.keys(this.peerConnections).forEach(userId => {
            this.removePeerConnection(userId);
        });
        
        // Отключаем сокет
        if (this.socket) {
            this.socket.disconnect();
        }
        
        // Очищаем localStorage
        localStorage.removeItem('conference_user_id');
    }

    forceRedButtons() {
        this.toggleAudioBtn.classList.add('muted');
        this.toggleVideoBtn.classList.add('muted');
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает видеоконференции');
        window.location.href = '/';
        return;
    }
    
    new VideoConference();
});