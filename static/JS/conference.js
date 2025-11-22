class VideoConference {
    constructor() {
        this.localStream = null;
        this.peerConnections = {};
        this.socket = null;
        this.roomUrl = null;
        this.userName = 'Участник';
        this.screenStream = null;
        this.candidateQueue = {};
        this.yourSocketId = null;
        this.remoteStreams = {};
        this.remoteIntervals = {}; // Для хранения интервалов проверки статуса
        
        this.init();
    }

    async init() {
        const pathParts = window.location.pathname.split('/');
        this.roomUrl = pathParts[pathParts.length - 1];
        this.userName = document.body.getAttribute('data-user-name') || 'Участник';
        
        document.getElementById('meetingId').textContent = `ID: ${this.roomUrl}`;
        document.getElementById('localUserName').textContent = this.userName;
        
        const initials = this.userName ? this.userName.slice(0, 2).toUpperCase() : 'УЧ';
        document.getElementById('localUserAvatar').textContent = initials;
        document.getElementById('localUserAvatarSmall').textContent = initials;
        
        await this.initMedia();
        await this.initSocket();
        this.setupEventListeners();
    }

    async initMedia() {
        try {
            // Для мобильных устройств используем более простые настройки
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            // Проверяем, является ли устройство мобильным
            if (this.isMobileDevice()) {
                constraints.video.facingMode = { ideal: 'user' }; // Используем фронтальную камеру
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
            
            document.getElementById('localVideoPlaceholder').style.display = 'none';
            localVideo.style.display = 'block';
            
            this.updateStatusIndicators(true, true);
            
        } catch (error) {
            console.error('Ошибка доступа к медиаустройствам:', error);
            this.showError('Не удалось получить доступ к камере/микрофону');
            document.getElementById('localVideoPlaceholder').style.display = 'flex';
        }
    }

    // Проверка мобильного устройства
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    initSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Подключен к серверу сигналинга');
            this.socket.emit('join-room', {
                roomUrl: this.roomUrl,
                userName: this.userName
            });
        });

        this.socket.on('connected', (data) => {
            console.log('Сокет подключен:', data);
        });

        this.socket.on('room-users', (data) => {
            console.log('Текущие участники:', data.users);
            this.yourSocketId = data.yourId;
            
            data.users.forEach(user => {
                if (user.id !== this.yourSocketId) {
                    console.log('Создаем соединение с существующим участником:', user.name);
                    this.createPeerConnection(user.id, user.name);
                }
            });
        });

        this.socket.on('user-joined', (data) => {
            console.log('Новый участник присоединился:', data);
            this.createPeerConnection(data.userId, data.userName);
            this.updateParticipantCount();
            this.showNotification(`${data.userName} присоединился к встрече`);
        });

        this.socket.on('user-left', (data) => {
            console.log('Участник вышел:', data);
            this.removePeerConnection(data.userId);
            this.updateParticipantCount();
            this.showNotification(`${data.userName} покинул встречу`);
        });

        this.socket.on('webrtc-offer', async (data) => {
            console.log('Получен OFFER от:', data.from);
            await this.handleOffer(data.offer, data.from);
        });

        this.socket.on('webrtc-answer', async (data) => {
            console.log('Получен ANSWER от:', data.from);
            await this.handleAnswer(data.answer, data.from);
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('Получен ICE кандидат от:', data.from);
            await this.handleIceCandidate(data.candidate, data.from);
        });

        this.socket.on('error', (data) => {
            console.error('Ошибка сокета:', data);
            this.showError(data.message);
        });
    }

    createPeerConnection(userId, userName) {
        if (this.peerConnections[userId]) {
            console.log('PeerConnection уже существует для:', userId);
            return this.peerConnections[userId];
        }

        console.log('Создание нового PeerConnection для:', userName, '(' + userId + ')');

        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Добавляем локальный поток
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
            console.log('Локальные треки добавлены в PeerConnection');
        }

        // Обработчики событий WebRTC
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Отправляем ICE кандидат для:', userId);
                this.socket.emit('ice-candidate', {
                    to: userId,
                    candidate: event.candidate
                });
            }
        };

        peerConnection.ontrack = (event) => {
            console.log('Получен удаленный поток от:', userName);
            
            if (event.streams && event.streams[0]) {
                this.remoteStreams[userId] = event.streams[0];
                this.addRemoteVideo(userId, userName, event.streams[0]);
                
                // Запускаем отслеживание статуса для этого пользователя
                this.startRemoteStatusMonitoring(userId, event.streams[0]);
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`Состояние соединения с ${userName}:`, peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                console.log(`P2P соединение установлено с ${userName}`);
                const participantElement = document.getElementById(`participant-${userId}`);
                if (participantElement) {
                    participantElement.classList.add('speaking');
                }
            } else if (peerConnection.connectionState === 'disconnected' || 
                       peerConnection.connectionState === 'failed') {
                const participantElement = document.getElementById(`participant-${userId}`);
                if (participantElement) {
                    participantElement.classList.remove('speaking');
                }
            }
        };

        this.peerConnections[userId] = peerConnection;
        this.candidateQueue[userId] = [];
        
        console.log('PeerConnection создан, создаем OFFER для:', userId);
        setTimeout(() => this.createOffer(userId), 500);
        
        return peerConnection;
    }

    // Отслеживание статуса удаленного участника
    startRemoteStatusMonitoring(userId, stream) {
        // Останавливаем предыдущий интервал, если был
        if (this.remoteIntervals[userId]) {
            clearInterval(this.remoteIntervals[userId]);
        }

        // Создаем новый интервал для проверки статуса
        this.remoteIntervals[userId] = setInterval(() => {
            this.updateRemoteStatusIndicators(userId, stream);
        }, 1000);

        // Первоначальное обновление
        this.updateRemoteStatusIndicators(userId, stream);
    }

    // Обновление индикаторов статуса удаленного участника
    updateRemoteStatusIndicators(userId, stream) {
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        
        const audioEnabled = audioTracks.length > 0 && audioTracks[0].enabled;
        const videoEnabled = videoTracks.length > 0 && videoTracks[0].enabled;
        
        const audioIndicator = document.getElementById(`audio-${userId}`);
        const videoIndicator = document.getElementById(`video-${userId}`);
        
        if (audioIndicator) {
            audioIndicator.className = `status-indicator ${audioEnabled ? 'audio-on' : 'audio-off muted'}`;
        }
        
        if (videoIndicator) {
            videoIndicator.className = `status-indicator ${videoEnabled ? 'video-on' : 'video-off muted'}`;
        }
        
        // Обновляем отображение видео
        const participantElement = document.getElementById(`participant-${userId}`);
        if (participantElement) {
            const videoElement = participantElement.querySelector('.remote-video');
            const placeholder = participantElement.querySelector('.video-placeholder');
            
            if (videoElement && placeholder) {
                if (videoEnabled) {
                    placeholder.style.display = 'none';
                    videoElement.style.display = 'block';
                } else {
                    placeholder.style.display = 'flex';
                    videoElement.style.display = 'none';
                }
            }
        }
    }

    async createOffer(userId) {
        try {
            const peerConnection = this.peerConnections[userId];
            if (!peerConnection) {
                console.error('PeerConnection не найден при создании offer для:', userId);
                return;
            }
            
            console.log('Создаем OFFER для:', userId);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            console.log('OFFER создан, отправляем через сокет:', userId);
            this.socket.emit('webrtc-offer', {
                to: userId,
                offer: offer
            });
            
        } catch (error) {
            console.error('Ошибка создания offer:', error);
        }
    }

    async handleOffer(offer, fromUserId) {
        console.log('Обрабатываем OFFER от:', fromUserId);
        
        let peerConnection = this.peerConnections[fromUserId];
        if (!peerConnection) {
            console.log('PeerConnection не найден, создаем новый для:', fromUserId);
            peerConnection = this.createPeerConnection(fromUserId, 'Участник');
        }

        try {
            await peerConnection.setRemoteDescription(offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                to: fromUserId,
                answer: answer
            });
            
            this.processQueuedCandidates(fromUserId);
            
        } catch (error) {
            console.error("Ошибка обработки offer:", error);
        } 
    }

    async handleAnswer(answer, fromUserId) {
        console.log('Обрабатываем ANSWER от:', fromUserId);
        
        try {
            const peerConnection = this.peerConnections[fromUserId];
            if (peerConnection) {
                await peerConnection.setRemoteDescription(answer);
                this.processQueuedCandidates(fromUserId);
            } else {
                console.error('PeerConnection не найден для answer от:', fromUserId);
            }
        } catch (error) {
            console.error('Ошибка обработки answer:', error);
        }
    }

    async handleIceCandidate(candidate, fromUserId) {
        console.log('Обрабатываем ICE кандидат от:', fromUserId);
        
        const pc = this.peerConnections[fromUserId];
        if (!pc) {
            console.error('PeerConnection не найден для ICE кандидата от:', fromUserId);
            return;
        }

        try {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(candidate);
                console.log('ICE кандидат добавлен для:', fromUserId);
            } else {
                if (!this.candidateQueue[fromUserId]) {
                    this.candidateQueue[fromUserId] = [];
                }
                this.candidateQueue[fromUserId].push(candidate);
                console.log('ICE кандидат добавлен в буфер для:', fromUserId);
            }
        } catch (error) {
            console.error('Ошибка добавления ICE кандидата:', error);
        }
    }

    async processQueuedCandidates(userId) {
        const queue = this.candidateQueue[userId];
        if (queue && queue.length > 0) {
            console.log(`Обрабатываем ${queue.length} кандидатов из буфера для:`, userId);
            
            for (const candidate of queue) {
                try {
                    await this.peerConnections[userId].addIceCandidate(candidate);
                } catch (error) {
                    console.error('Ошибка добавления отложенного ICE кандидата:', error);
                }
            }
            this.candidateQueue[userId] = [];
        }
    }

    addRemoteVideo(userId, userName, stream) {
        console.log('Добавляем удаленное видео для:', userName);
        
        const participantsGrid = document.getElementById('participantsGrid');
        if (!participantsGrid) {
            console.error('Элемент participantsGrid не найден!');
            return;
        }
        
        // Удаляем существующий элемент если есть
        const existingElement = document.getElementById(`participant-${userId}`);
        if (existingElement) {
            existingElement.remove();
        }
        
        const initials = userName ? userName.slice(0, 2).toUpperCase() : 'УЧ';
        
        const participantCard = document.createElement('div');
        participantCard.className = 'participant-card remote-user';
        participantCard.id = `participant-${userId}`;
        
        participantCard.innerHTML = `
            <div class="video-container">
                <video class="remote-video" autoplay playsinline></video>
                <div class="video-placeholder">
                    <div class="placeholder-content">
                        <div class="user-avatar large">${initials}</div>
                    </div>
                </div>
                <div class="participant-info">
                    <span class="participant-name">
                        <div class="user-avatar">${initials}</div>
                        <span>${userName}</span>
                    </span>
                    <div class="participant-status">
                        <div class="status-indicator audio-on" id="audio-${userId}"></div>
                        <div class="status-indicator video-on" id="video-${userId}"></div>
                    </div>
                </div>
                <div class="audio-controls">
                    <button class="audio-toggle" data-user-id="${userId}">
                        <span class="audio-icon">🔊</span>
                    </button>
                </div>
            </div>
        `;
        
        const videoElement = participantCard.querySelector('.remote-video');
        const placeholder = participantCard.querySelector('.video-placeholder');
        const audioToggle = participantCard.querySelector('.audio-toggle');
        const audioIcon = participantCard.querySelector('.audio-icon');
        
        console.log('Устанавливаем srcObject для удаленного видео');
        videoElement.srcObject = stream;
        
        // Для мобильных устройств добавляем обработчики жестов
        if (this.isMobileDevice()) {
            this.setupMobileVideoControls(videoElement, audioToggle, audioIcon);
        }
        
        // Обработчики для видео
        videoElement.onloadedmetadata = () => {
            console.log('Метаданные удаленного видео загружены для:', userName);
            videoElement.play().catch(e => {
                console.error('Ошибка автовоспроизведения:', e);
                // Для мобильных устройств показываем кнопку воспроизведения
                if (this.isMobileDevice()) {
                    this.showMobilePlayButton(videoElement, userName);
                }
            });
        };
        
        videoElement.onloadeddata = () => {
            console.log('Данные удаленного видео загружены для:', userName);
            placeholder.style.display = 'none';
            videoElement.style.display = 'block';
        };
        
        videoElement.oncanplay = () => {
            console.log('Удаленное видео может воспроизводиться для:', userName);
            placeholder.style.display = 'none';
            videoElement.style.display = 'block';
        };
        
        videoElement.onerror = (e) => {
            console.error('Ошибка загрузки удаленного видео для:', userName, e);
            placeholder.style.display = 'flex';
        };
        
        // Обработчик для кнопки управления звуком
        if (audioToggle) {
            audioToggle.addEventListener('click', () => {
                videoElement.muted = !videoElement.muted;
                audioIcon.textContent = videoElement.muted ? '🔇' : '🔊';
                console.log('Звук', videoElement.muted ? 'выключен' : 'включен', 'для', userName);
            });
        }
        
        participantsGrid.appendChild(participantCard);
        this.updateParticipantCount();
        
        console.log('Удаленное видео добавлено в DOM для:', userName);
    }

    // Настройка элементов управления для мобильных устройств
    setupMobileVideoControls(videoElement, audioToggle, audioIcon) {
        let tapTimer;
        let tapCount = 0;
        
        videoElement.addEventListener('click', (e) => {
            tapCount++;
            
            if (tapCount === 1) {
                tapTimer = setTimeout(() => {
                    // Одинарное нажатие - переключение полноэкранного режима
                    if (videoElement.requestFullscreen) {
                        if (!document.fullscreenElement) {
                            videoElement.requestFullscreen();
                        } else {
                            document.exitFullscreen();
                        }
                    }
                    tapCount = 0;
                }, 300);
            } else if (tapCount === 2) {
                // Двойное нажатие - переключение звука
                clearTimeout(tapTimer);
                videoElement.muted = !videoElement.muted;
                audioIcon.textContent = videoElement.muted ? '🔇' : '🔊';
                tapCount = 0;
            }
        });
        
        // Сбрасываем счетчик нажатий через короткое время
        setTimeout(() => {
            tapCount = 0;
        }, 400);
    }

    // Показать кнопку воспроизведения для мобильных устройств
    showMobilePlayButton(videoElement, userName) {
        const playButton = document.createElement('button');
        playButton.className = 'mobile-play-button';
        playButton.innerHTML = '▶️ Воспроизвести';
        playButton.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 100;
            padding: 10px 20px;
            background: rgba(0,0,0,0.7);
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        `;
        
        playButton.addEventListener('click', () => {
            videoElement.play()
                .then(() => playButton.remove())
                .catch(e => console.error('Ошибка ручного воспроизведения:', e));
        });
        
        videoElement.parentElement.style.position = 'relative';
        videoElement.parentElement.appendChild(playButton);
    }

    removePeerConnection(userId) {
        console.log('Удаление PeerConnection для:', userId);
        
        // Останавливаем интервал отслеживания статуса
        if (this.remoteIntervals[userId]) {
            clearInterval(this.remoteIntervals[userId]);
            delete this.remoteIntervals[userId];
        }
        
        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }
        
        if (this.candidateQueue[userId]) {
            delete this.candidateQueue[userId];
        }
        
        if (this.remoteStreams[userId]) {
            delete this.remoteStreams[userId];
        }
        
        const participantElement = document.getElementById(`participant-${userId}`);
        if (participantElement) {
            participantElement.remove();
        }
    }

    updateParticipantCount() {
        const remoteParticipants = document.querySelectorAll('.remote-user').length;
        const totalParticipants = remoteParticipants + 1;
        document.getElementById('participantCount').textContent = `👥 ${totalParticipants}`;
    }

    updateStatusIndicators(audioEnabled, videoEnabled) {
        const audioStatus = document.getElementById('localAudioStatus');
        const videoStatus = document.getElementById('localVideoStatus');
        const toggleAudioBtn = document.getElementById('toggleAudio');
        const toggleVideoBtn = document.getElementById('toggleVideo');
        
        if (audioStatus) {
            audioStatus.className = `status-indicator ${audioEnabled ? 'audio-on' : 'audio-off muted'}`;
        }
        
        if (videoStatus) {
            videoStatus.className = `status-indicator ${videoEnabled ? 'video-on' : 'video-off muted'}`;
        }
        
        if (toggleAudioBtn) {
            toggleAudioBtn.classList.toggle('muted', !audioEnabled);
        }
        
        if (toggleVideoBtn) {
            toggleVideoBtn.classList.toggle('muted', !videoEnabled);
        }
    }

    setupEventListeners() {
        const toggleAudioBtn = document.getElementById('toggleAudio');
        if (toggleAudioBtn) {
            toggleAudioBtn.addEventListener('click', () => {
                if (this.localStream) {
                    const audioTracks = this.localStream.getAudioTracks();
                    const newState = !audioTracks[0]?.enabled;
                    
                    audioTracks.forEach(track => {
                        track.enabled = newState;
                    });
                    
                    this.updateStatusIndicators(newState, this.localStream.getVideoTracks()[0]?.enabled);
                    this.showNotification(newState ? 'Микрофон включен' : 'Микрофон выключен');
                }
            });
        }

        const toggleVideoBtn = document.getElementById('toggleVideo');
        if (toggleVideoBtn) {
            toggleVideoBtn.addEventListener('click', () => {
                if (this.localStream) {
                    const videoTracks = this.localStream.getVideoTracks();
                    const newState = !videoTracks[0]?.enabled;
                    
                    videoTracks.forEach(track => {
                        track.enabled = newState;
                    });
                    
                    const localVideo = document.getElementById('localVideo');
                    const placeholder = document.getElementById('localVideoPlaceholder');
                    
                    if (newState) {
                        placeholder.style.display = 'none';
                        localVideo.style.display = 'block';
                    } else {
                        placeholder.style.display = 'flex';
                        localVideo.style.display = 'none';
                    }
                    
                    this.updateStatusIndicators(
                        this.localStream.getAudioTracks()[0]?.enabled, 
                        newState
                    );
                    this.showNotification(newState ? 'Камера включена' : 'Камера выключена');
                }
            });
        }

        const toggleScreenBtn = document.getElementById('toggleScreen');
        if (toggleScreenBtn) {
            toggleScreenBtn.addEventListener('click', async () => {
                try {
                    if (!this.screenStream) {
                        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                            video: true,
                            audio: true
                        });
                        
                        const videoTrack = this.screenStream.getVideoTracks()[0];
                        Object.values(this.peerConnections).forEach(pc => {
                            const sender = pc.getSenders().find(s => 
                                s.track && s.track.kind === 'video'
                            );
                            if (sender) {
                                sender.replaceTrack(videoTrack);
                            }
                        });
                        
                        const localVideo = document.getElementById('localVideo');
                        localVideo.srcObject = this.screenStream;
                        document.getElementById('localVideoPlaceholder').style.display = 'none';
                        localVideo.style.display = 'block';
                        
                        toggleScreenBtn.classList.add('active');
                        
                        videoTrack.onended = () => {
                            this.stopScreenShare();
                        };
                        
                        this.showNotification('Демонстрация экрана начата');
                    } else {
                        this.stopScreenShare();
                    }
                } catch (error) {
                    console.error('Ошибка демонстрации экрана:', error);
                    if (error.name !== 'NotAllowedError') {
                        this.showError('Не удалось начать демонстрацию экрана');
                    }
                }
            });
        }

        const leaveCallBtn = document.getElementById('leaveCall');
        if (leaveCallBtn) {
            leaveCallBtn.addEventListener('click', () => {
                if (confirm('Вы уверены, что хотите покинуть встречу?')) {
                    this.leaveConference();
                }
            });
        }
    }

    stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        Object.values(this.peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender && this.localStream) {
                const videoTrack = this.localStream.getVideoTracks()[0];
                if (videoTrack) {
                    sender.replaceTrack(videoTrack);
                }
            }
        });
        
        if (this.localStream) {
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
            
            const videoEnabled = this.localStream.getVideoTracks()[0]?.enabled;
            const placeholder = document.getElementById('localVideoPlaceholder');
            
            if (videoEnabled) {
                placeholder.style.display = 'none';
                localVideo.style.display = 'block';
            } else {
                placeholder.style.display = 'flex';
                localVideo.style.display = 'none';
            }
        }
        
        const toggleScreenBtn = document.getElementById('toggleScreen');
        if (toggleScreenBtn) {
            toggleScreenBtn.classList.remove('active');
        }
        
        this.showNotification('Демонстрация экрана остановлена');
    }

    leaveConference() {
        console.log('Выход из конференции');
        
        if (this.socket) {
            this.socket.emit('leave-room', {
                roomUrl: this.roomUrl
            });
        }
        
        Object.keys(this.peerConnections).forEach(userId => {
            this.removePeerConnection(userId);
        });
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        window.location.href = '/';
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

    showError(message) {
        this.showNotification(`Ошибка: ${message}`);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new VideoConference();
});