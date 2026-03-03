const express = require('express');
const path = require('path');
const crypto = require('crypto');
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

// Rate limit
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Muitas requisições' }
});
app.use(limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================================================================
// ARMAZENAMENTO EM MEMÓRIA (SEM REDIS!)
// =================================================================
const licenses = new Map();      // license:username -> dados
const devices = new Map();       // device:deviceId -> username
const usedTokens = new Map();    // tokens usados

// Limpeza periódica de tokens
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of usedTokens.entries()) {
        if (now > exp) usedTokens.delete(token);
    }
}, 5 * 60 * 1000);

// Limpeza de licenças expiradas (a cada hora)
setInterval(() => {
    const now = new Date();
    for (const [username, license] of licenses.entries()) {
        if (license.expiresAt && new Date(license.expiresAt) < now) {
            licenses.delete(username);
            // Remove também dos devices associados
            for (const [deviceId, uname] of devices.entries()) {
                if (uname === username) {
                    devices.delete(deviceId);
                }
            }
        }
    }
    console.log('🧹 Limpeza de licenças expiradas concluída');
}, 60 * 60 * 1000);

// =================================================================
// CONFIGURAÇÕES
// =================================================================
const SESSION_SECRET = 'minha_chave_super_secreta_123456789';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const STEP_TIME_MS = 15000; // 15 segundos
const TOKEN_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutos

// =================================================================
// FUNÇÕES DE ARMAZENAMENTO
// =================================================================
async function getLicense(username) {
    return licenses.get(username) || null;
}

async function setLicense(username, data) {
    licenses.set(username, data);
}

async function getDeviceUsername(deviceId) {
    return devices.get(deviceId) || null;
}

async function setDevice(deviceId, username) {
    devices.set(deviceId, username);
}

