const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// Поддержка HTTPS (опционально, для локального тестирования)
let server;
const useHttps = process.env.USE_HTTPS === 'true' && 
                 fs.existsSync('./cert.pem') && 
                 fs.existsSync('./key.pem');

if (useHttps) {
    const options = {
        key: fs.readFileSync('./key.pem'),
        cert: fs.readFileSync('./cert.pem')
    };
    server = https.createServer(options, app);
    console.log('HTTPS режим включен');
} else {
    server = http.createServer(app);
}

const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Хранилище комнат и пользователей
const rooms = new Map(); // roomId -> { users: Set }

// Статические файлы
app.use(express.static(path.join(__dirname)));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Генерация уникального ID комнаты
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Пользователь подключен:', socket.id);

    // Создание комнаты
    socket.on('create-room', ({ username }) => {
        const roomId = generateRoomId();
        rooms.set(roomId, {
            users: new Set([socket.id])
        });
        
        socket.join(roomId);
        socket.emit('room-created', { roomId });
        console.log(`Комната ${roomId} создана пользователем ${username}`);
    });

    // Присоединение к комнате
    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }

        if (room.users.size >= 2) {
            socket.emit('error', { message: 'Комната переполнена (максимум 2 пользователя)' });
            return;
        }

        room.users.add(socket.id);
        socket.join(roomId);
        
        socket.emit('room-joined', { roomId });
        
        // Уведомляем других пользователей о новом участнике
        if (room.users.size === 2) {
            const otherUser = Array.from(room.users).find(id => id !== socket.id);
            if (otherUser) {
                io.to(otherUser).emit('user-joined', { username });
            }
        }
        
        console.log(`Пользователь ${username} присоединился к комнате ${roomId}`);
    });

    // Отправка offer
    socket.on('offer', ({ roomId, offer }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }

        if (!room.users.has(socket.id)) {
            socket.emit('error', { message: 'Вы не в этой комнате' });
            return;
        }

        // Отправляем offer другому пользователю
        socket.to(roomId).emit('offer', { offer });
        console.log(`Offer отправлен в комнату ${roomId}`);
    });

    // Отправка answer
    socket.on('answer', ({ roomId, answer }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }

        if (!room.users.has(socket.id)) {
            socket.emit('error', { message: 'Вы не в этой комнате' });
            return;
        }

        // Отправляем answer другому пользователю
        socket.to(roomId).emit('answer', { answer });
        console.log(`Answer отправлен в комнату ${roomId}`);
    });

    // Отправка ICE candidate
    socket.on('ice-candidate', ({ roomId, candidate }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (!room.users.has(socket.id)) return;

        // Отправляем ICE candidate другому пользователю
        socket.to(roomId).emit('ice-candidate', { candidate });
    });

    // Покидание комнаты
    socket.on('leave-room', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.users.delete(socket.id);
            
            // Уведомляем других пользователей
            socket.to(roomId).emit('user-left');
            
            // Удаляем комнату, если она пуста
            if (room.users.size === 0) {
                rooms.delete(roomId);
                console.log(`Комната ${roomId} удалена`);
            }
        }
        
        socket.leave(roomId);
    });

    // Обработка отключения
    socket.on('disconnect', () => {
        console.log('Пользователь отключен:', socket.id);
        
        // Находим и очищаем комнаты, где был этот пользователь
        for (const [roomId, room] of rooms.entries()) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                
                // Уведомляем других пользователей
                socket.to(roomId).emit('user-left');
                
                // Удаляем комнату, если она пуста
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Комната ${roomId} удалена`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    const protocol = useHttps ? 'https' : 'http';
    console.log(`Сервер запущен на ${protocol}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Окружение: ${process.env.NODE_ENV || 'development'}`);
    
    if (!useHttps && process.env.NODE_ENV === 'production') {
        console.warn('⚠️  ВНИМАНИЕ: WebRTC требует HTTPS в продакшене!');
        console.warn('   Используйте reverse proxy (Nginx) или платформу с автоматическим HTTPS');
    }
});

