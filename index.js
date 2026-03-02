const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('redis');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// CONFIGURAÇÕES DE SEGURANÇA
// =================================================================
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"]
        }
    }
}));

// Rate limit geral
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Muitas requisições' }
});
app.use(limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================================================================
// CONFIGURAÇÕES DIRETAS (para teste)
// =================================================================
const REDIS_HOST = 'redis-16345.c81.us-east-1-2.ec2.redns.redis-cloud.com';
const REDIS_PORT = 16345;
const REDIS_PASSWORD = 'UnK847ICOOWU5DS7RTGOHbauOq0PemVj';
const SESSION_SECRET = 'minha_chave_super_secreta_123456789';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const STEP_TIME_MS = 15000;
const TOKEN_EXPIRATION_MS = 10 * 60 * 1000;

// =================================================================
// INICIALIZA REDIS
// =================================================================
let redisClient;

try {
    redisClient = createClient({
        username: 'default',
        password: REDIS_PASSWORD,
        socket: {
            host: REDIS_HOST,
            port: REDIS_PORT,
            tls: { rejectUnauthorized: false }
        }
    });

    redisClient.on('error', err => console.error('❌ Redis Error:', err.message));

    async function connectRedis() {
        try {
            await redisClient.connect();
            console.log("✔️ Conectado ao Redis");
            console.log(`\n🔐 Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}\n`);
        } catch (err) {
            console.error("❌ Falha no Redis:", err.message);
        }
    }
    connectRedis();
} catch (error) {
    console.error("❌ Erro ao criar cliente Redis:", error.message);
    redisClient = {
        get: async () => null,
        set: async () => {},
        del: async () => {},
        keys: async () => []
    };
}

// =================================================================
// FUNÇÕES DO REDIS
// =================================================================
async function getLicense(username) {
    try {
        const data = await redisClient.get(`license:${username}`);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        return null;
    }
}

async function setLicense(username, data) {
    await redisClient.set(`license:${username}`, JSON.stringify(data));
}

async function getDeviceUsername(deviceId) {
    return await redisClient.get(`device:${deviceId}`);
}

async function setDevice(deviceId, username) {
    await redisClient.set(`device:${deviceId}`, username);
}

async function getAllLicenses() {
    try {
        const keys = await redisClient.keys('license:*');
        const licenses = [];
        
        for (const key of keys) {
            const data = await redisClient.get(key);
            if (data) {
                licenses.push(JSON.parse(data));
            }
        }
        
        return licenses;
    } catch (e) {
        console.error('Erro ao listar licenças:', e);
        return [];
    }
}

// =================================================================
// MIDDLEWARE DE AUTENTICAÇÃO ADMIN
// =================================================================
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).json({ 
            success: false, 
            message: 'Autenticação necessária' 
        });
    }
    
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        next();
    } else {
        return res.status(403).json({ 
            success: false, 
            message: 'Credenciais inválidas' 
        });
    }
}

// =================================================================
// FUNÇÕES DE TOKEN
// =================================================================
function generateToken(step, ip) {
    const payload = {
        step: step,
        ip: ip,
        iat: Date.now(),
        exp: Date.now() + TOKEN_EXPIRATION_MS,
        nonce: crypto.randomBytes(16).toString('hex')
    };
    
    const data = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', SESSION_SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    
    return `${Buffer.from(data).toString('base64url')}.${signature}`;
}

function verifyToken(token, ip) {
    try {
        const [encodedData, signature] = token.split('.');
        if (!encodedData || !signature) return null;

        const data = Buffer.from(encodedData, 'base64url').toString();
        const payload = JSON.parse(data);

        if (Date.now() > payload.exp) return null;
        if (payload.ip !== ip) return null;

        const hmac = crypto.createHmac('sha256', SESSION_SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            return null;
        }

        return payload;
    } catch (e) {
        return null;
    }
}

const usedTokens = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of usedTokens.entries()) {
        if (now > exp) usedTokens.delete(token);
    }
}, 5 * 60 * 1000);

// =================================================================
// FUNÇÃO PARA GERAR CREDENCIAIS DE 20h
// =================================================================
function generateCredentials() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0,10).replace(/-/g, '');
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiryDate = new Date(now.getTime() + (20 * 60 * 60 * 1000));
    
    return {
        username: `TEMP_${dateStr}_${randomPart}`,
        password: '20H_' + crypto.randomBytes(8).toString('hex').toUpperCase(),
        expiresAt: expiryDate.toISOString(),
        createdAt: now.toISOString()
    };
}

