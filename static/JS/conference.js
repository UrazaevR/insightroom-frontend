// conference.js
class VideoConference {
    constructor() {
        this.localStream = null;
        this.audioStream = null;
        this.videoStream = null;
        this.isAudioMuted = true;
        this.isVideoMuted = true;
        this.isScreenSharing = false;
        this.mediaAccessGranted = false;
        this.audioLevel = 0;
        this.audioAnalyser = null;
        
        this.initializeElements();
        this.initializeEventListeners();
        this.startWithFallback();
    }

    initializeElements() {
        this.localVideo = document.getElementById('localVideo');
        this.localUserName = document.getElementById('localUserName');
        this.participantsGrid = document.getElementById('participantsGrid');
        this.toggleAudio = document.getElementById('toggleAudio');
        this.toggleVideo = document.getElementById('toggleVideo');
        this.toggleScreen = document.getElementById('toggleScreen');
        this.leaveCall = document.getElementById('leaveCall');
        this.localAudioStatus = document.getElementById('localAudioStatus');
        this.localVideoStatus = document.getElementById('localVideoStatus');
        this.participantCount = document.getElementById('participantCount');
        this.meetingId = document.getElementById('meetingId');
        
        // Получаем данные из URL или localStorage
        const urlParams = new URLSearchParams(window.location.search);
        const meetingId = urlParams.get('id') || localStorage.getItem('currentMeetingId');
        const userName = localStorage.getItem('userName') || 'Участник';
        
        if (meetingId) {
            this.meetingId.textContent = `ID: ${meetingId}`;
        }
        
        if (this.localUserName) {
            this.localUserName.textContent = userName;
        }
    }

    initializeEventListeners() {
        this.toggleAudio.addEventListener('click', () => this.toggleMicrophone());
        this.toggleVideo.addEventListener('click', () => this.toggleCamera());
        this.toggleScreen.addEventListener('click', () => this.toggleScreenShare());
        this.leaveCall.addEventListener('click', () => this.leaveConference());
        
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    async startWithFallback() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            this.mediaAccessGranted = true;
            this.localVideo.srcObject = this.localStream;
            
            // Настраиваем анализ аудио для визуализации
            this.setupAudioAnalysis();
            
            const videoTrack = this.localStream.getVideoTracks()[0];
            const audioTrack = this.localStream.getAudioTracks()[0];
            
            if (videoTrack) {
                this.videoStream = new MediaStream([videoTrack]);
                this.isVideoMuted = !videoTrack.enabled;
            }
            
            if (audioTrack) {
                this.audioStream = new MediaStream([audioTrack]);
                this.isAudioMuted = !audioTrack.enabled;
            }
            
        } catch (error) {
            console.log('Доступ к медиаустройствам не предоставлен');
            this.mediaAccessGranted = false;
            this.createVideoPlaceholder();
        }
        
