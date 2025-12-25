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
                console.log('Локальный трек:', {
                    kind: track.kind,
                    id: track.id,
                    enabled: track.enabled,
                    readyState: track.readyState,
                    muted: track.muted,
                    label: track.label
                });
                
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
                    this.peerConnection.addTrack(track, this.localStream);
                } else {
                    console.log('Трек уже добавлен в peer connection');
                    // Обновляем трек в sender, если нужно
                    if (sender.track && sender.track.id !== track.id) {
                        console.log('Замена трека в sender');
                        sender.replaceTrack(track);
                    }
                }
            });
            
            // Проверяем senders после добавления
            const senders = this.peerConnection.getSenders();
            console.log('Всего senders:', senders.length);
            senders.forEach((sender, index) => {
                if (sender.track) {
                    console.log(`Sender ${index}:`, {
                        kind: sender.track.kind,
                        id: sender.track.id,
                        enabled: sender.track.enabled,
                        readyState: sender.track.readyState
                    });
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

        // Сначала пробуем с TURN (для обхода NAT)
        // Если не работает, можно попробовать 'all' для использования и STUN и TURN
        const useRelayOnly = false; // Установите true, если нужно использовать только TURN
        
        const configuration = {
            iceServers: [
                // STUN серверы (только если не используем только TURN)
                ...(useRelayOnly ? [] : [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]),
                // TURN серверы (приоритет для обхода NAT)
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:443',
                        'turn:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: [
                        'turn:relay.metered.ca:80',
                        'turn:relay.metered.ca:443',
                        'turn:relay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // Дополнительные TURN серверы
                {
                    urls: 'turn:openrelay.metered.ca:80?transport=udp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:80?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: useRelayOnly ? 'relay' : 'all', // Используем 'relay' только если нужно
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
        console.log('ICE конфигурация:', {
            iceTransportPolicy: configuration.iceTransportPolicy,
            iceServersCount: configuration.iceServers.length
        });

        this.peerConnection = new RTCPeerConnection(configuration);

        // Обработка удаленного потока
        this.peerConnection.ontrack = (event) => {
            console.log('=== Получен удаленный трек ===');
            console.log('Event:', event);
            console.log('Track:', event.track);
            console.log('Track kind:', event.track.kind);
            console.log('Track id:', event.track.id);
            console.log('Track enabled:', event.track.enabled);
            console.log('Track readyState:', event.track.readyState);
            console.log('Streams:', event.streams);
            
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
                console.log('Обработка аудио трека:', track.id);
                
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
                            console.log('Audio element state:', {
                                paused: this.remoteAudio.paused,
                                muted: this.remoteAudio.muted,
                                volume: this.remoteAudio.volume,
                                currentTime: this.remoteAudio.currentTime,
                                readyState: this.remoteAudio.readyState
                            });
                            
                            // Проверяем треки в потоке
                            const tracks = stream.getAudioTracks();
                            tracks.forEach((t, i) => {
                                console.log(`Трек ${i} после unmute:`, {
                                    id: t.id,
                                    enabled: t.enabled,
                                    muted: t.muted,
                                    readyState: t.readyState
                                });
                            });
                            
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
                    if (track.muted) {
                        console.warn('⚠️ Трек все еще muted. Проверьте на стороне отправителя:');
                        console.warn('- Микрофон включен?');
                        console.warn('- Пользователь говорит?');
                        console.warn('- Разрешения на микрофон даны?');
                    } else {
                        console.log('✅ Трек больше не muted');
                        clearInterval(muteCheckInterval);
                    }
                }, 2000);
                
                // Останавливаем проверку через 30 секунд
                setTimeout(() => {
                    clearInterval(muteCheckInterval);
                }, 30000);
                
                // Создаем или обновляем audio элемент
                if (!this.remoteAudio) {
                    console.log('Создание нового Audio элемента');
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
                console.log('Установка потока в Audio элемент');
                this.remoteAudio.srcObject = stream;
                
                // Проверяем состояние треков в потоке
                const audioTracks = stream.getAudioTracks();
                console.log('Всего аудио треков в потоке:', audioTracks.length);
                audioTracks.forEach((t, index) => {
                    console.log(`Трек ${index}:`, {
                        id: t.id,
                        enabled: t.enabled,
                        readyState: t.readyState,
                        muted: t.muted,
                        label: t.label
                    });
                });
                
                // Пытаемся воспроизвести
                const playAudio = () => {
                    if (this.remoteAudio && this.remoteAudio.srcObject) {
                        // Проверяем, есть ли активные треки
                        const activeTracks = stream.getAudioTracks().filter(t => 
                            t.readyState === 'live' && t.enabled && !t.muted
                        );
                        console.log('Активных треков:', activeTracks.length);
                        
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
                            console.log('Audio element state:', {
                                paused: this.remoteAudio.paused,
                                muted: this.remoteAudio.muted,
                                volume: this.remoteAudio.volume,
                                currentTime: this.remoteAudio.currentTime,
                                readyState: this.remoteAudio.readyState
                            });
                            
                            // Проверяем треки в потоке
                            const tracks = stream.getAudioTracks();
                            tracks.forEach((t, i) => {
                                console.log(`Трек ${i}:`, {
                                    id: t.id,
                                    enabled: t.enabled,
                                    muted: t.muted,
                                    readyState: t.readyState
                                });
                            });
                            
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
            console.log('ICE connection state:', state);
            
            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE соединение установлено:', state);
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

    async createOffer() {
        try {
            console.log('Создание offer...');
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            await this.peerConnection.setLocalDescription(offer);
            console.log('Local description установлен:', offer.type);
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: offer
            });
            console.log('Offer отправлен');
        } catch (error) {
            console.error('Ошибка создания offer:', error);
        }
    }

    async handleOffer(offer) {
        try {
            console.log('Получен offer, создание answer...');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('Remote description установлен');
            
            const answer = await this.peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            await this.peerConnection.setLocalDescription(answer);
            console.log('Answer создан и отправлен');
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: answer
            });
            // Обрабатываем накопленные ICE кандидаты
            this.processIceCandidatesQueue();
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

    async checkConnectionStats() {
        if (!this.peerConnection) return;

        try {
            const stats = await this.peerConnection.getStats();
            let bytesReceived = 0;
            let bytesSent = 0;
            let packetsReceived = 0;
            let packetsSent = 0;
            let hasActiveConnection = false;

            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    bytesReceived = report.bytesReceived || 0;
                    packetsReceived = report.packetsReceived || 0;
                    hasActiveConnection = true;
                    console.log('📊 Входящий RTP:', {
                        bytesReceived,
                        packetsReceived,
                        jitter: report.jitter,
                        packetsLost: report.packetsLost
                    });
                }
                if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
                    bytesSent = report.bytesSent || 0;
                    packetsSent = report.packetsSent || 0;
                    console.log('📊 Исходящий RTP:', {
                        bytesSent,
                        packetsSent,
                        packetsLost: report.packetsLost
                    });
                }
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    console.log('📊 Candidate pair succeeded:', {
                        localCandidate: report.localCandidateId,
                        remoteCandidate: report.remoteCandidateId,
                        bytesReceived: report.bytesReceived,
                        bytesSent: report.bytesSent
                    });
                }
            });

                if (!hasActiveConnection) {
                console.error('❌ Нет активного RTP соединения! Данные не передаются.');
                console.error('Возможные причины:');
                console.error('1. Соединение не установлено (failed/disconnected)');
                console.error('2. Треки не передаются через соединение');
                console.error('3. Проблемы с NAT/firewall - нужен TURN сервер');
                console.error('4. Строгий NAT блокирует прямое соединение');
                
                // Проверяем, используется ли TURN
                let usingRelay = false;
                stats.forEach(report => {
                    if (report.type === 'local-candidate' && report.candidateType === 'relay') {
                        usingRelay = true;
                        console.log('✅ TURN сервер используется:', report.candidate);
                    }
                });
                
                if (!usingRelay) {
                    console.error('❌ TURN сервер НЕ используется! Это основная проблема.');
                    console.error('Попробуйте:');
                    console.error('1. Использовать VPN');
                    console.error('2. Использовать другую сеть');
                    console.error('3. Настроить свой TURN сервер');
                }
                
                // Предлагаем решение
                this.updateStatus('Ошибка: соединение не установлено. Попробуйте переподключиться или использовать другую сеть.', 'connecting');
            } else if (bytesReceived === 0) {
                console.warn('⚠️ RTP соединение есть, но данные не приходят (bytesReceived = 0)');
                console.warn('Возможные причины:');
                console.warn('1. Собеседник не говорит в микрофон');
                console.warn('2. Микрофон выключен на стороне отправителя');
                console.warn('3. Трек muted на стороне отправителя');
                this.updateStatus('Соединение установлено. Ожидание звука от собеседника...', 'connected');
            } else {
                console.log('✅ Данные передаются! Bytes received:', bytesReceived);
                console.log('✅ Соединение работает корректно');
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
                    if (activeCount % 50 === 0) {
                        console.log('🔊 Удаленное аудио активно, уровень:', level.toFixed(3));
                    }
                    silentCount = 0;
                } else {
                    silentCount++;
                    if (silentCount === 100) {
                        console.warn('⚠️ Удаленное аудио тихое или отсутствует уже 100 проверок');
                        console.warn('Проверьте, что собеседник говорит в микрофон');
                        // Проверяем статистику соединения
                        this.checkConnectionStats();
                    }
                    if (silentCount === 200) {
                        console.error('❌ КРИТИЧНО: Данные не приходят уже 200 проверок!');
                        console.error('Соединение не работает. Попробуйте переподключиться.');
                        this.updateStatus('Ошибка: данные не приходят. Переподключитесь.', 'connecting');
                    }
                }

                // Проверяем состояние треков
                const tracks = stream.getAudioTracks();
                tracks.forEach((t, i) => {
                    if (t.muted && activeCount > 0) {
                        console.warn(`⚠️ Трек ${i} стал muted во время воспроизведения!`);
                    }
                });

                if (this.remoteStream && stream) {
                    requestAnimationFrame(checkRemoteAudioLevel);
                }
            };

            checkRemoteAudioLevel();
            console.log('Мониторинг удаленного аудио запущен');
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