async function getAllLicenses() {
    return Array.from(licenses.values());
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        
        body {
            background: linear-gradient(145deg, #E8F0FE 0%, #D9E9FF 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 16px;
        }
        
        .main-container {
            max-width: 480px;
            width: 100%;
            margin: 0 auto;
        }
        
        /* Card principal */
        .card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 32px;
            padding: 32px 24px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 98, 204, 0.25),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
            border: 1px solid rgba(255, 255, 255, 0.8);
            text-align: center;
        }
        
        /* Ícone animado */
        .animated-icon {
            font-size: 64px;
            margin-bottom: 16px;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        
        h1 {
            font-size: 36px;
            font-weight: 800;
            background: linear-gradient(135deg, #0066FF 0%, #0099FF 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 16px;
            letter-spacing: -0.5px;
        }
        
        .description {
            color: #4A5B6E;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
            padding: 0 12px;
        }
        
        /* Botão principal */
        .button {
            background: linear-gradient(145deg, #0066FF, #0099FF);
            color: white;
            border: none;
            padding: 18px 40px;
            border-radius: 40px;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            width: 100%;
            text-align: center;
            box-shadow: 0 10px 20px -5px rgba(0, 102, 255, 0.4);
            transition: all 0.3s;
            margin-bottom: 24px;
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 25px -5px rgba(0, 102, 255, 0.5);
        }
        
        .button:active {
            transform: translateY(0);
        }
        
        /* Card de informações */
        .info-card {
            background: #F5F9FF;
            border-radius: 24px;
            padding: 24px;
            margin-bottom: 24px;
            border: 1px solid #E2EEFF;
        }
        
        .info-title {
            font-size: 18px;
            font-weight: 700;
            color: #1A2E45;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .info-badge {
            background: #0066FF;
            color: white;
            padding: 4px 12px;
            border-radius: 40px;
            font-size: 12px;
            font-weight: 600;
        }
        
        /* Features em grid */
        .features-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 24px;
        }
        
        .feature {
            background: white;
            padding: 16px;
            border-radius: 18px;
            text-align: center;
            border: 1px solid #E2EEFF;
        }
        
        .feature-emoji {
            font-size: 28px;
            margin-bottom: 8px;
        }
        
        .feature-title {
            font-size: 14px;
            font-weight: 600;
            color: #1A2E45;
            margin-bottom: 4px;
        }
        
        .feature-desc {
            font-size: 11px;
            color: #4A5B6E;
        }
        
        /* Timeline das etapas */
        .timeline {
            background: white;
            border-radius: 20px;
            padding: 20px;
            margin-bottom: 24px;
        }
        
        .timeline-item {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .timeline-item:last-child {
            margin-bottom: 0;
        }
        
        .timeline-number {
            width: 36px;
            height: 36px;
            background: #F5F9FF;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: #0066FF;
            border: 1px solid #E2EEFF;
        }
        
        .timeline-content {
            flex: 1;
            text-align: left;
        }
        
        .timeline-title {
            font-size: 15px;
            font-weight: 600;
            color: #1A2E45;
            margin-bottom: 2px;
        }
        
        .timeline-sub {
            font-size: 12px;
            color: #4A5B6E;
        }
        
        .timeline-duration {
            background: #E8F0FE;
            padding: 4px 10px;
            border-radius: 40px;
            font-size: 12px;
            font-weight: 600;
            color: #0066FF;
        }
        
        /* Footer e link admin */
        .admin-section {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid #E2EEFF;
        }
        
        .admin-link {
            color: #4A5B6E;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: #F5F9FF;
            border-radius: 40px;
            transition: all 0.2s;
        }
        
        .admin-link:hover {
            background: #E2EEFF;
            color: #0066FF;
        }
        
        .footer {
            margin-top: 20px;
            color: #4A5B6E;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="card">
            <!-- Ícone animado -->
            <div class="animated-icon"></div>
            
            <!-- Título -->
            <h1>Gerar Acesso<br>de 20 Horas</h1>
            
            <!-- Descrição -->
            <div class="description">
                Complete as etapas de verificação para gerar suas credenciais de acesso temporário
            </div>
            
            <!-- Botão iniciar -->
            <a href="/acesso-mod" class="button">
                Iniciar Processo
            </a>
            
            <!-- Card informativo -->
            <div class="info-card">
                <div class="info-title">
                    <span>ℹ️</span> Como funciona?
                    <span class="info-badge">6 etapas</span>
                </div>
                
                <!-- Grid de features -->
                <div class="features-grid">
                    <div class="feature">
                        <div class="feature-emoji"></div>
                        <div class="feature-title">15 segundos</div>
                        <div class="feature-desc">por etapa</div>
                    </div>
                    <div class="feature">
                        <div class="feature-emoji"></div>
                        <div class="feature-title">Seguro</div>
                        <div class="feature-desc">verificação</div>
                    </div>
                </div>
                
                <!-- Timeline das etapas -->
                <div class="timeline">
                    <div class="timeline-item">
                        <div class="timeline-number">1</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Verificação inicial</div>
                            <div class="timeline-sub">Validação do dispositivo</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                    
                    <div class="timeline-item">
                        <div class="timeline-number">2</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Análise de segurança</div>
                            <div class="timeline-sub">Checagem automática</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                    
                    <div class="timeline-item">
                        <div class="timeline-number">3</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Confirmação</div>
                            <div class="timeline-sub">Validação final</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                    
                    <div class="timeline-item">
                        <div class="timeline-number">4</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Geração de token</div>
                            <div class="timeline-sub">Criptografia</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                    
                    <div class="timeline-item">
                        <div class="timeline-number">5</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Vinculação</div>
                            <div class="timeline-sub">Associação ao dispositivo</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                    
                    <div class="timeline-item">
                        <div class="timeline-number">6</div>
                        <div class="timeline-content">
                            <div class="timeline-title">Liberação</div>
                            <div class="timeline-sub">Acesso concedido</div>
                        </div>
                        <div class="timeline-duration">15s</div>
                    </div>
                </div>
                
                <!-- Total de tempo -->

            </div>
            
            <!-- Área Admin -->
            
            
            <!-- Footer -->
            <div class="footer">
                Sistema de verificação • 6 etapas de segurança
            </div>
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
app.get('/acesso-mod', (req, res) => {
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
    <title>Etapa ${payload.step} de 6</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        
        body {
            background: linear-gradient(145deg, #E8F0FE 0%, #D9E9FF 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 16px;
        }
        
        /* Container principal */
        .main-container {
            max-width: 480px;
            width: 100%;
            margin: 0 auto;
        }
        
        /* Card principal */
        .card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 32px;
            padding: 28px 24px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 98, 204, 0.25),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
            margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.8);
        }
        
        /* Header com gradiente */
        .header-gradient {
            background: linear-gradient(135deg, #0066FF 0%, #0099FF 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        
        h1 {
            font-size: 32px;
            font-weight: 800;
            color: #1A2E45;
            margin-bottom: 4px;
            line-height: 1.2;
        }
        
        .step-badge {
            display: inline-block;
            background: #E8F0FE;
            padding: 6px 16px;
            border-radius: 100px;
            font-size: 14px;
            font-weight: 600;
            color: #0066FF;
            margin-bottom: 20px;
            border: 1px solid rgba(0, 102, 255, 0.2);
        }
        
        .step-indicator {
            color: #4A5B6E;
            font-size: 15px;
            margin-bottom: 24px;
            font-weight: 500;
            background: #F5F9FF;
            padding: 12px 16px;
            border-radius: 16px;
            border: 1px solid #E2EEFF;
        }
        
        /* Timer container moderno */
        .timer-container {
            background: linear-gradient(145deg, #F0F7FF, #E5F0FF);
            border-radius: 28px;
            padding: 28px 20px;
            margin-bottom: 24px;
            border: 1px solid rgba(255, 255, 255, 0.8);
            box-shadow: 0 10px 20px -10px rgba(0, 102, 255, 0.2);
        }
        
        .timer {
            font-size: 64px;
            font-weight: 800;
            color: #0066FF;
            text-align: center;
            font-family: 'SF Mono', 'Courier New', monospace;
            line-height: 1;
            margin-bottom: 8px;
            text-shadow: 0 2px 10px rgba(0, 102, 255, 0.2);
        }
        
        .timer-label {
            text-align: center;
            color: #4A5B6E;
            font-size: 15px;
            font-weight: 500;
            letter-spacing: 0.5px;
        }
        
        /* Progress bar estilosa */
        .progress-section {
            margin-bottom: 24px;
        }
        
        .progress-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        
        .progress-text {
            font-size: 14px;
            font-weight: 600;
            color: #1A2E45;
        }
        
        .progress-percent {
            font-size: 14px;
            font-weight: 700;
            color: #0066FF;
            background: #E8F0FE;
            padding: 4px 8px;
            border-radius: 20px;
        }
        
        .progress-bar {
            width: 100%;
            height: 10px;
            background: #E2EEFF;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0, 102, 255, 0.1) inset;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #0066FF, #0099FF);
            width: 0%;
            transition: width 0.1s linear;
            border-radius: 20px;
            box-shadow: 0 0 10px #0099FF;
        }
        
        /* Botão moderno */
        .button {
            width: 100%;
            padding: 18px 24px;
            border: none;
            border-radius: 24px;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s ease;
            background: linear-gradient(145deg, #E2EEFF, #D1E3FF);
            color: #4A5B6E;
            box-shadow: 0 4px 12px rgba(0, 102, 255, 0.1);
        }
        
        .button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        .button:not(:disabled) {
            background: linear-gradient(145deg, #0066FF, #0099FF);
            color: white;
            box-shadow: 0 10px 20px -5px rgba(0, 102, 255, 0.4);
        }
        
        .button:not(:disabled):active {
            transform: scale(0.98);
        }
        
        /* Mensagem de status */
        .message {
            background: #E8F0FE;
            border-left: 4px solid #0066FF;
            border-radius: 16px;
            padding: 16px 20px;
            color: #1A2E45;
            margin: 20px 0;
            font-weight: 500;
            display: none;
            box-shadow: 0 4px 12px rgba(0, 102, 255, 0.1);
        }
        
        /* Espaços de anúncios nativos */
        .ad-container {
            background: white;
            border-radius: 24px;
            padding: 20px;
            margin-bottom: 20px;
            border: 1px solid #E2EEFF;
            box-shadow: 0 8px 20px -8px rgba(0, 0, 0, 0.1);
        }
        
        .ad-badge {
            display: inline-block;
            background: #FFE8E0;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            color: #FF6B4A;
            margin-bottom: 12px;
        }
        
        .ad-content {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .ad-icon {
            width: 56px;
            height: 56px;
            background: linear-gradient(145deg, #0066FF, #0099FF);
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 28px;
        }
        
        .ad-text h3 {
            font-size: 18px;
            font-weight: 700;
            color: #1A2E45;
            margin-bottom: 4px;
        }
        
        .ad-text p {
            font-size: 14px;
            color: #4A5B6E;
            line-height: 1.4;
        }
        
        .ad-cta {
            color: #0066FF;
            font-weight: 600;
            text-decoration: none;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-top: 8px;
        }
        
        /* Conteúdo informativo */
        .info-card {
            background: white;
            border-radius: 24px;
            padding: 24px;
            margin-bottom: 20px;
            border: 1px solid #E2EEFF;
        }
        
        .info-title {
            font-size: 18px;
            font-weight: 700;
            color: #1A2E45;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .info-title span {
            background: #0066FF;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
        }
        
        .info-text {
            color: #4A5B6E;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 16px;
        }
        
        .info-features {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        
        .feature-item {
            background: #F5F9FF;
            padding: 12px;
            border-radius: 16px;
            text-align: center;
        }
        
        .feature-item .emoji {
            font-size: 24px;
            margin-bottom: 4px;
        }
        
        .feature-item .text {
            font-size: 12px;
            font-weight: 600;
            color: #1A2E45;
        }
        
        .feature-item .subtext {
            font-size: 10px;
            color: #4A5B6E;
        }
        
        /* Dicas rápidas */
        .tips-container {
            background: #F5F9FF;
            border-radius: 20px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .tip {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .tip:last-child {
            margin-bottom: 0;
        }
        
        .tip-number {
            width: 32px;
            height: 32px;
            background: white;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: #0066FF;
            border: 1px solid #E2EEFF;
        }
        
        .tip-text {
            font-size: 14px;
            color: #1A2E45;
            flex: 1;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            color: #4A5B6E;
            font-size: 12px;
            padding: 20px 0 10px;
        }
    </style>
</head>
<body>
    <div class="main-container">
        
        <!-- Card principal do step -->
        <div class="card">
            <span class="step-badge">Etapa ${payload.step} de 6</span>
            <h1>Verificação<br>para acesso Super Movitel Mod</h1>
            
            <div class="step-indicator">
                Complete todas as 6 etapas para liberar seu acesso
            </div>
            
            <!-- Timer com design melhorado -->
            <div class="timer-container">
                <div class="timer" id="timer">15</div>
                <div class="timer-label">segundos restantes para avançar</div>
            </div>
            
            <!-- Barra de progresso com percentual -->
            <div class="progress-section">
                <div class="progress-header">
                    <span class="progress-text">Progresso da etapa</span>
                    <span class="progress-percent" id="progressPercent">0%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progress"></div>
                </div>
            </div>
            
            <!-- Mensagem de status -->
            <div class="message" id="message"></div>
            
            <!-- Botão de avançar -->
            <button class="button" id="nextBtn" disabled>
                <span id="btnText">Aguardando tempo...</span>
            </button>
            
            <!-- Dicas rápidas durante a espera -->
            <div class="tips-container">
                <div class="tip">
                    <div class="tip-number">①</div>
                    <div class="tip-text">Nunca compartilhe suas credenciais</div>
                </div>
                <div class="tip">
                    <div class="tip-number">②</div>
                    <div class="tip-text">Use no seu dispositivo</div>
                </div>
                <div class="tip">
                    <div class="tip-number">③</div>
                    <div class="tip-text">Cada acesso só funciona num único dispositivo</div>
                </div>
            </div>
        </div>
        
        <!-- Espaço para anúncio nativo 1 -->
        <div class="ad-container">
            
        </div>
        
        <!-- Card informativo com conteúdo relevante -->
        <div class="info-card">
            <div class="info-title">
                <span></span> Por que isso é importante?
            </div>
            <div class="info-text">
                A verificação em múltiplas etapas garante que apenas você tenha acesso à sua conta. 
                Este processo adicional de segurança impede acessos não autorizados e mantém seus 
                dados protegidos contra invasores.

        </div>
        
        <!-- Espaço para anúncio nativo 2 -->
        <div class="ad-container">

        </div>
        
        <!-- Footer com informações adicionais -->
        <div class="footer">
            © 2026 · Mrdoso-web
        </div>
    </div>

    <script>
        let timeLeft = 15;
        const timerEl = document.getElementById('timer');
        const nextBtn = document.getElementById('nextBtn');
        const btnText = document.getElementById('btnText');
        const messageEl = document.getElementById('message');
        const progressEl = document.getElementById('progress');
        const progressPercent = document.getElementById('progressPercent');
        const token = '${token}';
        const currentStep = ${payload.step};
        
        // Atualiza a cada segundo
        const interval = setInterval(() => {
            timeLeft--;
            timerEl.textContent = timeLeft;
            
            // Calcula percentual
            const percent = ((15 - timeLeft) / 15 * 100);
            progressEl.style.width = percent + '%';
            progressPercent.textContent = Math.round(percent) + '%';
            
            // Muda cor do timer quando está acabando
            if (timeLeft <= 5) {
                timerEl.style.color = '#FF6B4A';
            } else {
                timerEl.style.color = '#0066FF';
            }
            
            if (timeLeft <= 0) {
                clearInterval(interval);
                timerEl.textContent = "0";
                progressEl.style.width = '100%';
                progressPercent.textContent = '100%';
                
                nextBtn.disabled = false;
                btnText.textContent = "Avançar para próxima etapa →";
                
                // Feedback visual
                nextBtn.style.background = 'linear-gradient(145deg, #0066FF, #0099FF)';
            } else {
                btnText.textContent = "Aguarde " + timeLeft + "s";
            }
        }, 1000);
        
        function nextStep() {
            nextBtn.disabled = true;
            btnText.textContent = "Processando...";
            
            fetch('/api/next-step?token=' + token + '&currentStep=' + currentStep)
                .then(res => res.json())
                .then(data => {
                    if (data.redirect) {
                        // Animação de saída
                        document.querySelector('.main-container').style.opacity = '0';
                        setTimeout(() => {
                            window.location.href = data.redirect;
                        }, 300);
                    } else if (data.error) {
                        messageEl.style.display = 'block';
                        messageEl.textContent = '⚠️ ' + data.error;
                        btnText.textContent = "Tentar novamente";
                        nextBtn.disabled = false;
                        
                        setTimeout(() => {
                            messageEl.style.display = 'none';
                        }, 3000);
                    }
                })
                .catch(() => {
                    messageEl.style.display = 'block';
                    messageEl.textContent = '⚠️ Erro de conexão. Tente novamente.';
                    btnText.textContent = "Tentar novamente";
                    nextBtn.disabled = false;
                });
        }
        
        nextBtn.onclick = nextStep;
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

    // FINAL DAS ETAPAS
    if (clientStep >= 6) {
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
        
        console.log('✅ Credenciais geradas:', credentials.username);
        
        return res.json({ 
            redirect: '/success?u=' + encodeURIComponent(credentials.username) + '&p=' + encodeURIComponent(credentials.password)
        });
    }
    
    // PRÓXIMA ETAPA
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        
        body {
            background: linear-gradient(145deg, #E8F0FE 0%, #D9E9FF 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 16px;
        }
        
        .main-container {
            max-width: 480px;
            width: 100%;
            margin: 0 auto;
        }
        
        /* Card principal */
        .card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 32px;
            padding: 32px 24px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 98, 204, 0.25),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
            border: 1px solid rgba(255, 255, 255, 0.8);
        }
        
        /* Header com ícone de sucesso */
        .success-header {
            text-align: center;
            margin-bottom: 24px;
        }
        
        .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(145deg, #48BB78, #38A169);
            border-radius: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
            box-shadow: 0 10px 20px -5px rgba(72, 187, 120, 0.3);
        }
        
        .success-icon span {
            font-size: 40px;
            color: white;
        }
        
        h1 {
            font-size: 32px;
            font-weight: 800;
            color: #1A2E45;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        
        .subtitle {
            color: #4A5B6E;
            font-size: 16px;
            font-weight: 500;
            background: #F5F9FF;
            padding: 8px 16px;
            border-radius: 100px;
            display: inline-block;
            border: 1px solid #E2EEFF;
        }
        
        /* Container das credenciais */
        .credentials-container {
            background: #F5F9FF;
            border-radius: 24px;
            padding: 24px;
            margin: 24px 0;
            border: 2px dashed #0066FF;
            position: relative;
        }
        
        .credentials-container::before {
            content: "🔐";
            position: absolute;
            top: -12px;
            left: 20px;
            background: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
            border: 1px solid #0066FF;
            color: #0066FF;
            font-weight: 600;
        }
        
        .credential-row {
            margin-bottom: 20px;
        }
        
        .credential-row:last-child {
            margin-bottom: 0;
        }
        
        .label {
            font-size: 13px;
            font-weight: 600;
            color: #0066FF;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .value {
            background: white;
            border: 1px solid #E2EEFF;
            padding: 16px 20px;
            border-radius: 18px;
            font-family: 'SF Mono', 'Courier New', monospace;
            font-size: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 10px rgba(0, 102, 255, 0.05);
        }
        
        .copy-btn {
            background: linear-gradient(145deg, #E8F0FE, #D9E9FF);
            color: #0066FF;
            border: none;
            padding: 8px 16px;
            border-radius: 40px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
            border: 1px solid rgba(0, 102, 255, 0.2);
        }
        
        .copy-btn:hover {
            background: linear-gradient(145deg, #0066FF, #0099FF);
            color: white;
            transform: scale(1.05);
        }
        
        .copy-btn.copied {
            background: linear-gradient(145deg, #48BB78, #38A169);
            color: white;
            border: none;
        }
        
        /* Card de aviso */
        .warning-card {
            background: #FFF4E8;
            border-radius: 20px;
            padding: 20px;
            margin-bottom: 24px;
            border-left: 4px solid #FF9800;
        }
        
        .warning-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            color: #C75E00;
            margin-bottom: 8px;
        }
        
        .warning-text {
            color: #4A5B6E;
            font-size: 14px;
            line-height: 1.5;
        }
        
        /* Informações adicionais */
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 24px;
        }
        
        .info-item {
            background: #F5F9FF;
            padding: 16px;
            border-radius: 18px;
            text-align: center;
        }
        
        .info-item .emoji {
            font-size: 24px;
            margin-bottom: 4px;
        }
        
        .info-item .title {
            font-size: 14px;
            font-weight: 600;
            color: #1A2E45;
            margin-bottom: 2px;
        }
        
        .info-item .desc {
            font-size: 11px;
            color: #4A5B6E;
        }
        
        /* Botão de voltar */
        .button {
            background: linear-gradient(145deg, #0066FF, #0099FF);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 40px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            width: 100%;
            text-align: center;
            box-shadow: 0 10px 20px -5px rgba(0, 102, 255, 0.4);
            transition: all 0.3s;
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 25px -5px rgba(0, 102, 255, 0.5);
        }
        
        .button:active {
            transform: translateY(0);
        }
        
        /* Footer */
        .footer {
            text-align: center;
            margin-top: 20px;
            color: #4A5B6E;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="card">
            <!-- Header de sucesso -->
            <div class="success-header">
                <div class="success-icon">
                    <span></span>
                </div>
                <h1>Acesso Gerado!</h1>
                <div class="subtitle">⏱️ Válido por 20 horas</div>
            </div>
            
            <!-- Credenciais -->
            <div class="credentials-container">
                <div class="credential-row">
                    <div class="label">
                        <span></span> USUÁRIO
                    </div>
                    <div class="value" id="username">${username}</div>
                </div>
                
                <div class="credential-row">
                    <div class="label">
                        <span></span> SENHA
                    </div>
                    <div class="value" id="password">${password}</div>
                </div>
            </div>
            
            <!-- Aviso importante -->
            <div class="warning-card">
                <div class="warning-title">
                    <span></span> Atenção!
                </div>
                <div class="warning-text">
                    Esta conta será vinculada ao primeiro dispositivo que fizer login. 
                    Não compartilhe suas credenciais com ninguém.
                </div>
            </div>
            
            <!-- Grid informativo -->
            <div class="info-grid">
                <div class="info-item">
                    <div class="emoji"></div>
                    <div class="title">Protegido</div>
                    <div class="desc">Criptografia avançada</div>
                </div>
                <div class="info-item">
                    <div class="emoji"></div>
                    <div class="title">Rápido</div>
                    <div class="desc">Acesso imediato</div>
                </div>
            </div>
            
            <!-- Botão voltar -->
            <a href="/" class="button">← Voltar ao Início</a>
            
            <!-- Footer -->
            <div class="footer">
                Guarde suas credenciais em local seguro
            </div>
        </div>
    </div>

    <script>
        function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            const valueDiv = element;
            const text = valueDiv.innerText.replace('Copiar', '').replace('Copiado!', '').trim();
            
            navigator.clipboard.writeText(text).then(() => {
                const btn = element.querySelector('.copy-btn');
                const originalText = btn.textContent;
                
                btn.textContent = 'Copiado!';
                btn.classList.add('copied');
                
                setTimeout(() => {
                    btn.textContent = 'Copiar';
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
        
        // Adiciona botões de cópia
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
            // Primeiro acesso - vincula este device
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
    const allLicenses = await getAllLicenses();
    
    const licenseRows = allLicenses.map(license => {
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
                    <div class="stat-number">${allLicenses.length}</div>
                </div>
                <div class="stat-card">
                    <div>Ativas</div>
                    <div class="stat-number">${allLicenses.filter(l => new Date() < new Date(l.expiresAt)).length}</div>
                </div>
                <div class="stat-card">
                    <div>Vinculadas</div>
                    <div class="stat-number">${allLicenses.filter(l => l.registeredDeviceId).length}</div>
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
        licenses.delete(username);
        
        // Remove também dos devices associados
        for (const [device, uname] of devices.entries()) {
            if (uname === username) {
                devices.delete(device);
            }
        }
        
        return res.json({ success: true, message: 'Licença ' + username + ' removida' });
        
    } else if (deviceId) {
        const username = devices.get(deviceId);
        if (username) {
            licenses.delete(username);
            devices.delete(deviceId);
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
        
    ⚡ SEM REDIS! Usando armazenamento em memória.
    ⏱️  ${STEP_TIME_MS/1000}s por etapa · 6 etapas
    `);
});