        this.updateStatusIndicators();
    }

    setupAudioAnalysis() {
        if (!this.audioStream) return;
        
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.audioAnalyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(this.audioStream);
        source.connect(this.audioAnalyser);
        this.audioAnalyser.fftSize = 256;
        
        // Запускаем мониторинг уровня звука
        this.monitorAudioLevel();
    }

    monitorAudioLevel() {
        if (!this.audioAnalyser) return;
        
        const dataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
        
        const checkAudioLevel = () => {
            this.audioAnalyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            
            this.audioLevel = sum / dataArray.length;
            this.updateAudioVisualization();
            
            requestAnimationFrame(checkAudioLevel);
        };
        
        checkAudioLevel();
    }

    updateAudioVisualization() {
        const participantCard = document.querySelector('.local-user');
        if (!participantCard) return;
        
        // Если звук выше порога (например, 10) и микрофон включен
        if (this.audioLevel > 10 && !this.isAudioMuted) {
            participantCard.classList.add('speaking');
        } else {
            participantCard.classList.remove('speaking');
        }
    }

    createVideoPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'video-placeholder';
        const userName = localStorage.getItem('userName') || 'У';
        const firstLetter = userName.charAt(0).toUpperCase();
        
        placeholder.innerHTML = `
            <div class="placeholder-content">
                <div class="user-avatar large" style="background-color: ${this.getRandomColor(userName)}">
                    ${firstLetter}
                </div>
            </div>
        `;
        
        this.localVideo.style.display = 'none';
        this.localVideo.parentElement.appendChild(placeholder);
    }

    getRandomColor(userName) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
        ];
        let hash = 0;
        for (let i = 0; i < userName.length; i++) {
            hash = userName.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    async requestMicrophoneOnly() {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            
            if (this.localStream) {
                const oldAudioTracks = this.localStream.getAudioTracks();
                oldAudioTracks.forEach(track => {
                    this.localStream.removeTrack(track);
                });
                this.localStream.addTrack(this.audioStream.getAudioTracks()[0]);
            } else {
                this.localStream = this.audioStream;
            }
            
            // Настраиваем анализ аудио
            this.setupAudioAnalysis();
            
            this.isAudioMuted = false;
            this.updateAudioUI();
            this.showNotification('Микрофон подключен');
            
        } catch (error) {
            console.error('Не удалось получить доступ к микрофону:', error);
            this.showNotification('Не удалось получить доступ к микрофону');
        }
    }

    async requestCameraOnly() {
        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            });
            
            if (this.localStream) {
                const oldVideoTracks = this.localStream.getVideoTracks();
                oldVideoTracks.forEach(track => {
                    this.localStream.removeTrack(track);
                });
                this.localStream.addTrack(this.videoStream.getVideoTracks()[0]);
            } else {
                this.localStream = this.videoStream;
            }
            
            this.localVideo.srcObject = this.localStream;
            
            const placeholder = this.localVideo.parentElement.querySelector('.video-placeholder');
            if (placeholder) {
                placeholder.remove();
                this.localVideo.style.display = 'block';
            }
            
            this.isVideoMuted = false;
            this.updateVideoUI();
            this.showNotification('Камера подключена');
            
        } catch (error) {
            console.error('Не удалось получить доступ к камере:', error);
            this.showNotification('Не удалось получить доступ к камере');
        }
    }

    async toggleMicrophone() {
        if (!this.audioStream && this.isAudioMuted) {
            await this.requestMicrophoneOnly();
            return;
        }
        
        if (this.audioStream) {
            const audioTracks = this.audioStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioTracks[0].enabled = !audioTracks[0].enabled;
                this.isAudioMuted = !audioTracks[0].enabled;
                this.updateAudioUI();
                
                if (audioTracks[0].enabled) {
                    this.setupAudioAnalysis();
                }
            }
        }
    }

    async toggleCamera() {
        if (!this.videoStream && this.isVideoMuted) {
            await this.requestCameraOnly();
            return;
        }
        
        if (this.videoStream) {
            const videoTracks = this.videoStream.getVideoTracks();
            if (videoTracks.length > 0) {
                videoTracks[0].enabled = !videoTracks[0].enabled;
                this.isVideoMuted = !videoTracks[0].enabled;
                this.updateVideoUI();
                
                if (videoTracks[0].enabled) {
                    this.localVideo.style.display = 'block';
                    const placeholder = this.localVideo.parentElement.querySelector('.video-placeholder');
                    if (placeholder) {
                        placeholder.remove();
                    }
                } else {
                    this.createVideoPlaceholder();
                }
            }
        }
    }

    async toggleScreenShare() {
        try {
            if (!this.isScreenSharing) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                        displaySurface: 'window'
                    },
                    audio: true
                });
                
                const screenVideoTrack = screenStream.getVideoTracks()[0];
                const screenAudioTrack = screenStream.getAudioTracks()[0];
                
                const newStream = new MediaStream();
                if (screenVideoTrack) newStream.addTrack(screenVideoTrack);
                if (screenAudioTrack) newStream.addTrack(screenAudioTrack);
                
                if (this.audioStream) {
                    const audioTrack = this.audioStream.getAudioTracks()[0];
                    if (audioTrack) {
                        newStream.addTrack(audioTrack);
                    }
                }
                
                this.localStream = newStream;
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = 'block';
                
                const placeholder = this.localVideo.parentElement.querySelector('.video-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
                
                this.isScreenSharing = true;
                this.updateScreenShareUI();
                this.showNotification('Демонстрация экрана начата');
                
                screenVideoTrack.onended = () => {
                    this.stopScreenShare();
                };
                
            } else {
                this.stopScreenShare();
            }
        } catch (error) {
            console.error('Ошибка общего доступа к экрану:', error);
            this.showNotification('Не удалось начать демонстрацию экрана');
        }
    }

    stopScreenShare() {
        if (this.isScreenSharing) {
            this.isScreenSharing = false;
            this.updateScreenShareUI();
            
            const newStream = new MediaStream();
            
            if (this.videoStream) {
                const videoTrack = this.videoStream.getVideoTracks()[0];
                if (videoTrack) {
                    newStream.addTrack(videoTrack);
                }
            }
            
            if (this.audioStream) {
                const audioTrack = this.audioStream.getAudioTracks()[0];
                if (audioTrack) {
                    newStream.addTrack(audioTrack);
                }
            }
            
            this.localStream = newStream;
            this.localVideo.srcObject = this.localStream;
            
            if (!this.videoStream || this.isVideoMuted) {
                this.createVideoPlaceholder();
            }
            
            this.showNotification('Демонстрация экрана остановлена');
        }
    }

    updateAudioUI() {
        // Обновляем только иконку в панели управления
        const icon = this.isAudioMuted ? 'mic-off' : 'mic-on';
        this.toggleAudio.innerHTML = `<img src="../images/${icon}.png" alt="Микрофон" class="control-icon">`;
        this.toggleAudio.classList.toggle('muted', this.isAudioMuted);
        
        // Обновляем индикатор статуса
        if (this.localAudioStatus) {
            this.localAudioStatus.classList.toggle('muted', this.isAudioMuted);
        }
    }

    updateVideoUI() {
        const icon = this.isVideoMuted ? 'camera-off' : 'camera-on';
        this.toggleVideo.innerHTML = `<img src="../images/${icon}.png" alt="Камера" class="control-icon">`;
        this.toggleVideo.classList.toggle('muted', this.isVideoMuted);
        
        if (this.localVideoStatus) {
            this.localVideoStatus.classList.toggle('muted', this.isVideoMuted);
        }
    }

    updateScreenShareUI() {
        const icon = this.isScreenSharing ? 'screen-share-active' : 'screen-share';
        this.toggleScreen.innerHTML = `<img src="../images/${icon}.png" alt="Демонстрация экрана" class="control-icon">`;
        this.toggleScreen.classList.toggle('active', this.isScreenSharing);
    }

    updateStatusIndicators() {
        this.updateAudioUI();
        this.updateVideoUI();
        this.updateScreenShareUI();
        
        // Устанавливаем иконку для кнопки выхода
        this.leaveCall.innerHTML = `<img src="../images/leave-call.png" alt="Покинуть встречу" class="control-icon">`;
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'media-notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    leaveConference() {
        if (confirm('Покинуть встречу?')) {
            this.cleanup();
            window.location.href = '../index.html';
        }
    }

    cleanup() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
        }
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает видеоконференции');
        window.location.href = '../index.html';
        return;
    }
    
    new VideoConference();
});