// =================================================================
// ROTA PRINCIPAL
// =================================================================
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Sistema de Acesso</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }
            .card {
                background: white;
                border-radius: 20px;
                padding: 40px;
                max-width: 400px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; margin-bottom: 30px; line-height: 1.6; }
            .button {
                background: #667eea;
                color: white;
                border: none;
                padding: 15px 40px;
                border-radius: 10px;
                font-size: 18px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: background 0.3s;
            }
            .button:hover {
                background: #5a67d8;
            }
            .info {
                margin-top: 30px;
                padding: 15px;
                background: #f7fafc;
                border-radius: 10px;
                font-size: 14px;
                color: #718096;
            }
            .admin-link {
                margin-top: 20px;
                font-size: 12px;
            }
            .admin-link a {
                color: #a0aec0;
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🎫 Gerar Acesso de 20 Horas</h1>
            <p>Complete as etapas abaixo para gerar suas credenciais de acesso temporário.</p>
            <a href="/start" class="button">Iniciar Processo</a>
            <div class="info">
                ⏱️ 3 etapas · 15 segundos cada<br>
                📱 Use as credenciais no app
            </div>
            <div class="admin-link">
                <a href="/admin">🔧 Área Admin</a>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// =================================================================
// INICIAR PROCESSO
// =================================================================
app.get('/start', (req, res) => {
    const token = generateToken(1, req.ip);
    res.redirect(`/step?token=${token}`);
});

// =================================================================
// PÁGINA DE ETAPA
// =================================================================
app.get('/step', (req, res) => {
    const token = req.query.token;
    
    if (!token) {
        return res.redirect('/');
    }
    
    const payload = verifyToken(token, req.ip);
    if (!payload) {
        return res.redirect('/');
    }
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Etapa ${payload.step} de 3</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }
            .card {
                background: white;
                border-radius: 20px;
                padding: 40px;
                max-width: 500px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            h1 { color: #333; margin-bottom: 10px; }
            .step-indicator {
                color: #667eea;
                font-size: 14px;
                margin-bottom: 30px;
            }
            .timer-container {
                background: #f7fafc;
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 30px;
            }
            .timer {
                font-size: 48px;
                font-weight: bold;
                color: #333;
                text-align: center;
                font-family: monospace;
            }
            .timer-label {
                text-align: center;
                color: #718096;
                margin-top: 10px;
            }
            .message {
                background: #e6f7ff;
                border: 1px solid #91d5ff;
                border-radius: 8px;
                padding: 15px;
                color: #0050b3;
                margin-bottom: 20px;
                display: none;
            }
            .progress-bar {
                width: 100%;
                height: 8px;
                background: #e2e8f0;
                border-radius: 4px;
                margin: 20px 0;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                background: #667eea;
                width: 0%;
                transition: width 0.1s linear;
            }
            .button {
                width: 100%;
                padding: 15px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s;
            }
            .button:disabled {
                background: #cbd5e0;
                cursor: not-allowed;
            }
            .button:not(:disabled) {
                background: #48bb78;
                color: white;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>⏳ Etapa ${payload.step} de 3</h1>
            <div class="step-indicator">Complete todas as etapas para gerar seu acesso</div>
            
            <div class="timer-container">
                <div class="timer" id="timer">15</div>
                <div class="timer-label">segundos restantes</div>
            </div>
            
            <div class="progress-bar">
                <div class="progress-fill" id="progress"></div>
            </div>
            
            <div class="message" id="message"></div>
            
            <button class="button" id="nextBtn" disabled>Aguardando...</button>
        </div>

        <script>
            let timeLeft = 15;
            const timerEl = document.getElementById('timer');
            const nextBtn = document.getElementById('nextBtn');
            const messageEl = document.getElementById('message');
            const progressEl = document.getElementById('progress');
            const token = '${token}';
            const currentStep = ${payload.step};
            
            const interval = setInterval(() => {
                timeLeft--;
                timerEl.textContent = timeLeft;
                progressEl.style.width = ((15 - timeLeft) / 15 * 100) + '%';
                
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    timerEl.textContent = "0";
                    nextBtn.disabled = false;
                    nextBtn.textContent = "Avançar →";
                    nextBtn.onclick = nextStep;
                }
            }, 1000);
            
            function nextStep() {
                nextBtn.disabled = true;
                nextBtn.textContent = "Processando...";
                
                fetch('/api/next-step?token=' + token + '&currentStep=' + currentStep)
                    .then(res => res.json())
                    .then(data => {
                        if (data.redirect) {
                            window.location.href = data.redirect;
                        } else if (data.error) {
                            messageEl.style.display = 'block';
                            messageEl.textContent = data.error;
                            setTimeout(() => {
                                window.location.href = '/';
                            }, 2000);
                        }
                    })
                    .catch(() => {
                        window.location.href = '/';
                    });
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// =================================================================
// API: AVANÇAR ETAPA
// =================================================================
app.get('/api/next-step', async (req, res) => {
    const token = req.query.token;
    const clientStep = parseInt(req.query.currentStep);
    const clientIp = req.ip;

    if (!token || isNaN(clientStep)) {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    const payload = verifyToken(token, clientIp);
    if (!payload) {
        return res.status(403).json({ error: 'Sessão inválida' });
    }

    if (payload.step !== clientStep) {
        usedTokens.set(token, payload.exp);
        return res.status(400).json({ error: 'Sequência inválida' });
    }

    const timeElapsed = Date.now() - payload.iat;
    if (timeElapsed < STEP_TIME_MS - 2000) {
        return res.status(429).json({ 
            error: 'Aguarde mais ' + Math.ceil((STEP_TIME_MS - timeElapsed)/1000) + ' segundos' 
        });
    }

    if (clientStep >= 3) {
        usedTokens.set(token, payload.exp);
        
        const credentials = generateCredentials();
        
        const licenseData = {
            username: credentials.username,
            password: credentials.password,
            type: 'temp_20h',
            createdAt: credentials.createdAt,
            expiresAt: credentials.expiresAt,
            registeredDeviceId: null,
            firstSeen: null,
            lastSeen: null,
            status: 'active'
        };
        
        await setLicense(credentials.username, licenseData);
        
        return res.json({ 
            redirect: '/success?u=' + encodeURIComponent(credentials.username) + '&p=' + encodeURIComponent(credentials.password)
        });
    }
    
    const nextStep = clientStep + 1;
    const newToken = generateToken(nextStep, clientIp);
    usedTokens.set(token, payload.exp);
    
    return res.json({ 
        redirect: '/step?token=' + newToken
    });
});

// =================================================================
// PÁGINA DE SUCESSO
// =================================================================
app.get('/success', (req, res) => {
    const { u: username, p: password } = req.query;
    
    if (!username || !password) {
        return res.redirect('/');
    }
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Acesso Gerado!</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }
            .card {
                background: white;
                border-radius: 20px;
                padding: 40px;
                max-width: 500px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            h1 { color: #333; margin-bottom: 10px; }
            .subtitle { color: #718096; margin-bottom: 30px; }
            .credentials-box {
                background: #f7fafc;
                border: 2px dashed #cbd5e0;
                border-radius: 12px;
                padding: 25px;
                margin-bottom: 25px;
            }
            .credential-row {
                margin-bottom: 20px;
            }
            .credential-row:last-child {
                margin-bottom: 0;
            }
            .label {
                font-size: 14px;
                color: #4a5568;
                margin-bottom: 5px;
                font-weight: 600;
            }
            .value {
                background: white;
                border: 1px solid #e2e8f0;
                padding: 12px 15px;
                border-radius: 8px;
                font-family: 'Courier New', monospace;
                font-size: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .copy-btn {
                background: #4299e1;
                color: white;
                border: none;
                padding: 5px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
            }
            .copy-btn:hover { background: #3182ce; }
            .copy-btn.copied { background: #48bb78; }
            .warning {
                background: #fed7d7;
                color: #c53030;
                padding: 15px;
                border-radius: 8px;
                font-size: 14px;
                text-align: center;
            }
            .button {
                background: #667eea;
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 8px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>✅ Acesso Gerado!</h1>
            <div class="subtitle">Válido por 20 horas</div>
            
            <div class="credentials-box">
                <div class="credential-row">
                    <div class="label">📱 USUÁRIO</div>
                    <div class="value" id="username">${username}</div>
                </div>
                
                <div class="credential-row">
                    <div class="label">🔑 SENHA</div>
                    <div class="value" id="password">${password}</div>
                </div>
            </div>
            
            <div class="warning">
                ⚠️ Use no app. A conta será vinculada ao primeiro dispositivo.
            </div>
            
            <a href="/" class="button">Voltar ao Início</a>
        </div>

        <script>
            function copyToClipboard(elementId) {
                const element = document.getElementById(elementId);
                const text = element.innerText.replace('Copiar', '').trim();
                
                navigator.clipboard.writeText(text).then(() => {
                    const btn = element.querySelector('.copy-btn');
                    btn.textContent = 'Copiado!';
                    btn.classList.add('copied');
                    
                    setTimeout(() => {
                        btn.textContent = 'Copiar';
                        btn.classList.remove('copied');
                    }, 2000);
                });
            }
            
            ['username', 'password'].forEach(id => {
                const element = document.getElementById(id);
                const btn = document.createElement('button');
                btn.className = 'copy-btn';
                btn.textContent = 'Copiar';
                btn.onclick = () => copyToClipboard(id);
                element.appendChild(btn);
            });
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// =================================================================
// LOGIN DO APP
// =================================================================
app.post('/login', async (req, res) => {
    const { deviceId, username, password } = req.body;
    
    if (!deviceId || !username || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Dados incompletos.' 
        });
    }

    if (username.startsWith('TEMP_')) {
        const license = await getLicense(username);
        
        if (!license) {
            return res.json({ 
                success: false, 
                message: 'Credenciais inválidas.' 
            });
        }
        
        if (license.password !== password) {
            return res.json({ 
                success: false, 
                message: 'Senha incorreta.' 
            });
        }
        
        const now = new Date();
        const expiresAt = new Date(license.expiresAt);
        
        if (now > expiresAt) {
            return res.json({ 
                success: false, 
                message: 'Sua licença de 20 horas expirou.',
                expired: true 
            });
        }
        
        if (!license.registeredDeviceId) {
            license.registeredDeviceId = deviceId;
            license.firstSeen = now.toISOString();
            license.lastSeen = now.toISOString();
            
            await setLicense(username, license);
            await setDevice(deviceId, username);
            
            const remainingMs = expiresAt - now;
            const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
            const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            
            return res.json({ 
                success: true, 
                message: "Acesso permitido. " + remainingHours + "h " + remainingMinutes + "m restantes.",
                type: 'temp_20h'
            });
            
        } else if (license.registeredDeviceId !== deviceId) {
            return res.json({ 
                success: false, 
                message: 'Esta conta já está em uso em outro dispositivo.',
                type: 'already_in_use'
            });
            
        } else {
            license.lastSeen = now.toISOString();
            await setLicense(username, license);
            
            const remainingMs = expiresAt - now;
            const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
            const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            
            return res.json({ 
                success: true, 
                message: "Acesso permitido. " + remainingHours + "h " + remainingMinutes + "m restantes.",
                type: 'temp_20h'
            });
        }
    }
    
    return res.json({ 
        success: false, 
        message: 'Credenciais inválidas.' 
    });
});

// =================================================================
// ÁREA ADMIN
// =================================================================
app.get('/admin', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Admin Login</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }
            .card {
                background: white;
                border-radius: 10px;
                padding: 40px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            h1 { color: #333; margin-bottom: 30px; text-align: center; }
            .form-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                color: #4a5568;
                font-weight: 600;
            }
            input {
                width: 100%;
                padding: 10px;
                border: 1px solid #cbd5e0;
                border-radius: 5px;
                font-size: 16px;
            }
            button {
                width: 100%;
                padding: 12px;
                background: #4299e1;
                color: white;
                border: none;
                border-radius: 5px;
                font-size: 16px;
                cursor: pointer;
            }
            button:hover {
                background: #3182ce;
            }
            .error {
                color: #e53e3e;
                margin-top: 10px;
                text-align: center;
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🔐 Área Admin</h1>
            <form id="loginForm">
                <div class="form-group">
                    <label>Usuário</label>
                    <input type="text" id="username" required>
                </div>
                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" id="password" required>
                </div>
                <button type="submit">Entrar</button>
                <div class="error" id="error">Credenciais inválidas</div>
            </form>
        </div>

        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                
                const auth = btoa(username + ':' + password);
                
                try {
                    const response = await fetch('/admin/dashboard', {
                        headers: {
                            'Authorization': 'Basic ' + auth
                        }
                    });
                    
                    if (response.ok) {
                        sessionStorage.setItem('adminAuth', auth);
                        window.location.href = '/admin/dashboard';
                    } else {
                        document.getElementById('error').style.display = 'block';
                    }
                } catch (error) {
                    document.getElementById('error').style.display = 'block';
                }
            });
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

app.get('/admin/dashboard', authenticateAdmin, async (req, res) => {
    const licenses = await getAllLicenses();
    
    const licenseRows = licenses.map(license => {
        const now = new Date();
        const expiresAt = new Date(license.expiresAt);
        const isExpired = now > expiresAt;
        const isVinculada = license.registeredDeviceId ? '✅ Sim' : '❌ Não';
        
        return `
        <tr>
            <td>${license.username}</td>
            <td>${license.registeredDeviceId || '—'}</td>
            <td>${new Date(license.createdAt).toLocaleString()}</td>
            <td>${new Date(license.expiresAt).toLocaleString()}</td>
            <td>${isExpired ? '❌ Expirada' : '✅ Ativa'}</td>
            <td>${isVinculada}</td>
            <td>
                <button onclick="checkLicense('${license.username}')">🔍</button>
                <button onclick="removeLicense('${license.username}')">❌</button>
            </td>
        </tr>
        `;
    }).join('');
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: #f7fafc;
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            h1 { color: #2d3748; }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
            }
            .logout {
                background: #e53e3e;
                color: white;
                padding: 10px 20px;
                text-decoration: none;
                border-radius: 5px;
            }
            table {
                width: 100%;
                background: white;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            th {
                background: #4a5568;
                color: white;
                padding: 12px;
                text-align: left;
            }
            td {
                padding: 12px;
                border-bottom: 1px solid #e2e8f0;
            }
            tr:hover {
                background: #f7fafc;
            }
            button {
                padding: 5px 10px;
                margin: 0 2px;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-number {
                font-size: 32px;
                font-weight: bold;
                color: #4299e1;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔧 Painel Admin</h1>
                <a href="/admin/logout" class="logout">Sair</a>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <div>Total Licenças</div>
                    <div class="stat-number">${licenses.length}</div>
                </div>
                <div class="stat-card">
                    <div>Ativas</div>
                    <div class="stat-number">${licenses.filter(l => new Date() < new Date(l.expiresAt)).length}</div>
                </div>
                <div class="stat-card">
                    <div>Vinculadas</div>
                    <div class="stat-number">${licenses.filter(l => l.registeredDeviceId).length}</div>
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Device ID</th>
                        <th>Criada em</th>
                        <th>Expira em</th>
                        <th>Status</th>
                        <th>Vinculada</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${licenseRows || '<tr><td colspan="7">Nenhuma licença encontrada</td></tr>'}
                </tbody>
            </table>
        </div>

        <script>
            const auth = sessionStorage.getItem('adminAuth');
            
            async function checkLicense(username) {
                const response = await fetch('/admin/check/' + username, {
                    headers: { 'Authorization': 'Basic ' + auth }
                });
                const data = await response.json();
                alert(JSON.stringify(data, null, 2));
            }
            
            async function removeLicense(username) {
                if (!confirm('Remover licença ' + username + '?')) return;
                
                const response = await fetch('/admin/remove?username=' + username, {
                    headers: { 'Authorization': 'Basic ' + auth }
                });
                const data = await response.json();
                alert(data.message);
                location.reload();
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

app.get('/admin/logout', (req, res) => {
    res.send(`
    <script>
        sessionStorage.removeItem('adminAuth');
        window.location.href = '/admin';
    </script>
    `);
});

app.get('/admin/check/:username', authenticateAdmin, async (req, res) => {
    const { username } = req.params;
    const license = await getLicense(username);
    
    if (!license) {
        return res.json({ success: false, message: 'Licença não encontrada' });
    }
    
    res.json({
        success: true,
        license: {
            username: license.username,
            type: license.type,
            createdAt: license.createdAt,
            expiresAt: license.expiresAt,
            registeredDeviceId: license.registeredDeviceId,
            firstSeen: license.firstSeen,
            lastSeen: license.lastSeen,
            status: license.status
        }
    });
});

app.get('/admin/remove', authenticateAdmin, async (req, res) => {
    const { username, deviceId } = req.query;
    
    if (username) {
        await redisClient.del(`license:${username}`);
        
        const keys = await redisClient.keys('device:*');
        for (const key of keys) {
            const val = await redisClient.get(key);
            if (val === username) {
                await redisClient.del(key);
            }
        }
        
        return res.json({ success: true, message: 'Licença ' + username + ' removida' });
        
    } else if (deviceId) {
        const username = await getDeviceUsername(deviceId);
        if (username) {
            await redisClient.del(`license:${username}`);
            await redisClient.del(`device:${deviceId}`);
        }
        return res.json({ success: true, message: 'Device ' + deviceId + ' removido' });
        
    } else {
        return res.status(400).json({ success: false, message: 'Parâmetro necessário' });
    }
});

// =================================================================
// INICIA O SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`
    🚀 Servidor rodando na porta ${PORT}
    
    👤 Público:
        GET  /              - Página inicial
        GET  /start         - Iniciar processo
        GET  /step          - Página de etapas
        GET  /success       - Credenciais geradas
        POST /login         - Login do app
        
    🔐 Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}
        GET  /admin         - Página de login
        GET  /admin/dashboard - Painel admin
        
    ⏱️  ${STEP_TIME_MS/1000}s por etapa · 3 etapas
    `);
});