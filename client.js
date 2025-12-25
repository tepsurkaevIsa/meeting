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
        this.remoteAudio = null;
        
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
        this.audioStatus = document.getElementById('audioStatus');
        this.audioStatusText = document.getElementById('audioStatusText');
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

        this.socket.on('connect_error', (error) => {
            console.error('Ошибка подключения к серверу:', error);
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

            // Оптимальные настройки для высокого качества аудио
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000, // Высокое качество (48kHz)
                    channelCount: 1, // Моно для голоса
                    latency: 0, // Минимальная задержка
                    sampleSize: 16,
                    // Дополнительные параметры для лучшего качества
                    googEchoCancellation: true,
                    googNoiseSuppression: true,
                    googAutoGainControl: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true,
                    googNoiseReduction: true
                },
                video: false
            });
            
            // Добавляем аудио треки в peer connection только если они еще не добавлены
            this.localStream.getTracks().forEach(track => {
                console.log('✅ Локальный аудио трек получен:', track.label || track.id);
                
                // ВАЖНО: Убеждаемся, что трек не muted
                if (track.muted) {
                    console.warn('⚠️ ВНИМАНИЕ: Локальный трек muted! Включите микрофон.');
                    track.enabled = true;
                }
                
                // Следим за изменениями muted состояния
                track.onmute = () => {
                    console.warn('⚠️ Локальный трек стал muted');
                };
                
                track.onunmute = () => {
                    console.log('✅ Локальный трек unmuted');
                };
                
                const sender = this.peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === track.kind
                );
                if (!sender) {
                    console.log('Добавление локального трека в peer connection');
                    const newSender = this.peerConnection.addTrack(track, this.localStream);
                    
                    // Настраиваем параметры кодека для лучшего качества
                    this.configureAudioCodec(newSender);
                } else {
                    console.log('Трек уже добавлен в peer connection');
                    // Обновляем трек в sender, если нужно
                    if (sender.track && sender.track.id !== track.id) {
                        console.log('Замена трека в sender');
                        sender.replaceTrack(track);
                    }
                    // Настраиваем параметры кодека
                    this.configureAudioCodec(sender);
                }
            });
            
            // Проверяем senders после добавления
            const senders = this.peerConnection.getSenders();
            console.log(`✅ Добавлено ${senders.length} sender(s) в peer connection`);
            
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

        // Оптимальная конфигурация для высокого качества аудио
        // Стратегия: сначала пробуем прямое соединение (STUN) - быстрее и лучше качество
        // TURN используется только если прямое соединение невозможно (строгий NAT/firewall)
        const configuration = {
            iceServers: [
                // STUN серверы (приоритет - для прямого P2P соединения)
                // Прямое соединение: быстрее, меньше задержка, лучше качество
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                // TURN серверы (fallback - только если прямое соединение невозможно)
                // Используется автоматически только при необходимости (строгий NAT)
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:443',
                        'turn:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 0, // Отключаем предварительный сбор для меньшей задержки
            // 'all' = сначала пробуем STUN (прямое соединение), потом TURN (если нужно)
            // Это оптимально: прямое соединение быстрее и дает лучшее качество
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle', // Объединяем потоки для эффективности
            rtcpMuxPolicy: 'require', // Обязательный RTCP mux для меньшей задержки
            sdpSemantics: 'unified-plan' // Современный стандарт
        };
        
        console.log('🔧 ICE конфигурация:', {
            policy: configuration.iceTransportPolicy,
            strategy: 'Сначала прямое соединение (STUN), затем TURN если нужно',
            stunServers: 3,
            turnServers: 1
        });

        this.peerConnection = new RTCPeerConnection(configuration);
        
        // Настраиваем параметры для всех senders после создания соединения
        this.peerConnection.addEventListener('negotiationneeded', () => {
            this.peerConnection.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                    this.configureAudioCodec(sender);
                }
            });
        });

        // Обработка удаленного потока
        this.peerConnection.ontrack = (event) => {
            console.log('✅ Получен удаленный аудио трек');
            
            // Получаем поток из события
            const stream = event.streams[0] || event.stream;
            
            if (!stream) {
                console.error('Поток не найден в событии!');
                return;
            }
            
            this.remoteStream = stream;
            
            // Обрабатываем трек
            const track = event.track;
                if (track.kind === 'audio') {
                console.log('🎵 Обработка аудио трека');
                
                // Следим за изменениями состояния трека
                track.onended = () => {
                    console.log('Аудио трек завершен');
                };
                
                track.onmute = () => {
                    console.warn('⚠️ Аудио трек приглушен (muted)');
                    this.updateStatus('Собеседник выключил микрофон', 'connected');
                };
                
                // Сохраняем ссылку на функцию playAudio для использования в onunmute
                const playAudioWhenUnmuted = () => {
                    console.log('✅ Аудио трек разглушен (unmuted) - запускаем воспроизведение');
                    this.updateStatus('Соединение установлено', 'connected');
                    
                    // Когда трек становится unmuted, пытаемся воспроизвести
                    if (this.remoteAudio && this.remoteAudio.srcObject) {
                        const stream = this.remoteAudio.srcObject;
                        const activeTracks = stream.getAudioTracks().filter(t => 
                            t.readyState === 'live' && t.enabled && !t.muted
                        );
                        
                        console.log('Активных треков после unmute:', activeTracks.length);
                        
                        if (activeTracks.length > 0) {
                            // Убеждаемся, что поток установлен
                            if (this.remoteAudio.srcObject !== stream) {
                                this.remoteAudio.srcObject = stream;
                            }
                            
                        this.remoteAudio.play().then(() => {
                            console.log('✅ Воспроизведение начато после unmute');
                            
                            // Запускаем мониторинг аудио потока
                            this.startRemoteAudioMonitoring(stream);
                            
                            this.showAudioStatus(true);
                            this.updateStatus('Соединение установлено', 'connected');
                        }).catch(e => {
                            console.error('Ошибка воспроизведения после unmute:', e);
                            // Показываем подсказку пользователю
                            this.updateStatus('Соединение установлено. Кликните для воспроизведения звука', 'connected');
                        });
                        }
                    }
                };
                
                track.onunmute = playAudioWhenUnmuted;
                
                // Проверяем начальное состояние
                if (track.muted) {
                    console.warn('⚠️ ВНИМАНИЕ: Трек приходит с muted=true!');
                    console.warn('Это может означать:');
                    console.warn('1. Удаленный пользователь не говорит в микрофон');
                    console.warn('2. Микрофон выключен на стороне отправителя');
                    console.warn('3. Трек еще не активирован');
                    console.warn('Ожидание события unmute...');
                    this.updateStatus('Соединение установлено. Ожидание звука от собеседника...', 'connected');
                } else {
                    console.log('✅ Трек не muted, звук должен передаваться');
                }
                
                // Дополнительная проверка: следим за изменениями muted состояния
                let muteCheckInterval = setInterval(() => {
                    if (!track.muted) {
                        clearInterval(muteCheckInterval);
                    }
                }, 2000);
                
                // Останавливаем проверку через 30 секунд
                setTimeout(() => {
                    clearInterval(muteCheckInterval);
                }, 30000);
                
                // Создаем или обновляем audio элемент
                if (!this.remoteAudio) {
                    this.remoteAudio = new Audio();
                    this.remoteAudio.autoplay = true;
                    this.remoteAudio.volume = 1.0;
                    this.remoteAudio.playsInline = true;
                    
                    // Обработка событий аудио
                    this.remoteAudio.onerror = (e) => {
                        console.error('Ошибка воспроизведения аудио:', e);
                        console.error('Audio error details:', this.remoteAudio.error);
                    };
                    
                    this.remoteAudio.onloadedmetadata = () => {
                        console.log('Метаданные аудио загружены');
                        console.log('Audio duration:', this.remoteAudio.duration);
                    };
                    
                    this.remoteAudio.oncanplay = () => {
                        console.log('Аудио готово к воспроизведению');
                    };
                    
                    this.remoteAudio.onplay = () => {
                        console.log('Воспроизведение начато');
                    };
                    
                    this.remoteAudio.onpause = () => {
                        console.log('Воспроизведение приостановлено');
                    };
                }
                
                // Устанавливаем поток в audio элемент
                this.remoteAudio.srcObject = stream;
                
                // Проверяем состояние треков в потоке
                const audioTracks = stream.getAudioTracks();
                const activeTracksCount = audioTracks.filter(t => !t.muted && t.enabled).length;
                console.log(`📊 Аудио треков в потоке: ${audioTracks.length}, активных: ${activeTracksCount}`);
                
                // Пытаемся воспроизвести
                const playAudio = () => {
                    if (this.remoteAudio && this.remoteAudio.srcObject) {
                        // Проверяем, есть ли активные треки
                        const activeTracks = stream.getAudioTracks().filter(t => 
                            t.readyState === 'live' && t.enabled && !t.muted
                        );
                        
                        if (activeTracks.length === 0) {
                            console.warn('⚠️ Нет активных треков для воспроизведения (трек muted)');
                            console.warn('Ожидание, когда трек станет unmuted...');
                            this.updateStatus('Соединение установлено. Ожидание звука от собеседника...', 'connected');
                            
                            // onunmute уже установлен выше, он вызовет playAudioWhenUnmuted
                            // Не нужно устанавливать его снова
                            return;
                        }
                        
                        // Устанавливаем поток в audio элемент (на случай, если еще не установлен)
                        if (this.remoteAudio.srcObject !== stream) {
                            this.remoteAudio.srcObject = stream;
                        }
                        
                        this.remoteAudio.play().then(() => {
                            console.log('✅ Удаленное аудио воспроизводится!');
                            
                            // ВАЖНО: Проверяем статистику соединения
                            setTimeout(() => {
                                this.checkConnectionStats();
                            }, 2000);
                            
                            // Периодическая проверка статистики
                            const statsInterval = setInterval(() => {
                                if (this.peerConnection && this.remoteStream) {
                                    this.checkConnectionStats();
                                } else {
                                    clearInterval(statsInterval);
                                }
                            }, 5000);
                            
                            // Останавливаем проверку через 60 секунд
                            setTimeout(() => {
                                clearInterval(statsInterval);
                            }, 60000);
                            
                            // Запускаем мониторинг аудио потока
                            this.startRemoteAudioMonitoring(stream);
                            
                            // Дополнительная проверка: убеждаемся, что Audio элемент действительно воспроизводит
                            setTimeout(() => {
                                if (this.remoteAudio && !this.remoteAudio.paused) {
                                    console.log('Проверка Audio элемента через 1 секунду:', {
                                        paused: this.remoteAudio.paused,
                                        muted: this.remoteAudio.muted,
                                        volume: this.remoteAudio.volume,
                                        currentTime: this.remoteAudio.currentTime,
                                        readyState: this.remoteAudio.readyState
                                    });
                                    
                                    // Проверяем, есть ли реальные данные
                                    if (this.remoteAudio.currentTime === 0 && this.remoteAudio.readyState >= 2) {
                                        console.warn('⚠️ Audio элемент не воспроизводит - возможно нет данных');
                                    }
                                }
                            }, 1000);
                            
                            this.updateStatus('Соединение установлено', 'connected');
                            this.remoteUsernameEl.textContent = 'Пользователь подключен';
                            this.showAudioStatus(true);
                        }).catch(error => {
                            console.error('❌ Ошибка автовоспроизведения:', error);
                            console.error('Error name:', error.name);
                            console.error('Error message:', error.message);
                            this.updateStatus('Соединение установлено. Нажмите для воспроизведения звука', 'connected');
                            this.remoteUsernameEl.textContent = 'Пользователь подключен (нажмите для звука)';
                            
                            // Добавляем обработчик клика для воспроизведения
                            const clickHandler = () => {
                                if (this.remoteAudio && this.remoteAudio.paused && this.remoteAudio.srcObject) {
                                    this.remoteAudio.play().then(() => {
                                        console.log('✅ Воспроизведение начато после клика');
                                        this.updateStatus('Соединение установлено', 'connected');
                                        this.remoteUsernameEl.textContent = 'Пользователь подключен';
                                        this.showAudioStatus(true);
                                    }).catch(e => {
                                        console.error('❌ Ошибка воспроизведения после клика:', e);
                                    });
                                }
                            };
                            
                            // Удаляем старый обработчик, если есть
                            document.removeEventListener('click', this._audioClickHandler);
                            this._audioClickHandler = clickHandler;
                            document.addEventListener('click', clickHandler, { once: true });
                        });
                    }
                };
                
                // Пытаемся воспроизвести сразу
                playAudio();
                
                // Также пробуем после небольшой задержки (на случай, если поток еще не готов)
                setTimeout(() => {
                    if (this.remoteAudio && this.remoteAudio.paused) {
                        console.log('Повторная попытка воспроизведения через 500ms');
                        playAudio();
                    }
                }, 500);
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
                console.log('✅ Все ICE кандидаты собраны');
            }
        };

        // Обработка изменения состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('📡 Connection state:', state);
            
            switch(state) {
                case 'connected':
                    this.updateStatus('Соединение установлено', 'connected');
                    
                    // Настраиваем параметры кодека после установления соединения
                    this.peerConnection.getSenders().forEach(sender => {
                        if (sender.track && sender.track.kind === 'audio') {
                            this.configureAudioCodec(sender);
                        }
                    });
                    
                    // Убеждаемся, что аудио воспроизводится
                    if (this.remoteAudio && this.remoteAudio.paused) {
                        this.remoteAudio.play().catch(e => console.log('Ошибка воспроизведения:', e));
                    }
                    break;
                case 'disconnected':
                    this.updateStatus('Соединение прервано', 'connecting');
                    break;
                case 'failed':
                    console.error('❌ Connection state: FAILED');
                    console.error('WebRTC соединение не может установиться');
                    
                    // Показываем более подробную информацию
                    const iceState = this.peerConnection.iceConnectionState;
                    const iceGatheringState = this.peerConnection.iceGatheringState;
                    const signalingState = this.peerConnection.signalingState;
                    
                    console.error('ICE connection state:', iceState);
                    console.error('ICE gathering state:', iceGatheringState);
                    console.error('Signaling state:', signalingState);
                    
                    // Проверяем, есть ли активные треки - если есть, продолжаем работу
                    const hasActiveTracks = this.remoteStream && 
                        this.remoteStream.getAudioTracks().some(t => 
                            t.readyState === 'live' && t.enabled && !t.muted
                        );
                    
                    if (hasActiveTracks) {
                        console.warn('⚠️ Connection failed, но треки активны - продолжаем работу');
                        this.updateStatus('Соединение установлено (нестабильное)', 'connected');
                        // Не прерываем работу, если треки работают
                        return;
                    }
                    
                    // Проверяем, какие кандидаты собраны
                    this.peerConnection.getStats().then(stats => {
                        let hasHost = false;
                        let hasSrflx = false;
                        let hasRelay = false;
                        
                        stats.forEach(report => {
                            if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                                if (report.candidateType === 'host') hasHost = true;
                                if (report.candidateType === 'srflx') hasSrflx = true;
                                if (report.candidateType === 'relay') hasRelay = true;
                            }
                        });
                        
                        console.log('ICE кандидаты:', {
                            host: hasHost,
                            srflx: hasSrflx,
                            relay: hasRelay
                        });
                        
                        if (!hasRelay) {
                            console.warn('⚠️ TURN сервер не используется!');
                            console.warn('Это может быть причиной failed соединения при строгом NAT');
                            console.warn('Попробуйте использовать другую сеть или VPN');
                        }
                    }).catch(e => console.error('Ошибка получения stats:', e));
                    
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
            console.log('🌐 ICE connection state:', state);
            
            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE соединение установлено:', state);
                
                // Настраиваем параметры кодека после установления соединения
                this.peerConnection.getSenders().forEach(sender => {
                    if (sender.track && sender.track.kind === 'audio') {
                        this.configureAudioCodec(sender);
                    }
                });
                
                // Проверяем наличие треков
                const receivers = this.peerConnection.getReceivers();
                console.log('Получено треков:', receivers.length);
                receivers.forEach((receiver, index) => {
                    if (receiver.track) {
                        console.log(`Трек ${index}:`, receiver.track.kind, receiver.track.enabled, receiver.track.readyState);
                    }
                });
                
                // Проверяем статистику соединения
                setTimeout(() => {
                    this.checkConnectionStats();
                }, 1000);
            }
            
            if (state === 'failed') {
                console.error('❌ ICE соединение failed!');
                console.error('Возможные причины:');
                console.error('1. Проблемы с NAT/firewall - нужен TURN сервер');
                console.error('2. Нестабильное интернет-соединение');
                console.error('3. Проблемы с STUN/TURN серверами');
                
                // Проверяем статистику - используется ли TURN
                this.peerConnection.getStats().then(stats => {
                    let usingRelay = false;
                    stats.forEach(report => {
                        if ((report.type === 'local-candidate' || report.type === 'remote-candidate') && 
                            report.candidateType === 'relay') {
                            usingRelay = true;
                            console.log('✅ TURN сервер используется:', report.candidate);
                        }
                    });
                    
                    if (!usingRelay) {
                        console.error('❌ КРИТИЧНО: TURN сервер НЕ используется!');
                        console.error('Это основная причина failed соединения.');
                        console.error('Решения:');
                        console.error('1. Использовать VPN');
                        console.error('2. Использовать другую сеть (мобильный интернет)');
                        console.error('3. Настроить свой TURN сервер');
                    }
                }).catch(e => console.error('Ошибка проверки TURN:', e));
                
                // Проверяем, есть ли активные треки - если есть, продолжаем работу
                const hasActiveTracks = this.remoteStream && 
                    this.remoteStream.getAudioTracks().some(t => 
                        t.readyState === 'live' && t.enabled && !t.muted
                    );
                
                if (hasActiveTracks) {
                    console.warn('⚠️ ICE failed, но треки активны - продолжаем работу');
                    this.updateStatus('Соединение установлено (нестабильное)', 'connected');
                    return; // Не прерываем работу
                }
                
                this.updateStatus('Ошибка соединения. Попробуйте переподключиться или проверьте интернет.', 'connecting');
                
                // Не делаем автоматический hangup, если треки работают
                setTimeout(() => {
                    if (this.peerConnection && 
                        this.peerConnection.iceConnectionState === 'failed' &&
                        !hasActiveTracks) {
                        console.log('Попытка восстановления соединения...');
                        // Не делаем hangup автоматически, пусть пользователь сам решит
                    }
                }, 5000);
            } else if (state === 'disconnected') {
                console.warn('⚠️ ICE соединение disconnected');
                
                // Проверяем, есть ли активные треки
                const hasActiveTracks = this.remoteStream && 
                    this.remoteStream.getAudioTracks().some(t => 
                        t.readyState === 'live' && t.enabled && !t.muted
                    );
                
                if (hasActiveTracks) {
                    console.warn('⚠️ ICE disconnected, но треки активны - продолжаем работу');
                    this.updateStatus('Соединение установлено (нестабильное)', 'connected');
                    return;
                }
                
                console.warn('Попытка восстановления...');
                this.updateStatus('Соединение прервано. Ожидание восстановления...', 'connecting');
                
                // Ждем немного, может восстановится
                setTimeout(() => {
                    if (this.peerConnection && this.peerConnection.iceConnectionState === 'disconnected') {
                        console.warn('Соединение не восстановилось, возможно нужно переподключиться');
                    }
                }, 5000);
            } else if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE соединение установлено:', state);
                this.updateStatus('Соединение установлено', 'connected');
            }
        };
    }

    async configureAudioCodec(sender) {
        if (!sender || !this.peerConnection) return;
        
        try {
            const params = sender.getParameters();
            if (!params || !params.codecs) {
                // Параметры еще не готовы, пробуем позже
                setTimeout(() => this.configureAudioCodec(sender), 100);
                return;
            }
            
            // Приоритет кодеков для лучшего качества:
            // 1. Opus (лучший для голоса, низкая задержка, высокое качество)
            // 2. G722 (хорошее качество)
            // 3. PCMU/PCMA (fallback)
            const preferredCodecs = ['opus', 'G722', 'PCMU', 'PCMA'];
            
            params.codecs = params.codecs.sort((a, b) => {
                const aIndex = preferredCodecs.findIndex(codec => a.mimeType.toLowerCase().includes(codec.toLowerCase()));
                const bIndex = preferredCodecs.findIndex(codec => b.mimeType.toLowerCase().includes(codec.toLowerCase()));
                
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });
            
            // Настройки для Opus (если доступен)
            const opusCodec = params.codecs.find(c => c.mimeType.toLowerCase().includes('opus'));
            if (opusCodec) {
                opusCodec.clockRate = 48000; // Высокое качество (48kHz)
                opusCodec.channels = 1; // Моно для голоса (меньше битрейт, лучше для голоса)
                // FEC (Forward Error Correction) для устойчивости к потере пакетов
                // maxaveragebitrate=64000 для высокого качества голоса
                opusCodec.sdpFmtpLine = 'minptime=10;useinbandfec=1;maxaveragebitrate=64000;complexity=10;stereo=0';
            }
            
            // Настройка адаптивного битрейта для высокого качества
            if (params.encodings && params.encodings.length > 0) {
                params.encodings.forEach(encoding => {
                    // Максимальный битрейт для высокого качества (64 kbps для Opus голоса)
                    encoding.maxBitrate = 64000;
                    // Адаптивное время пакета для оптимизации
                    encoding.adaptivePtime = true;
                    // Приоритет качества над задержкой
                    encoding.priority = 'high';
                    // Минимальный битрейт для стабильности
                    encoding.minBitrate = 16000;
                });
            }
            
            await sender.setParameters(params);
            console.log('✅ Параметры кодека настроены:', params.codecs[0]?.mimeType);
        } catch (error) {
            console.warn('Не удалось настроить параметры кодека:', error);
        }
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
            // Модифицируем SDP для лучшего качества
            offer.sdp = this.modifySDPForQuality(offer.sdp);
            
            await this.peerConnection.setLocalDescription(offer);
            console.log('✅ Offer создан и отправлен');
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: offer
            });
        } catch (error) {
            console.error('❌ Ошибка создания offer:', error);
        }
    }
    
    modifySDPForQuality(sdp) {
        let modifiedSDP = sdp;
        let opusPayloadType = null;
        
        // Находим Opus кодек (может быть с каналами или без)
        const opusRegex1 = /a=rtpmap:(\d+) opus\/(\d+)\/(\d+)/g; // С каналами
        const opusRegex2 = /a=rtpmap:(\d+) opus\/(\d+)/g; // Без каналов
        
        // Сначала ищем с каналами
        modifiedSDP = modifiedSDP.replace(opusRegex1, (match, payload, clockRate, channels) => {
            opusPayloadType = payload;
            // Устанавливаем 48kHz и моно для голоса (моно лучше для голоса, меньше битрейт)
            return `a=rtpmap:${payload} opus/48000/1`;
        });
        
        // Если не нашли, ищем без каналов
        if (!opusPayloadType) {
            modifiedSDP = modifiedSDP.replace(opusRegex2, (match, payload, clockRate) => {
                opusPayloadType = payload;
                return `a=rtpmap:${payload} opus/48000/1`;
            });
        }
        
        // Улучшаем параметры fmtp для Opus
        if (opusPayloadType) {
            const fmtpRegex = new RegExp(`a=fmtp:${opusPayloadType}\\s+([^\\r\\n]+)`, 'g');
            modifiedSDP = modifiedSDP.replace(fmtpRegex, (match, params) => {
                let newParams = params;
                
                // Включаем FEC (Forward Error Correction) для устойчивости к потере пакетов
                if (!newParams.includes('useinbandfec=1')) {
                    newParams += ';useinbandfec=1';
                }
                
                // Минимальное время пакета для лучшего качества
                if (!newParams.includes('minptime=')) {
                    newParams += ';minptime=10';
                }
                
                // Высокий битрейт для лучшего качества (48-64 kbps для голоса)
                if (!newParams.includes('maxaveragebitrate=')) {
                    newParams += ';maxaveragebitrate=64000';
                }
                
                // Устанавливаем сложность кодирования (10 для лучшего качества)
                if (!newParams.includes('complexity=')) {
                    newParams += ';complexity=10';
                }
                
                // Дополнительные параметры для качества
                if (!newParams.includes('stereo=')) {
                    newParams += ';stereo=0'; // Моно для голоса
                }
                
                return `a=fmtp:${opusPayloadType} ${newParams}`;
            });
            
            // Если fmtp строка еще не существует, добавляем её
            if (!modifiedSDP.includes(`a=fmtp:${opusPayloadType}`)) {
                const rtpmapIndex = modifiedSDP.indexOf(`a=rtpmap:${opusPayloadType}`);
                if (rtpmapIndex !== -1) {
                    const insertIndex = modifiedSDP.indexOf('\n', rtpmapIndex) + 1;
                    modifiedSDP = modifiedSDP.slice(0, insertIndex) + 
                        `a=fmtp:${opusPayloadType} useinbandfec=1;minptime=10;maxaveragebitrate=64000;complexity=10;stereo=0\n` +
                        modifiedSDP.slice(insertIndex);
                }
            }
        }
        
        // Переставляем Opus на первое место в списке кодеков
        const audioLineRegex = /m=audio (\d+) RTP\/SAVPF ([\d\s]+)/;
        const audioMatch = modifiedSDP.match(audioLineRegex);
        if (audioMatch && opusPayloadType) {
            const codecs = audioMatch[2].trim().split(/\s+/);
            const opusIndex = codecs.indexOf(opusPayloadType);
            if (opusIndex > 0) {
                // Перемещаем Opus на первое место
                codecs.splice(opusIndex, 1);
                codecs.unshift(opusPayloadType);
                modifiedSDP = modifiedSDP.replace(audioLineRegex, `m=audio ${audioMatch[1]} RTP/SAVPF ${codecs.join(' ')}`);
            }
        }
        
        return modifiedSDP;
    }

    async handleOffer(offer) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            // Настраиваем параметры кодека для всех senders
            this.peerConnection.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                    this.configureAudioCodec(sender);
                }
            });
            
            const answer = await this.peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
            // Модифицируем SDP для лучшего качества
            answer.sdp = this.modifySDPForQuality(answer.sdp);
            
            await this.peerConnection.setLocalDescription(answer);
            console.log('✅ Answer создан и отправлен');
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: answer
            });
            // Обрабатываем накопленные ICE кандидаты
            this.processIceCandidatesQueue();
        } catch (error) {
            console.error('❌ Ошибка обработки offer:', error);
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
                return;
            }
            
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Ошибка обработки ICE candidate:', error);
        }
    }

    async processIceCandidatesQueue() {
        while (this.iceCandidatesQueue.length > 0) {
            const candidate = this.iceCandidatesQueue.shift();
            try {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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

    async checkConnectionStats() {
        if (!this.peerConnection) return;

        try {
            const stats = await this.peerConnection.getStats();
            let bytesReceived = 0;
            let bytesSent = 0;
            let packetsReceived = 0;
            let packetsSent = 0;
            let hasActiveConnection = false;
            let jitter = 0;
            let packetsLost = 0;

            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    bytesReceived = report.bytesReceived || 0;
                    packetsReceived = report.packetsReceived || 0;
                    jitter = report.jitter || 0;
                    packetsLost = report.packetsLost || 0;
                    hasActiveConnection = true;
                    
                    // Логируем только если есть данные или проблемы
                    if (bytesReceived > 0 || packetsLost > 0) {
                        console.log('📊 Входящий RTP:', {
                            bytes: bytesReceived,
                            packets: packetsReceived,
                            jitter: jitter.toFixed(3),
                            lost: packetsLost
                        });
                    }
                }
                if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
                    bytesSent = report.bytesSent || 0;
                    packetsSent = report.packetsSent || 0;
                    
                    // Логируем только если есть данные
                    if (bytesSent > 0) {
                        console.log('📊 Исходящий RTP:', {
                            bytes: bytesSent,
                            packets: packetsSent
                        });
                    }
                }
            });

                if (!hasActiveConnection) {
                console.error('❌ Нет активного RTP соединения!');
                this.updateStatus('Ошибка: соединение не установлено. Попробуйте переподключиться.', 'connecting');
            } else if (bytesReceived === 0) {
                this.updateStatus('Соединение установлено. Ожидание звука от собеседника...', 'connected');
            } else {
                // Показываем качество соединения
                const quality = packetsLost > 0 ? 'среднее' : 'отличное';
                if (packetsLost > 0) {
                    console.log(`📊 Качество: ${quality} (потеря пакетов: ${packetsLost})`);
                }
            }
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
        }
    }

    startRemoteAudioMonitoring(stream) {
        if (!stream) return;

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;
            source.connect(analyser);

            let silentCount = 0;
            let activeCount = 0;

            const checkRemoteAudioLevel = () => {
                if (!this.remoteStream || !stream) return;

                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                const level = average / 255;

                if (level > 0.01) {
                    activeCount++;
                    silentCount = 0;
                } else {
                    silentCount++;
                    if (silentCount === 200) {
                        console.warn('⚠️ Удаленное аудио тихое. Проверьте, что собеседник говорит.');
                        this.checkConnectionStats();
                    }
                }

                if (this.remoteStream && stream) {
                    requestAnimationFrame(checkRemoteAudioLevel);
                }
            };

            checkRemoteAudioLevel();
        } catch (error) {
            console.error('Ошибка запуска мониторинга удаленного аудио:', error);
        }
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
        
        if (this.remoteAudio) {
            this.remoteAudio.pause();
            this.remoteAudio.srcObject = null;
            this.remoteAudio = null;
        }
        
        // Удаляем обработчик клика, если есть
        if (this._audioClickHandler) {
            document.removeEventListener('click', this._audioClickHandler);
            this._audioClickHandler = null;
        }
        
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });
            this.remoteStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                }
            });
            this.peerConnection.getReceivers().forEach(receiver => {
                if (receiver.track) {
                    receiver.track.stop();
                }
            });
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.iceCandidatesQueue = [];
        this.isInitiator = false;
        this.updateAudioIndicator(false);
        this.showAudioStatus(false);
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

    showAudioStatus(playing) {
        if (this.audioStatus && this.audioStatusText) {
            if (playing) {
                this.audioStatus.style.display = 'block';
                this.audioStatusText.textContent = 'Звук воспроизводится';
            } else {
                this.audioStatus.style.display = 'none';
            }
        }
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new AudioCallClient();
});

