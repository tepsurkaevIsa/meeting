// WebRTC клиент для аудиозвонков
class AudioCallClient {
    constructor() {
        // Проверка поддержки WebRTC
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Ваш браузер не поддерживает WebRTC. Используйте современный браузер (Chrome, Firefox, Safari, Edge).');
            return;
        }

        this.socket = io();
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.roomId = null;
        this.username = null;
        this.isMuted = false;
        this.iceCandidatesQueue = [];
        this.isInitiator = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
    }

    initializeElements() {
        // Inputs
        this.usernameInput = document.getElementById('usernameInput');
        this.roomIdInput = document.getElementById('roomIdInput');
        
        // Buttons
        this.joinBtn = document.getElementById('joinBtn');
        this.createBtn = document.getElementById('createBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.hangupBtn = document.getElementById('hangupBtn');
        this.copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
        
        // Sections
        this.connectionSection = document.getElementById('connectionSection');
        this.callSection = document.getElementById('callSection');
        
        // Status
        this.status = document.getElementById('status');
        this.localUsernameEl = document.getElementById('localUsername');
        this.remoteUsernameEl = document.getElementById('remoteUsername');
        this.currentRoomIdEl = document.getElementById('currentRoomId');
        this.audioWave = document.getElementById('audioWave');
    }

    setupEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinRoom());
        this.createBtn.addEventListener('click', () => this.createRoom());
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.hangupBtn.addEventListener('click', () => this.hangup());
        this.copyRoomIdBtn.addEventListener('click', () => this.copyRoomId());
        
        // Enter key support
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    setupSocketListeners() {
        this.socket.on('room-created', (data) => {
            this.roomId = data.roomId;
            this.currentRoomIdEl.textContent = this.roomId;
            this.updateStatus('Комната создана. Ожидание пользователя...', 'connecting');
            this.showCallSection();
        });

        this.socket.on('room-joined', (data) => {
            this.roomId = data.roomId;
            this.currentRoomIdEl.textContent = this.roomId;
            this.updateStatus('Подключение к комнате...', 'connecting');
            this.showCallSection();
        });

        this.socket.on('user-joined', async (data) => {
            this.updateStatus('Пользователь присоединился. Установка соединения...', 'connecting');
            this.isInitiator = true;
            this.iceCandidatesQueue = [];
            await this.createPeerConnection();
            await this.startLocalStream();
            await this.createOffer();
        });

        this.socket.on('user-left', () => {
            this.updateStatus('Пользователь покинул комнату', 'connecting');
            this.remoteUsernameEl.textContent = 'Ожидание пользователя';
            this.cleanup();
        });

        this.socket.on('offer', async (data) => {
            this.isInitiator = false;
            this.iceCandidatesQueue = [];
            if (!this.peerConnection) {
                await this.createPeerConnection();
                await this.startLocalStream();
            }
            await this.handleOffer(data.offer);
            // Обрабатываем накопленные ICE кандидаты
            this.processIceCandidatesQueue();
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data.answer);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data.candidate);
        });

        this.socket.on('connect', () => {
            console.log('Подключено к серверу');
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('Соединение с сервером потеряно', 'connecting');
        });

        this.socket.on('error', (error) => {
            alert('Ошибка: ' + error.message);
            this.updateStatus('Ошибка подключения', 'connecting');
        });
    }

    async createRoom() {
        const username = this.usernameInput.value.trim();
        if (!username) {
            alert('Пожалуйста, введите ваше имя');
            return;
        }
        
        this.username = username;
        this.localUsernameEl.textContent = username;
        this.socket.emit('create-room', { username });
    }

    async joinRoom() {
        const username = this.usernameInput.value.trim();
        const roomId = this.roomIdInput.value.trim();
        
        if (!username) {
            alert('Пожалуйста, введите ваше имя');
            return;
        }
        
        if (!roomId) {
            alert('Пожалуйста, введите ID комнаты');
            return;
        }
        
        this.username = username;
        this.localUsernameEl.textContent = username;
        this.socket.emit('join-room', { roomId, username });
    }

    async startLocalStream() {
        try {
            if (this.localStream) {
                // Если поток уже есть, останавливаем старые треки
                this.localStream.getTracks().forEach(track => track.stop());
            }

            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            
            // Добавляем аудио треки в peer connection только если они еще не добавлены
            this.localStream.getTracks().forEach(track => {
                const sender = this.peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === track.kind
                );
                if (!sender) {
                    this.peerConnection.addTrack(track, this.localStream);
                }
            });
            
            this.updateAudioIndicator(true);
            this.startAudioLevelMonitoring();
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            let errorMsg = 'Не удалось получить доступ к микрофону. ';
            if (error.name === 'NotAllowedError') {
                errorMsg += 'Разрешите доступ к микрофону в настройках браузера.';
            } else if (error.name === 'NotFoundError') {
                errorMsg += 'Микрофон не найден.';
            } else {
                errorMsg += 'Проверьте настройки устройства.';
            }
            alert(errorMsg);
            this.updateStatus('Ошибка доступа к микрофону', 'connecting');
        }
    }

    async createPeerConnection() {
        // Закрываем предыдущее соединение, если есть
        if (this.peerConnection) {
            this.peerConnection.close();
        }

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

        this.peerConnection = new RTCPeerConnection(configuration);

        // Обработка удаленного потока
        this.peerConnection.ontrack = (event) => {
            console.log('Получен удаленный поток:', event);
            this.remoteStream = event.streams[0];
            this.updateStatus('Соединение установлено', 'connected');
            this.remoteUsernameEl.textContent = 'Пользователь подключен';
            
            // Создаем аудио элемент для воспроизведения (опционально, для отладки)
            if (this.remoteStream) {
                const audio = new Audio();
                audio.srcObject = this.remoteStream;
                audio.play().catch(e => console.log('Автовоспроизведение заблокировано'));
            }
        };

        // Обработка ICE кандидатов
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    roomId: this.roomId,
                    candidate: event.candidate
                });
            } else {
                console.log('Все ICE кандидаты собраны');
            }
        };

        // Обработка изменения состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('Connection state:', state);
            
            switch(state) {
                case 'connected':
                    this.updateStatus('Соединение установлено', 'connected');
                    break;
                case 'disconnected':
                    this.updateStatus('Соединение прервано', 'connecting');
                    break;
                case 'failed':
                    this.updateStatus('Ошибка соединения. Попробуйте переподключиться.', 'connecting');
                    break;
                case 'closed':
                    console.log('Соединение закрыто');
                    break;
            }
        };

        // Обработка ICE соединения
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('ICE connection state:', state);
            
            if (state === 'failed' || state === 'disconnected') {
                // Попытка восстановления
                if (state === 'failed') {
                    this.updateStatus('Проблемы с соединением. Попробуйте переподключиться.', 'connecting');
                }
            }
        };
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: offer
            });
        } catch (error) {
            console.error('Ошибка создания offer:', error);
        }
    }

    async handleOffer(offer) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: answer
            });
        } catch (error) {
            console.error('Ошибка обработки offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            // Обрабатываем накопленные ICE кандидаты
            this.processIceCandidatesQueue();
        } catch (error) {
            console.error('Ошибка обработки answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            // Если remote description еще не установлен, сохраняем кандидата в очередь
            if (!this.peerConnection.remoteDescription) {
                this.iceCandidatesQueue.push(candidate);
                console.log('ICE candidate добавлен в очередь');
                return;
            }
            
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate добавлен');
        } catch (error) {
            console.error('Ошибка обработки ICE candidate:', error);
        }
    }

    async processIceCandidatesQueue() {
        while (this.iceCandidatesQueue.length > 0) {
            const candidate = this.iceCandidatesQueue.shift();
            try {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('ICE candidate из очереди добавлен');
            } catch (error) {
                console.error('Ошибка обработки ICE candidate из очереди:', error);
            }
        }
    }

    startAudioLevelMonitoring() {
        if (!this.localStream) return;

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(this.localStream);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;
        microphone.connect(analyser);

        const checkAudioLevel = () => {
            if (!this.localStream || this.isMuted) {
                this.updateAudioIndicator(false);
                return;
            }

            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const level = average / 255;

            if (level > 0.01) {
                this.updateAudioIndicator(true);
            } else {
                this.updateAudioIndicator(false);
            }

            if (this.localStream) {
                requestAnimationFrame(checkAudioLevel);
            }
        };

        checkAudioLevel();
    }

    toggleMute() {
        if (this.localStream) {
            this.isMuted = !this.isMuted;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
            
            if (this.isMuted) {
                this.muteBtn.classList.add('muted');
                this.muteBtn.innerHTML = '<span class="icon">🔇</span><span>Включить микрофон</span>';
                this.updateAudioIndicator(false);
            } else {
                this.muteBtn.classList.remove('muted');
                this.muteBtn.innerHTML = '<span class="icon">🎤</span><span>Выключить микрофон</span>';
                this.updateAudioIndicator(true);
            }
        }
    }

    hangup() {
        this.socket.emit('leave-room', { roomId: this.roomId });
        this.cleanup();
        this.showConnectionSection();
        this.updateStatus('Звонок завершен', 'connecting');
    }

    cleanup() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            this.localStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                }
            });
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.remoteStream = null;
        this.iceCandidatesQueue = [];
        this.isInitiator = false;
        this.updateAudioIndicator(false);
    }

    showCallSection() {
        this.connectionSection.classList.add('hidden');
        this.callSection.classList.remove('hidden');
    }

    showConnectionSection() {
        this.callSection.classList.add('hidden');
        this.connectionSection.classList.remove('hidden');
        this.roomId = null;
        this.username = null;
        this.usernameInput.value = '';
        this.roomIdInput.value = '';
    }

    updateStatus(message, type = '') {
        this.status.textContent = message;
        this.status.className = 'status ' + type;
    }

    updateAudioIndicator(active) {
        if (active && !this.isMuted) {
            this.audioWave.classList.add('active');
        } else {
            this.audioWave.classList.remove('active');
        }
    }

    copyRoomId() {
        if (this.roomId) {
            navigator.clipboard.writeText(this.roomId).then(() => {
                const originalText = this.copyRoomIdBtn.textContent;
                this.copyRoomIdBtn.textContent = 'Скопировано!';
                setTimeout(() => {
                    this.copyRoomIdBtn.textContent = originalText;
                }, 2000);
            });
        }
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new AudioCallClient();
});

