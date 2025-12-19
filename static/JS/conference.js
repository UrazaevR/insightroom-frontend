// conference.js - Исправленная версия с правильной обработкой состояний
class VideoConference {
    constructor() {
        // Состояние
        this.userId = null;
        this.userName = '';
        this.roomUrl = '';
        
        // Медиа
        this.localStream = null;
        this.screenStream = null;
        this.audioTrack = null;
        this.videoTrack = null;
        
        this.mediaState = {
            audioEnabled: false,
            videoEnabled: false,
            audioInitialized: false,
            videoInitialized: false,
            screenSharing: false,
            whiteboardActive: false
        };
        
        // WebRTC соединения
        this.peerConnections = {}; // userId -> RTCPeerConnection
        this.remoteStreams = {};   // userId -> MediaStream
        
        // Очереди для ICE кандидатов (если они приходят до установки remote description)
        this.pendingIceCandidates = {};
        
        // Socket.io
        this.socket = null;
        
        // DOM элементы
        this.elements = {};
        
        // Инициализация
        this.initialize();
    }
    
    async initialize() {
        console.log('🚀 Инициализация видеоконференции');
        
        this.getRoomData();
        this.initializeElements();
        this.initializeEventListeners();
        this.setupAdaptiveLayout();
        
        // Автоматически запрашиваем доступ к медиа при старте
        await this.initializeMediaOnStart();
        
        // Подключаемся к серверу сигналинга
        this.initializeSocket();
        
        // Начальное состояние
        this.forceRedButtons();
        this.updateParticipantCount();
        
        this.showNotification('Конференция загружена');
    }
    
    getRoomData() {
        const pathParts = window.location.pathname.split('/');
        this.roomUrl = pathParts[pathParts.length - 1];
        this.userName = document.body.getAttribute('data-user-name') || 'Участник';
        console.log(`📁 Комната: ${this.roomUrl}, Пользователь: ${this.userName}`);
    }
    
    initializeElements() {
        // Основные элементы
        this.elements = {
            localVideoThumbnail: document.getElementById('localVideoThumbnail'),
            mainVideo: document.getElementById('mainVideo'),
            mainVideoWrapper: document.getElementById('mainVideoWrapper'),
            mainVideoPlaceholder: document.getElementById('mainVideoPlaceholder'),
            screenShareVideo: document.getElementById('screenShareVideo'),
            screenShareWrapper: document.getElementById('screenShareWrapper'),
            whiteboardFrame: document.getElementById('whiteboardFrame'),
            localAvatar: document.getElementById('localAvatar'),
            
            // Панель управления
            toggleAudio: document.getElementById('toggleAudio'),
            toggleVideo: document.getElementById('toggleVideo'),
            toggleScreen: document.getElementById('toggleScreen'),
            toggleWhiteboardBtn: document.getElementById('toggleWhiteboardBtn'),
            toggleChatBtn: document.getElementById('toggleChatBtn'),
            leaveCall: document.getElementById('leaveCall'),
            
            // Иконки
            toggleAudioIcon: document.getElementById('toggleAudioIcon'),
            toggleVideoIcon: document.getElementById('toggleVideoIcon'),
            toggleScreenIcon: document.getElementById('toggleScreenIcon'),
            
            // Статусы
            localAudioStatus: document.getElementById('localAudioStatus'),
            localVideoStatus: document.getElementById('localVideoStatus'),
            
            // Панели
            leftPanel: document.getElementById('leftPanel'),
            centerPanel: document.getElementById('centerPanel'),
            expandLeftPanel: document.getElementById('expandLeftPanel'),
            participantsList: document.getElementById('participantsList'),
            videoParticipantsList: document.getElementById('videoParticipantsList'),
            
            // Чат
            chatSidebar: document.getElementById('chatSidebar'),
            participantsSidebar: document.getElementById('participantsListSidebar'),
            chatMessages: document.getElementById('chatMessages'),
            chatInput: document.getElementById('chatInput'),
            sendMessage: document.getElementById('sendMessage'),
            
            // Счетчики
            participantCount: document.getElementById('participantCount'),
            participantsCount: document.getElementById('participantsCount'),
            
            // Индикаторы
            webrtcLoading: document.getElementById('webrtcLoading'),
            connectionStatus: document.getElementById('connectionStatus'),
            
            // Подсказка медиа
            mediaPrompt: document.getElementById('mediaPrompt'),
            enableMediaBtn: document.getElementById('enableMediaBtn'),
            dismissPromptBtn: document.getElementById('dismissPromptBtn')
        };
    }
    
