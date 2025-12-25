# Деплой приложения для работы через интернет

## Варианты деплоя

### 1. Быстрый тест через ngrok (для разработки)

**ngrok** позволяет быстро создать HTTPS туннель к вашему локальному серверу.

1. Установите ngrok: https://ngrok.com/download
2. Запустите ваш сервер:
   ```bash
   npm start
   ```
3. В другом терминале запустите ngrok:
   ```bash
   ngrok http 3000
   ```
4. Скопируйте HTTPS URL (например: `https://abc123.ngrok.io`)
5. Откройте этот URL в браузере - приложение будет доступно через интернет!

**Ограничения:** Бесплатный ngrok дает временный URL, который меняется при перезапуске.

---

### 2. Деплой на Railway (рекомендуется - бесплатный тариф)

Railway предоставляет бесплатный тариф с автоматическим HTTPS.

1. Зарегистрируйтесь на https://railway.app
2. Создайте новый проект
3. Подключите GitHub репозиторий или загрузите код
4. Railway автоматически определит Node.js и установит зависимости
5. Приложение будет доступно по HTTPS URL вида: `https://your-app.railway.app`

**Преимущества:**
- Бесплатный тариф (с ограничениями)
- Автоматический HTTPS
- Простой деплой через Git

---

### 3. Деплой на Render

1. Зарегистрируйтесь на https://render.com
2. Создайте новый Web Service
3. Подключите GitHub репозиторий
4. Настройки:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Render автоматически предоставит HTTPS URL

**Преимущества:**
- Бесплатный тариф
- Автоматический HTTPS
- Автоматический деплой при push в Git

---

### 4. Деплой на Heroku

1. Установите Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli
2. Войдите: `heroku login`
3. Создайте приложение: `heroku create your-app-name`
4. Деплой: `git push heroku main`
5. Откройте: `heroku open`

**Примечание:** Heroku больше не предоставляет бесплатный тариф, но есть пробный период.

---

### 5. Деплой на VPS (DigitalOcean, AWS, etc.)

Для полного контроля над сервером:

1. **Настройка сервера:**
   ```bash
   # Установите Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Установите PM2 для управления процессом
   sudo npm install -g pm2
   ```

2. **Клонируйте проект:**
   ```bash
   git clone <your-repo-url>
   cd webrtc-audio-call
   npm install
   ```

3. **Настройте HTTPS с Let's Encrypt:**
   ```bash
   sudo apt-get install certbot
   sudo certbot certonly --standalone -d yourdomain.com
   ```

4. **Используйте Nginx как reverse proxy:**
   ```nginx
   server {
       listen 443 ssl;
       server_name yourdomain.com;
       
       ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

5. **Запустите с PM2:**
   ```bash
   pm2 start server.js --name webrtc-call
   pm2 save
   pm2 startup
   ```

---

## Настройка переменных окружения

Создайте файл `.env` (не коммитьте в Git!):

```env
PORT=3000
NODE_ENV=production
```

Для продакшена на платформах вроде Railway/Render переменные окружения настраиваются в панели управления.

---

## Важно для WebRTC!

### 1. HTTPS обязателен
WebRTC **требует HTTPS** для работы в продакшене (кроме localhost). Все платформы выше предоставляют HTTPS автоматически.

### 2. TURN сервер (для сложных сетей)
Если пользователи находятся за строгим NAT/firewall, может потребоваться TURN сервер.

**Бесплатные TURN серверы:**
- https://www.metered.ca/tools/openrelay/ (бесплатный тариф)
- Twilio STUN/TURN (бесплатный тариф)

**Настройка TURN в client.js:**
```javascript
iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: 'turn:your-turn-server.com:3478',
        username: 'your-username',
        credential: 'your-password'
    }
]
```

---

## Проверка работы

После деплоя:

1. Откройте приложение в браузере
2. Проверьте консоль (F12) - не должно быть ошибок
3. Попробуйте создать комнату и присоединиться с другого устройства
4. Убедитесь, что микрофон работает

---

## Мониторинг

Для продакшена рекомендуется:
- Настроить логирование (например, через PM2 или платформенные логи)
- Мониторинг доступности (UptimeRobot, Pingdom)
- Обработка ошибок (Sentry)

---

## Безопасность

- Используйте HTTPS везде
- Ограничьте CORS при необходимости
- Добавьте rate limiting для API
- Регулярно обновляйте зависимости