    async initializeMediaOnStart() {
        console.log('🎯 Автоматическая инициализация медиа при старте');
        
        try {
            // Запрашиваем доступ к медиа устройствам
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                }
            });
            
            // Сохраняем поток и треки
            this.localStream = stream;
            this.audioTrack = stream.getAudioTracks()[0];
            this.videoTrack = stream.getVideoTracks()[0];
            
            // Устанавливаем состояние
            this.mediaState.audioInitialized = true;
            this.mediaState.videoInitialized = true;
            
            // НАЧАЛЬНО ВЫКЛЮЧАЕМ медиа
            if (this.audioTrack) {
                this.audioTrack.enabled = false;
                this.mediaState.audioEnabled = false;
            }
            
            if (this.videoTrack) {
                this.videoTrack.enabled = false;
                this.mediaState.videoEnabled = false;
            }
            
            // Устанавливаем поток в видео элементы
            if (this.elements.localVideoThumbnail) {
                this.elements.localVideoThumbnail.srcObject = stream;
            }
            if (this.elements.mainVideo) {
                this.elements.mainVideo.srcObject = stream;
            }
            
            // Обновляем UI
            this.updateMediaUI();
            
            console.log('✅ Медиа автоматически инициализировано при старте');
            
        } catch (error) {
            console.error('❌ Ошибка автоматической инициализации медиа:', error);
            this.showNotification('Не удалось получить доступ к камере/микрофону');
            
            // Создаем пустые потоки для корректной работы
            this.localStream = new MediaStream();
        }
    }
    
    initializeSocket() {
        console.log('🔌 Подключение к серверу сигналинга');
        
        this.socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true
        });
        
        // ========== ОБРАБОТЧИКИ СОБЫТИЙ SOCKET.IO ==========
        
        this.socket.on('connect', () => {
            console.log('✅ Подключен к серверу сигналинга, ID:', this.socket.id);
            this.updateConnectionStatus('connected');
            
            // Присоединяемся к комнате
            this.socket.emit('join-room', {
                roomUrl: this.roomUrl,
                userName: this.userName
            });
        });
        
        this.socket.on('connected', (data) => {
            console.log('✅ Сокет подключен:', data);
            this.userId = this.socket.id;
        });
        
        this.socket.on('room-users', async (data) => {
            console.log('📋 Получен список участников:', data.users);
            this.userId = data.yourId;
            
            // Удаляем самого себя из списка
            const otherUsers = data.users.filter(user => user.id !== this.userId);
            
            console.log(`👥 Другие участники (${otherUsers.length}):`, 
                otherUsers.map(u => `${u.name} (${u.id})`));
            
            // Для каждого существующего участника создаем соединение
            for (const user of otherUsers) {
                console.log(`🤝 Создаем соединение с: ${user.name}`);
                
                // Добавляем в интерфейс
                this.addRemoteParticipant(user.id, user.name);
                
                // Создаем PeerConnection и отправляем OFFER
                await this.createAndInitiateConnection(user.id, user.name);
            }
            
            this.updateParticipantCount();
            this.hideLoading();
            
            // Показываем подсказку через 2 секунды если медиа не включены
            setTimeout(() => {
                if (!this.mediaState.audioEnabled || !this.mediaState.videoEnabled) {
                    this.showMediaPrompt();
                }
            }, 2000);
        });
        
        this.socket.on('user-joined', async (data) => {
            console.log(`👋 Новый участник присоединился: ${data.userName} (${data.userId})`);
            
            if (data.userId === this.userId) {
                console.log('ℹ️ Это я сам, игнорируем');
                return;
            }
            
            this.showNotification(`${data.userName} присоединился`);
            
            // Добавляем участника в интерфейс
            this.addRemoteParticipant(data.userId, data.userName);
            
            // Создаем соединение с новым участником
            await this.createAndInitiateConnection(data.userId, data.userName);
            
            this.updateParticipantCount();
        });
        
        this.socket.on('user-left', (data) => {
            console.log(`👋 Участник вышел: ${data.userName} (${data.userId})`);
            this.showNotification(`${data.userName} покинул встречу`);
            
            this.removeParticipant(data.userId);
            this.updateParticipantCount();
        });
        
        this.socket.on('webrtc-offer', async (data) => {
            console.log(`📨 Получен OFFER от ${data.from}`);
            await this.handleIncomingOffer(data.offer, data.from);
        });
        
        this.socket.on('webrtc-answer', async (data) => {
            console.log(`📨 Получен ANSWER от ${data.from}`);
            await this.handleIncomingAnswer(data.answer, data.from);
        });
        
        this.socket.on('ice-candidate', async (data) => {
            console.log(`🧊 Получен ICE кандидат от ${data.from}`);
            await this.handleIceCandidate(data.candidate, data.from);
        });
        
        this.socket.on('error', (data) => {
            console.error('❌ Ошибка сокета:', data);
            this.showError(data.message || 'Ошибка соединения');
        });
        
        this.socket.on('disconnect', () => {
            console.log('🔌 Отключен от сервера');
            this.updateConnectionStatus('disconnected');
            this.showNotification('Соединение потеряно');
        });
    }
    
    initializeEventListeners() {
        // Микрофон
        this.elements.toggleAudio.addEventListener('click', () => this.toggleAudio());
        
        // Камера
        this.elements.toggleVideo.addEventListener('click', () => this.toggleVideo());
        
        // Демонстрация экрана
        this.elements.toggleScreen.addEventListener('click', () => this.toggleScreenShare());
        
        // Доска
        this.elements.toggleWhiteboardBtn.addEventListener('click', () => this.toggleWhiteboard());
        
        // Чат
        this.elements.toggleChatBtn.addEventListener('click', () => this.toggleChat());
        
        // Выход
        this.elements.leaveCall.addEventListener('click', () => this.leaveConference());
        
        // Разворачивание панели
        this.elements.expandLeftPanel.addEventListener('click', () => this.toggleLeftPanel());
        
        // Чат
        this.elements.sendMessage.addEventListener('click', () => this.sendChatMessage());
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });
        
        this.elements.chatInput.addEventListener('input', () => this.autoResizeTextarea());
        
        // Подсказка медиа
        this.elements.enableMediaBtn.addEventListener('click', () => this.enableAllMedia());
        this.elements.dismissPromptBtn.addEventListener('click', () => this.dismissMediaPrompt());
        
        // Закрытие страницы
        window.addEventListener('beforeunload', () => this.cleanup());
    }
    
    // ========== УПРАВЛЕНИЕ МЕДИА ==========
    
    async toggleAudio() {
        console.log('🎤 Переключение аудио');
        
        if (!this.mediaState.audioInitialized) {
            console.log('🔄 Инициализируем аудио...');
            const success = await this.initializeAudio();
            if (!success) return;
        }
        
        // Переключаем состояние
        if (this.audioTrack) {
            this.mediaState.audioEnabled = !this.mediaState.audioEnabled;
            this.audioTrack.enabled = this.mediaState.audioEnabled;
            this.updateMediaUI();
            this.showNotification(this.mediaState.audioEnabled ? 'Микрофон включен' : 'Микрофон выключен');
            
            // Скрываем подсказку если все медиа включены
            if (this.mediaState.audioEnabled && this.mediaState.videoEnabled) {
                this.hideMediaPrompt();
            }
        }
    }
    
    async toggleVideo() {
        console.log('📹 Переключение видео');
        
        if (!this.mediaState.videoInitialized) {
            console.log('🔄 Инициализируем видео...');
            const success = await this.initializeVideo();
            if (!success) return;
        }
        
        // Переключаем состояние
        if (this.videoTrack) {
            this.mediaState.videoEnabled = !this.mediaState.videoEnabled;
            this.videoTrack.enabled = this.mediaState.videoEnabled;
            this.updateMediaUI();
            this.showNotification(this.mediaState.videoEnabled ? 'Камера включена' : 'Камера выключена');
            
            // Скрываем подсказку если все медиа включены
            if (this.mediaState.audioEnabled && this.mediaState.videoEnabled) {
                this.hideMediaPrompt();
            }
        }
    }
    
    async enableAllMedia() {
        console.log('🔈 Включаем все медиа');
        
        // Включаем аудио
        if (this.audioTrack) {
            this.mediaState.audioEnabled = true;
            this.audioTrack.enabled = true;
        } else {
            await this.initializeAudio();
            if (this.audioTrack) {
                this.mediaState.audioEnabled = true;
                this.audioTrack.enabled = true;
            }
        }
        
        // Включаем видео
        if (this.videoTrack) {
            this.mediaState.videoEnabled = true;
            this.videoTrack.enabled = true;
        } else {
            await this.initializeVideo();
            if (this.videoTrack) {
                this.mediaState.videoEnabled = true;
                this.videoTrack.enabled = true;
            }
        }
        
        this.updateMediaUI();
        this.hideMediaPrompt();
        this.showNotification('Микрофон и камера включены');
    }
    
    showMediaPrompt() {
        if (this.elements.mediaPrompt) {
            this.elements.mediaPrompt.classList.remove('hidden');
        }
    }
    
    hideMediaPrompt() {
        if (this.elements.mediaPrompt) {
            this.elements.mediaPrompt.classList.add('hidden');
        }
    }
    
    dismissMediaPrompt() {
        this.hideMediaPrompt();
    }
    
    async initializeAudio() {
        try {
            console.log('🎤 Инициализация аудио...');
            
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Получаем аудио трек
            const audioTrack = audioStream.getAudioTracks()[0];
            if (!audioTrack) {
                throw new Error('Не удалось получить аудио трек');
            }
            
            // Сохраняем трек
            this.audioTrack = audioTrack;
            
            // Создаем локальный поток если его нет
            if (!this.localStream) {
                this.localStream = new MediaStream();
            }
            
            // Удаляем старые аудио треки
            this.localStream.getAudioTracks().forEach(track => {
                track.stop();
                this.localStream.removeTrack(track);
            });
            
            // Добавляем новый аудио трек
            this.localStream.addTrack(audioTrack);
            this.mediaState.audioInitialized = true;
            
            // Обновляем видео элементы
            if (this.elements.localVideoThumbnail) {
                this.elements.localVideoThumbnail.srcObject = this.localStream;
            }
            if (this.elements.mainVideo) {
                this.elements.mainVideo.srcObject = this.localStream;
            }
            
            // Добавляем трек во все соединения
            this.addAudioTrackToAllConnections(audioTrack);
            
            console.log('✅ Аудио инициализировано');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка инициализации аудио:', error);
            this.showNotification('Не удалось подключить микрофон');
            return false;
        }
    }
    
    async initializeVideo() {
        try {
            console.log('📹 Инициализация видео...');
            
            const videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                }
            });
            
            // Получаем видео трек
            const videoTrack = videoStream.getVideoTracks()[0];
            if (!videoTrack) {
                throw new Error('Не удалось получить видео трек');
            }
            
            // Сохраняем трек
            this.videoTrack = videoTrack;
            
            // Создаем локальный поток если его нет
            if (!this.localStream) {
                this.localStream = new MediaStream();
            }
            
            // Удаляем старые видео треки
            this.localStream.getVideoTracks().forEach(track => {
                track.stop();
                this.localStream.removeTrack(track);
            });
            
            // Добавляем новый видео трек
            this.localStream.addTrack(videoTrack);
            this.mediaState.videoInitialized = true;
            
            // Обновляем видео элементы
            if (this.elements.localVideoThumbnail) {
                this.elements.localVideoThumbnail.srcObject = this.localStream;
            }
            if (this.elements.mainVideo) {
                this.elements.mainVideo.srcObject = this.localStream;
            }
            
            // Добавляем трек во все соединения
            this.addVideoTrackToAllConnections(videoTrack);
            
            console.log('✅ Видео инициализировано');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка инициализации видео:', error);
            this.showNotification('Не удалось подключить камеру');
            return false;
        }
    }
    
    addAudioTrackToAllConnections(audioTrack) {
        console.log(`🔊 Добавление аудио трека во все соединения (${Object.keys(this.peerConnections).length})`);
        
        Object.keys(this.peerConnections).forEach(userId => {
            const pc = this.peerConnections[userId];
            if (pc) {
                console.log(`🔊 Обработка соединения с ${userId}`);
                
                // Ищем существующий аудио отправитель
                const senders = pc.getSenders();
                const audioSender = senders.find(s => 
                    s.track && s.track.kind === 'audio'
                );
                
                if (audioSender) {
                    // Заменяем трек
                    console.log(`🔄 Заменяем аудио трек для ${userId}`);
                    audioSender.replaceTrack(audioTrack);
                } else {
                    // Добавляем новый трек
                    console.log(`➕ Добавляем новый аудио трек для ${userId}`);
                    pc.addTrack(audioTrack, this.localStream);
                }
            }
        });
    }
    
    addVideoTrackToAllConnections(videoTrack) {
        console.log(`📹 Добавление видео трека во все соединения (${Object.keys(this.peerConnections).length})`);
        
        Object.keys(this.peerConnections).forEach(userId => {
            const pc = this.peerConnections[userId];
            if (pc) {
                console.log(`📹 Обработка соединения с ${userId}`);
                
                // Ищем существующий видео отправитель
                const senders = pc.getSenders();
                const videoSender = senders.find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (videoSender) {
                    // Заменяем трек
                    console.log(`🔄 Заменяем видео трек для ${userId}`);
                    videoSender.replaceTrack(videoTrack);
                } else {
                    // Добавляем новый трек
                    console.log(`➕ Добавляем новый видео трек для ${userId}`);
                    pc.addTrack(videoTrack, this.localStream);
                }
            }
        });
    }
    
    updateMediaUI() {
        // Обновляем иконки панели управления
        if (this.elements.toggleAudioIcon) {
            this.elements.toggleAudioIcon.src = this.mediaState.audioEnabled ? 
                "/static/images/mic-on.png" : 
                "/static/images/mic-off.png";
        }
        
        if (this.elements.toggleVideoIcon) {
            this.elements.toggleVideoIcon.src = this.mediaState.videoEnabled ? 
                "/static/images/camera-on.png" : 
                "/static/images/camera-off.png";
        }
        
        // Обновляем классы кнопок
        if (this.mediaState.audioEnabled) {
            this.elements.toggleAudio.classList.remove('muted');
        } else {
            this.elements.toggleAudio.classList.add('muted');
        }
        
        if (this.mediaState.videoEnabled) {
            this.elements.toggleVideo.classList.remove('muted');
        } else {
            this.elements.toggleVideo.classList.add('muted');
        }
        
        // Обновляем индикаторы в левой панели
        if (this.elements.localAudioStatus) {
            this.elements.localAudioStatus.src = this.mediaState.audioEnabled ? 
                "/static/images/mic-on.png" : 
                "/static/images/mic-off.png";
            this.elements.localAudioStatus.classList.toggle('muted', !this.mediaState.audioEnabled);
        }
        
        if (this.elements.localVideoStatus) {
            this.elements.localVideoStatus.src = this.mediaState.videoEnabled ? 
                "/static/images/camera-on.png" : 
                "/static/images/camera-off.png";
            this.elements.localVideoStatus.classList.toggle('muted', !this.mediaState.videoEnabled);
        }
        
        // Обновляем статусы в списке
        const listAudioStatus = document.getElementById('listAudioStatus');
        const listVideoStatus = document.getElementById('listVideoStatus');
        
        if (listAudioStatus) {
            listAudioStatus.src = this.mediaState.audioEnabled ? 
                "/static/images/mic-on.png" : 
                "/static/images/mic-off.png";
        }
        
        if (listVideoStatus) {
            listVideoStatus.src = this.mediaState.videoEnabled ? 
                "/static/images/camera-on.png" : 
                "/static/images/camera-off.png";
        }
        
        // Обновляем видео в миниатюре
        const localAvatar = document.querySelector('#participant-local .participant-avatar');
        if (this.elements.localVideoThumbnail && localAvatar) {
            if (this.mediaState.videoEnabled && this.mediaState.videoInitialized) {
                this.elements.localVideoThumbnail.style.display = 'block';
                localAvatar.style.display = 'none';
            } else {
                this.elements.localVideoThumbnail.style.display = 'none';
                localAvatar.style.display = 'flex';
            }
        }
        
        this.updateMainVideoDisplay();
    }
    
    // ========== WebRTC ФУНКЦИИ (ИСПРАВЛЕННЫЕ) ==========
    
    async createAndInitiateConnection(targetUserId, targetUserName) {
        console.log(`🤝 Инициация соединения с ${targetUserName}`);
        
        // Создаем PeerConnection
        const peerConnection = await this.createPeerConnection(targetUserId, targetUserName);
        if (!peerConnection) {
            console.error(`❌ Не удалось создать PeerConnection для ${targetUserName}`);
            return;
        }
        
        // Создаем и отправляем OFFER
        try {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await peerConnection.setLocalDescription(offer);
            
            console.log(`📤 Отправляем OFFER для ${targetUserName}`);
            this.socket.emit('webrtc-offer', {
                to: targetUserId,
                offer: offer
            });
            
        } catch (error) {
            console.error(`❌ Ошибка создания OFFER для ${targetUserName}:`, error);
        }
    }
    
    async createPeerConnection(targetUserId, targetUserName) {
        // Проверяем, не существует ли уже соединение
        if (this.peerConnections[targetUserId]) {
            console.log(`⚠️ Соединение с ${targetUserName} уже существует`);
            return this.peerConnections[targetUserId];
        }
        
        console.log(`🔗 Создание PeerConnection для ${targetUserName}`);
        
        try {
            const configuration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            };
            
            const peerConnection = new RTCPeerConnection(configuration);
            
            // Инициализируем очередь ICE кандидатов для этого соединения
            this.pendingIceCandidates[targetUserId] = [];
            
            // Добавляем локальные треки если они есть
            this.addLocalTracksToConnection(peerConnection, targetUserName);
            
            // Обработчики событий
            peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.socket && this.socket.connected) {
                    this.socket.emit('ice-candidate', {
                        to: targetUserId,
                        candidate: event.candidate
                    });
                }
            };
            
            peerConnection.ontrack = (event) => {
                console.log(`🎬 Получен удаленный поток от ${targetUserName}`);
                
                if (event.streams && event.streams[0]) {
                    this.updateRemoteVideo(targetUserId, targetUserName, event.streams[0]);
                }
            };
            
            peerConnection.onconnectionstatechange = () => {
                console.log(`🔌 Состояние с ${targetUserName}: ${peerConnection.connectionState}`);
                
                const card = document.getElementById(`participant-${targetUserId}`);
                if (card) {
                    if (peerConnection.connectionState === 'connected') {
                        card.classList.add('speaking');
                        console.log(`✅ Соединение с ${targetUserName} установлено!`);
                    } else {
                        card.classList.remove('speaking');
                    }
                }
            };
            
            peerConnection.onsignalingstatechange = () => {
                console.log(`📡 Signaling state для ${targetUserName}: ${peerConnection.signalingState}`);
            };
            
            // Сохраняем соединение
            this.peerConnections[targetUserId] = peerConnection;
            
            console.log(`✅ PeerConnection создан для ${targetUserName}`);
            return peerConnection;
            
        } catch (error) {
            console.error(`❌ Ошибка создания PeerConnection:`, error);
            return null;
        }
    }
    
    addLocalTracksToConnection(pc, targetUserName) {
        console.log(`🎯 Добавление локальных треков в соединение для ${targetUserName}`);
        
        // Добавляем аудио трек если он есть
        if (this.audioTrack) {
            console.log(`🔊 Добавляем аудио трек для ${targetUserName}`);
            
            // Проверяем, не добавлен ли уже этот трек
            const existingSenders = pc.getSenders();
            const hasAudio = existingSenders.some(sender => 
                sender.track && sender.track.kind === 'audio'
            );
            
            if (!hasAudio && this.localStream) {
                pc.addTrack(this.audioTrack, this.localStream);
            }
        }
        
        // Добавляем видео трек если он есть
        if (this.videoTrack) {
            console.log(`📹 Добавляем видео трек для ${targetUserName}`);
            
            const existingSenders = pc.getSenders();
            const hasVideo = existingSenders.some(sender => 
                sender.track && sender.track.kind === 'video'
            );
            
            if (!hasVideo && this.localStream) {
                pc.addTrack(this.videoTrack, this.localStream);
            }
        }
    }
    
    async handleIncomingOffer(offer, fromUserId) {
        console.log(`📩 Обработка входящего OFFER от ${fromUserId}`);
        
        try {
            // Получаем или создаем PeerConnection
            let peerConnection = this.peerConnections[fromUserId];
            if (!peerConnection) {
                console.log(`🔗 Создаем новый PeerConnection для входящего OFFER`);
                peerConnection = await this.createPeerConnection(fromUserId, 'Участник');
            }
            
            if (!peerConnection) {
                throw new Error('Не удалось создать PeerConnection');
            }
            
            // Устанавливаем удаленное описание (OFFER)
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            console.log(`✅ Remote description установлен для ${fromUserId}`);
            
            // Добавляем локальные треки если их еще нет
            this.addLocalTracksToConnection(peerConnection, fromUserId);
            
            // Обрабатываем ожидающие ICE кандидаты
            this.processPendingIceCandidates(fromUserId, peerConnection);
            
            // Создаем и отправляем ANSWER
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log(`📨 Отправляем ANSWER для ${fromUserId}`);
            this.socket.emit('webrtc-answer', {
                to: fromUserId,
                answer: answer
            });
            
        } catch (error) {
            console.error(`❌ Ошибка обработки входящего OFFER:`, error);
        }
    }
    
    async handleIncomingAnswer(answer, fromUserId) {
        console.log(`📩 Обработка входящего ANSWER от ${fromUserId}`);
        
        try {
            const peerConnection = this.peerConnections[fromUserId];
            if (!peerConnection) {
                console.error(`❌ PeerConnection не найден для ${fromUserId}`);
                return;
            }
            
            const remoteDescription = peerConnection.remoteDescription;
            
            // Проверяем состояние перед установкой answer
            if (!remoteDescription || remoteDescription.type === 'offer') {
                console.log(`✅ Устанавливаем remote answer для ${fromUserId}`);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                
                // Обрабатываем ожидающие ICE кандидаты
                this.processPendingIceCandidates(fromUserId, peerConnection);
                
            } else {
                console.log(`⚠️ Пропускаем answer, т.к. remote description уже установлен для ${fromUserId}`);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка обработки входящего ANSWER:`, error);
            console.log('Текущее состояние соединения:', peerConnection.signalingState);
        }
    }
    
    async handleIceCandidate(candidate, fromUserId) {
        console.log(`🧊 Обработка ICE кандидата от ${fromUserId}`);
        
        try {
            const peerConnection = this.peerConnections[fromUserId];
            if (!peerConnection) {
                console.log(`📦 Сохраняем ICE кандидат в очередь для ${fromUserId}`);
                // Сохраняем кандидат в очередь если соединение еще не создано
                if (!this.pendingIceCandidates[fromUserId]) {
                    this.pendingIceCandidates[fromUserId] = [];
                }
                this.pendingIceCandidates[fromUserId].push(candidate);
                return;
            }
            
            const remoteDescription = peerConnection.remoteDescription;
            
            // Добавляем кандидат только если установлено remote description
            if (remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`✅ ICE кандидат добавлен для ${fromUserId}`);
            } else {
                // Сохраняем в очередь если remote description еще не установлено
                console.log(`📦 Откладываем ICE кандидат для ${fromUserId}`);
                if (!this.pendingIceCandidates[fromUserId]) {
                    this.pendingIceCandidates[fromUserId] = [];
                }
                this.pendingIceCandidates[fromUserId].push(candidate);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка добавления ICE кандидата:`, error);
        }
    }
    
    async processPendingIceCandidates(userId, peerConnection) {
        if (this.pendingIceCandidates[userId] && this.pendingIceCandidates[userId].length > 0) {
            console.log(`🔄 Обработка ${this.pendingIceCandidates[userId].length} ожидающих ICE кандидатов для ${userId}`);
            
            for (const candidate of this.pendingIceCandidates[userId]) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (error) {
                    console.error(`❌ Ошибка добавления отложенного ICE кандидата:`, error);
                }
            }
            
            // Очищаем очередь
            this.pendingIceCandidates[userId] = [];
        }
    }
    
    // ========== УПРАВЛЕНИЕ УЧАСТНИКАМИ ==========
    
    addRemoteParticipant(userId, userName) {
        console.log(`🆕 Добавление участника в интерфейс: ${userName}`);
        
        // Проверяем, не добавлен ли уже
        if (document.getElementById(`participant-${userId}`)) {
            console.log(`⚠️ Участник ${userName} уже в интерфейсе`);
            return;
        }
        
        // Создаем HTML для участника
        const initials = userName ? userName.slice(0, 2).toUpperCase() : 'УЧ';
        
        // 1. Карточка в левой панели (видео)
        const participantCard = document.createElement('div');
        participantCard.className = 'video-participant-card remote-user';
        participantCard.id = `participant-${userId}`;
        participantCard.innerHTML = `
            <div class="video-placeholder">
                <div class="participant-avatar">${initials}</div>
                <video class="remote-video" autoplay playsinline style="display: none;" id="video-${userId}"></video>
            </div>
            <div class="participant-name">${userName}</div>
            <div class="participant-status">
                <img src="/static/images/mic-off.png" alt="Микрофон" class="status-icon muted" id="audio-indicator-${userId}">
                <img src="/static/images/camera-off.png" alt="Камера" class="status-icon muted" id="video-indicator-${userId}">
            </div>
        `;
        
        // Добавляем в левую панель ПОСЛЕ локального участника
        const localParticipant = document.getElementById('participant-local');
        if (localParticipant && localParticipant.nextSibling) {
            localParticipant.parentNode.insertBefore(participantCard, localParticipant.nextSibling);
        } else {
            this.elements.videoParticipantsList.appendChild(participantCard);
        }
        
        // 2. Элемент в списке участников справа
        const listItem = document.createElement('div');
        listItem.className = 'participant-list-item remote-user';
        listItem.id = `list-item-${userId}`;
        listItem.innerHTML = `
            <div class="participant-info">
                <div class="participant-details">
                    <div class="participant-name">${userName}</div>
                </div>
                <div class="participant-controls">
                    <img src="/static/images/mic-off.png" alt="Микрофон" class="status-icon" id="list-audio-${userId}">
                    <img src="/static/images/camera-off.png" alt="Камера" class="status-icon" id="list-video-${userId}">
                </div>
            </div>
        `;
        
        // Добавляем в список ПОСЛЕ локального участника
        const localListItem = document.getElementById('list-item-local');
        if (localListItem && localListItem.nextSibling) {
            localListItem.parentNode.insertBefore(listItem, localListItem.nextSibling);
        } else {
            this.elements.participantsList.appendChild(listItem);
        }
        
        console.log(`✅ Участник ${userName} добавлен в интерфейс`);
    }
    
    updateRemoteVideo(userId, userName, stream) {
        console.log(`🎬 Обновление видео для: ${userName}`);
        
        const videoElement = document.getElementById(`video-${userId}`);
        const participantCard = document.getElementById(`participant-${userId}`);
        
        if (!videoElement || !participantCard) {
            console.error(`❌ Элементы для участника ${userId} не найдены`);
            return;
        }
        
        // Сохраняем поток
        this.remoteStreams[userId] = stream;
        
        // Находим элементы
        const placeholder = participantCard.querySelector('.video-placeholder');
        const avatar = participantCard.querySelector('.participant-avatar');
        
        // Устанавливаем поток
        videoElement.srcObject = stream;
        
        // Обработчики для видео
        videoElement.onloadedmetadata = () => {
            console.log(`✅ Метаданные видео загружены для ${userName}`);
            videoElement.play().catch(e => {
                console.error(`❌ Ошибка воспроизведения:`, e);
            });
        };
        
        videoElement.onloadeddata = () => {
            console.log(`✅ Данные видео загружены для ${userName}`);
            if (placeholder) placeholder.style.display = 'none';
            videoElement.style.display = 'block';
            if (avatar) avatar.style.display = 'none';
            
            // Начинаем мониторинг статуса
            this.startStatusMonitoring(userId, stream);
        };
        
        videoElement.oncanplay = () => {
            console.log(`✅ Видео готово к воспроизведению для ${userName}`);
        };
        
        videoElement.onerror = (e) => {
            console.error(`❌ Ошибка видео для ${userName}:`, e);
        };
    }
    
    startStatusMonitoring(userId, stream) {
        // Останавливаем предыдущий интервал
        if (stream._monitoringInterval) {
            clearInterval(stream._monitoringInterval);
        }
        
        // Создаем новый интервал
        stream._monitoringInterval = setInterval(() => {
            this.updateStatusIndicators(userId, stream);
        }, 1000);
        
        // Первоначальное обновление
        this.updateStatusIndicators(userId, stream);
    }
    
    updateStatusIndicators(userId, stream) {
        try {
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();
            
            const audioEnabled = audioTracks.length > 0 && audioTracks[0]?.enabled;
            const videoEnabled = videoTracks.length > 0 && videoTracks[0]?.enabled;
            
            // Обновляем индикаторы в левой панели
            const audioIndicator = document.getElementById(`audio-indicator-${userId}`);
            const videoIndicator = document.getElementById(`video-indicator-${userId}`);
            
            if (audioIndicator) {
                audioIndicator.src = audioEnabled ? 
                    "/static/images/mic-on.png" : 
                    "/static/images/mic-off.png";
                audioIndicator.classList.toggle('muted', !audioEnabled);
            }
            
            if (videoIndicator) {
                videoIndicator.src = videoEnabled ? 
                    "/static/images/camera-on.png" : 
                    "/static/images/camera-off.png";
                videoIndicator.classList.toggle('muted', !videoEnabled);
            }
            
            // Обновляем индикаторы в списке
            const listAudioIndicator = document.getElementById(`list-audio-${userId}`);
            const listVideoIndicator = document.getElementById(`list-video-${userId}`);
            
            if (listAudioIndicator) {
                listAudioIndicator.src = audioEnabled ? 
                    "/static/images/mic-on.png" : 
                    "/static/images/mic-off.png";
            }
            
            if (listVideoIndicator) {
                listVideoIndicator.src = videoEnabled ? 
                    "/static/images/camera-on.png" : 
                    "/static/images/camera-off.png";
            }
            
            // Обновляем отображение видео/аватара
            const videoElement = document.getElementById(`video-${userId}`);
            const participantCard = document.getElementById(`participant-${userId}`);
            
            if (videoElement && participantCard) {
                const placeholder = participantCard.querySelector('.video-placeholder');
                const avatar = participantCard.querySelector('.participant-avatar');
                
                if (placeholder && avatar) {
                    if (videoEnabled) {
                        placeholder.style.display = 'none';
                        videoElement.style.display = 'block';
                        avatar.style.display = 'none';
                    } else {
                        placeholder.style.display = 'flex';
                        videoElement.style.display = 'none';
                        avatar.style.display = 'flex';
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Ошибка обновления статуса для ${userId}:`, error);
        }
    }
    
    removeParticipant(userId) {
        console.log(`🗑️ Удаление участника: ${userId}`);
        
        // Останавливаем мониторинг
        const stream = this.remoteStreams[userId];
        if (stream && stream._monitoringInterval) {
            clearInterval(stream._monitoringInterval);
        }
        
        // Закрываем PeerConnection
        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }
        
        // Удаляем очередь ICE кандидатов
        delete this.pendingIceCandidates[userId];
        
        // Удаляем поток
        delete this.remoteStreams[userId];
        
        // Удаляем из DOM
        const videoCard = document.getElementById(`participant-${userId}`);
        if (videoCard) videoCard.remove();
        
        const listItem = document.getElementById(`list-item-${userId}`);
        if (listItem) listItem.remove();
        
        console.log(`✅ Участник ${userId} удален`);
    }
    
    // ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
    
    updateParticipantCount() {
        // Считаем всех удаленных участников
        const remoteElements = document.querySelectorAll('.video-participant-card.remote-user');
        const totalCount = remoteElements.length + 1; // +1 для себя
        
        console.log(`👥 Обновление счетчика: удаленные=${remoteElements.length}, всего=${totalCount}`);
        
        if (this.elements.participantCount) {
            this.elements.participantCount.textContent = `👥 ${totalCount}`;
        }
        
        if (this.elements.participantsCount) {
            this.elements.participantsCount.textContent = totalCount;
        }
    }
    
    toggleChat() {
        if (this.elements.chatSidebar.style.display === 'flex') {
            this.elements.participantsSidebar.style.display = 'flex';
            this.elements.chatSidebar.style.display = 'none';
            this.elements.toggleChatBtn.classList.remove('active');
        } else {
            this.elements.participantsSidebar.style.display = 'none';
            this.elements.chatSidebar.style.display = 'flex';
            this.elements.toggleChatBtn.classList.add('active');
        }
    }
    
    toggleLeftPanel() {
        this.elements.leftPanel.classList.toggle('collapsed');
        this.elements.centerPanel.classList.toggle('expanded');
    }
    
    toggleWhiteboard() {
        this.mediaState.whiteboardActive = !this.mediaState.whiteboardActive;
        
        if (this.mediaState.whiteboardActive) {
            this.elements.toggleWhiteboardBtn.classList.add('active');
            this.showNotification('Доска открыта');
        } else {
            this.elements.toggleWhiteboardBtn.classList.remove('active');
            this.showNotification('Доска закрыта');
        }
        
        this.updateMainVideoDisplay();
    }
    
    async toggleScreenShare() {
        try {
            if (!this.mediaState.screenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: false
                });
                
                if (this.elements.screenShareVideo) {
                    this.elements.screenShareVideo.srcObject = this.screenStream;
                }
                
                this.mediaState.screenSharing = true;
                this.updateMainVideoDisplay();
                
                this.elements.toggleScreen.classList.add('active');
                this.showNotification('Демонстрация экрана начата');
                
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
        this.elements.toggleScreen.classList.remove('active');
        this.updateMainVideoDisplay();
        this.showNotification('Демонстрация экрана остановлена');
    }
    
    updateMainVideoDisplay() {
        if (this.mediaState.whiteboardActive) {
            this.elements.mainVideoPlaceholder.style.display = 'none';
            this.elements.mainVideoWrapper.style.display = 'none';
            this.elements.screenShareWrapper.style.display = 'none';
            this.elements.whiteboardFrame.style.display = 'block';
        } else if (this.mediaState.screenSharing) {
            this.elements.mainVideoPlaceholder.style.display = 'none';
            this.elements.mainVideoWrapper.style.display = 'none';
            this.elements.screenShareWrapper.style.display = 'block';
            this.elements.whiteboardFrame.style.display = 'none';
        } else {
            this.elements.screenShareWrapper.style.display = 'none';
            this.elements.whiteboardFrame.style.display = 'none';
            
            if (this.mediaState.videoEnabled && this.mediaState.videoInitialized) {
                this.elements.mainVideoPlaceholder.style.display = 'none';
                this.elements.mainVideoWrapper.style.display = 'block';
            } else {
                this.elements.mainVideoPlaceholder.style.display = 'flex';
                this.elements.mainVideoWrapper.style.display = 'none';
            }
        }
    }
    
    sendChatMessage() {
        const message = this.elements.chatInput.value.trim();
        
        if (message) {
            this.addChatMessage('Вы', message, true);
            this.elements.chatInput.value = '';
            this.autoResizeTextarea();
        }
    }
    
    addChatMessage(sender, text, isOwn = false) {
        const emptyState = this.elements.chatMessages.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        
        const messageDiv = document.createElement('div');
        messageDiv.className = isOwn ? 'message own-message' : 'message remote-message';
        
        const now = new Date();
        const timeString = now.getHours().toString().padStart(2, '0') + ':' + 
                         now.getMinutes().toString().padStart(2, '0');
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${timeString}</span>
            </div>
            <div class="message-text">${text}</div>
        `;
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }
    
    autoResizeTextarea() {
        const textarea = this.elements.chatInput;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
    
    setupAdaptiveLayout() {
        const handleResize = () => {
            const width = window.innerWidth;
            
            if (width <= 768) {
                this.elements.leftPanel.classList.add('collapsed');
                this.elements.centerPanel.classList.add('expanded');
                this.elements.expandLeftPanel.style.display = 'flex';
            } else {
                this.elements.leftPanel.classList.remove('collapsed');
                this.elements.centerPanel.classList.remove('expanded');
                this.elements.expandLeftPanel.style.display = 'none';
            }
        };
        
        window.addEventListener('resize', handleResize);
        handleResize();
    }
    
    forceRedButtons() {
        this.elements.toggleAudio.classList.add('muted');
        this.elements.toggleVideo.classList.add('muted');
    }
    
    updateConnectionStatus(status) {
        const element = this.elements.connectionStatus;
        if (!element) return;
        
        element.style.display = 'block';
        element.className = 'connection-status';
        
        if (status === 'connected') {
            element.textContent = 'Подключено к серверу';
            element.classList.add('connected');
            setTimeout(() => {
                element.style.display = 'none';
            }, 3000);
        } else if (status === 'disconnected') {
            element.textContent = 'Соединение потеряно';
            element.classList.add('disconnected');
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
    
    showError(message) {
        this.showNotification(`Ошибка: ${message}`);
    }
    
    leaveConference() {
        if (confirm('Вы уверены, что хотите покинуть встречу?')) {
            this.cleanup();
            
            if (this.socket) {
                this.socket.emit('leave-room', { roomUrl: this.roomUrl });
                this.socket.disconnect();
            }
            
            window.location.href = '/';
        }
    }
    
    cleanup() {
        console.log('🧹 Очистка ресурсов');
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.audioTrack) {
            this.audioTrack.stop();
        }
        
        if (this.videoTrack) {
            this.videoTrack.stop();
        }
        
        Object.keys(this.peerConnections).forEach(userId => {
            if (this.peerConnections[userId]) {
                this.peerConnections[userId].close();
            }
        });
        
        // Очищаем очереди ICE кандидатов
        this.pendingIceCandidates = {};
    }
    
    hideLoading() {
        if (this.elements.webrtcLoading) {
            this.elements.webrtcLoading.style.display = 'none';
        }
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Загрузка страницы конференции');
    
    if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте современный браузер.');
        return;
    }
    
    window.conference = new VideoConference();
});