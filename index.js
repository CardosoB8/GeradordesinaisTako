const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// CONFIGURAÇÕES DE SEGURANÇA
// =================================================================
// server.js
const ALLOWED_AD_NETWORKS = [
    'https://quge5.com',                          // Monetag
    'https://pl27551656.revenuecpmgate.com',     // Adsterra
    'https://omg10.com',                          // CPA Links
    'https://www.effectivegatecpm.com',          // CPA Links
    // Adicione mais quando precisar:
    // 'https://pagead2.googlesyndication.com',   // Google Adsense
    // 'https://adservice.google.com',            // Google Ads
];

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'",  // Permite scripts inline que VOCÊ gera
                ...ALLOWED_AD_NETWORKS
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'", "https:"],  // Para iframes de anúncios
        }
    }
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Muitas requisições' }
});
app.use(limiter);

// =================================================================
// CONFIGURAÇÃO DO REDIS (O SEU, QUE JÁ FUNCIONA!)
// =================================================================
const redisClient = redis.createClient({
    url: 'redis://default:JyefUsxHJljfdvs8HACumEyLE7XNgLvG@redis-19242.c266.us-east-1-3.ec2.cloud.redislabs.com:19242'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('✅ Conectado ao Redis Cloud!'));

(async () => {
    await redisClient.connect();
    console.log('🚀 Redis pronto para uso!');
})();

// =================================================================
// CONFIGURAÇÕES DO SISTEMA DE LINKS
// =================================================================
const SESSION_EXPIRATION = 24 * 60 * 60; // 24 horas em segundos

// Carregar links dinamicamente
let linksData = [];
try {
    linksData = require('./data/links.js');
    console.log('✅ Links carregados:', linksData.map(l => `${l.alias} (${l.steps || 4} etapas)`).join(', '));
} catch (error) {
    console.error('❌ Erro ao carregar links.js:', error.message);
    linksData = [];
}

// Configuração das etapas
const BASE_STEP_CONFIGS = {
    impar: { 
        temAnuncio: false, 
        timer: 10, 
        titulo: 'Verificação de Acesso', 
        subtitulo: 'Confirmando que você não é um robô...', 
        tipoBotao: 'cpa',
        icone: 'shield-alt'
    },
    par: { 
        temAnuncio: true, 
        timer: 15, 
        titulo: 'Processando Link', 
        subtitulo: 'Estabelecendo conexão segura...', 
        tipoBotao: 'normal',
        icone: 'lock'
    },
    final: { 
        temAnuncio: true, 
        timer: 15, 
        titulo: 'Link Pronto!', 
        subtitulo: 'Seu conteúdo está disponível', 
        tipoBotao: 'final',
        icone: 'check-circle'
    }
};

// Links CPA
const CPA_LINKS = [
    'https://omg10.com/4/10420694',
    'https://www.effectivegatecpm.com/ki4e3ftt5h?key=99415bf2c750643bbcc7c1380848fee9',
    'https://pertlouv.com/pZ0Ob1Vxs8U=?',
    'https://record.elephantbet.com/_rhoOOvBxBOAWqcfzuvZcQGNd7ZgqdRLk/1/',
    'https://media1.placard.co.mz/redirect.aspx?pid=5905&bid=1690',
    'https://affiliates.bantubet.co.mz/links/?btag=2307928',
    'https://bony-teaching.com/KUN7HR'
];

// =================================================================
// FUNÇÕES DE SESSÃO COM REDIS (MESMO PADRÃO QUE FUNCIONA)
// =================================================================
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function getClientFingerprint(req) {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    return crypto.createHash('sha256').update(ip + userAgent).digest('hex').substring(0, 16);
}

async function createSession(alias, totalSteps, req) {
    const sessionId = generateSessionId();
    const fingerprint = getClientFingerprint(req);
    
    const sessionData = {
        id: sessionId,
        alias: alias,
        etapa_atual: 1,
        totalSteps: totalSteps,
        fingerprint: fingerprint,
        criado_em: Date.now(),
        ultima_acao: Date.now(),
        cpas_abertos: 0,
        ip: req.ip
    };
    
    // Salva no Redis (igual seu sistema de licenças)
    await redisClient.setEx(
        `session:${sessionId}`,
        SESSION_EXPIRATION,
        JSON.stringify(sessionData)
    );
    
    // Backup por fingerprint
    await redisClient.setEx(
        `fingerprint:${fingerprint}`,
        SESSION_EXPIRATION,
        sessionId
    );
    
    console.log(`✅ Sessão criada: ${sessionId.substring(0, 8)}... para ${alias}`);
    return sessionData;
}

async function getSession(sessionId) {
    if (!sessionId) return null;
    
    try {
        const data = await redisClient.get(`session:${sessionId}`);
        if (!data) return null;
        
        const session = JSON.parse(data);
        session.ultima_acao = Date.now();
        
        // Renova expiração
        await redisClient.setEx(
            `session:${sessionId}`,
            SESSION_EXPIRATION,
            JSON.stringify(session)
        );
        
        return session;
    } catch (e) {
        console.error('❌ Erro ao buscar sessão:', e);
        return null;
    }
}

async function updateSession(sessionId, etapa) {
    const session = await getSession(sessionId);
    if (!session) return null;
    
    session.etapa_atual = etapa;
    session.ultima_acao = Date.now();
    
    await redisClient.setEx(
        `session:${sessionId}`,
        SESSION_EXPIRATION,
        JSON.stringify(session)
    );
    
    return session;
}

async function recoverSession(req) {
    // Tenta pelo cookie
    const sessionId = req.cookies?.sessionId;
    if (sessionId) {
        const session = await getSession(sessionId);
        if (session) return session;
    }
    
    // Tenta pelo header (para apps)
    const headerSession = req.headers['x-session-id'];
    if (headerSession) {
        const session = await getSession(headerSession);
        if (session) return session;
    }
    
    // Tenta pelo fingerprint
    const fingerprint = getClientFingerprint(req);
    const recoveredId = await redisClient.get(`fingerprint:${fingerprint}`);
    if (recoveredId) {
        const session = await getSession(recoveredId);
        if (session) return session;
    }
    
    return null;
}

// =================================================================
// FUNÇÕES AUXILIARES
// =================================================================
function getStepConfig(etapa, totalSteps) {
    if (etapa === totalSteps) {
        return { ...BASE_STEP_CONFIGS.final };
    }
    
    const isImpar = etapa % 2 === 1;
    const baseConfig = isImpar ? BASE_STEP_CONFIGS.impar : BASE_STEP_CONFIGS.par;
    
    const titulos = {
        1: 'Verificação Inicial',
        2: 'Conexão Segura',
        3: 'Confirmação Adicional', 
        4: 'Otimização de Rede',
        5: 'Verificação Final',
        6: 'Preparando Conteúdo'
    };
    
    const subtitulos = {
        1: 'Confirmando que você não é um robô...',
        2: 'Estabelecendo túnel criptografado...',
        3: 'Última verificação de segurança...',
        4: 'Acelerando conexão com o servidor...',
        5: 'Quase pronto! Última confirmação...',
        6: 'Descriptografando link de destino...'
    };
    
    return {
        ...baseConfig,
        titulo: titulos[etapa] || baseConfig.titulo,
        subtitulo: subtitulos[etapa] || baseConfig.subtitulo
    };
}

function getRandomCpaLink() {
    return CPA_LINKS[Math.floor(Math.random() * CPA_LINKS.length)];
}

// =================================================================
// MIDDLEWARE DE SESSÃO
// =================================================================
app.use(async (req, res, next) => {
    // Pula para rotas públicas
    if (req.path === '/' || req.path.startsWith('/public') || req.path === '/favicon.ico') {
        return next();
    }
    
    // Recupera sessão
    const session = await recoverSession(req);
    req.session = session;
    
    // Seta cookie se não existir
    if (session && !req.cookies?.sessionId) {
        res.cookie('sessionId', session.id, {
            maxAge: SESSION_EXPIRATION * 1000,
            httpOnly: true,
            secure: false, // Mude para true se usar HTTPS
            sameSite: 'lax'
        });
    }
    
    next();
});

// Para ler cookies
app.use(require('cookie-parser')());

// =================================================================
// ROTAS
// =================================================================

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de entrada (encurtador) - URL LIMPA!
app.get('/:alias', async (req, res) => {
    const alias = req.params.alias;
    const link = linksData.find(l => l.alias === alias);
    
    console.log(`🔗 Acessando alias: ${alias}`);
    
    if (!link) {
        console.log(`❌ Alias não encontrado: ${alias}`);
        return res.redirect('/');
    }
    
    const totalSteps = link.steps || 4;
    
    // Cria sessão no Redis
    const session = await createSession(alias, totalSteps, req);
    
    // Seta cookie
    res.cookie('sessionId', session.id, {
        maxAge: SESSION_EXPIRATION * 1000,
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    });
    
    // URL LIMPA - sem token!
    res.redirect('/page1');
});

// Rotas das etapas - URLs LIMPAS!
app.get('/page:step', async (req, res) => {
    const step = parseInt(req.params.step);
    
    console.log(`📄 Acessando page${step}`);
    
    if (!req.session) {
        console.log('❌ Sem sessão');
        return res.redirect('/');
    }
    
    const session = req.session;
    
    // Verifica se está na etapa correta
    if (step !== session.etapa_atual) {
        console.log(`⚠️ Redirecionando: etapa correta é ${session.etapa_atual}`);
        return res.redirect(`/page${session.etapa_atual}`);
    }
    
    if (step > session.totalSteps) {
        console.log(`❌ Etapa ${step} maior que total ${session.totalSteps}`);
        return res.redirect('/');
    }
    
    const link = linksData.find(l => l.alias === session.alias);
    if (!link) {
        console.log(`❌ Alias não encontrado: ${session.alias}`);
        return res.redirect('/');
    }
    
    const config = getStepConfig(step, session.totalSteps);
    const cpaLink = (!config.temAnuncio && step < session.totalSteps) ? getRandomCpaLink() : null;
    
    // Passa o sessionId para o frontend (via header ou script)
    res.send(gerarHTMLPagina(step, session.totalSteps, config, session.id, cpaLink, link.original_url));
});

// API para avançar etapa
app.post('/api/next-step', async (req, res) => {
    const { currentStep, sessionId } = req.body;
    
    console.log(`🔄 Next-step: etapa ${currentStep}`);
    
    if (!sessionId) {
        return res.status(403).json({ error: 'Sessão inválida', redirect: '/' });
    }
    
    const session = await getSession(sessionId);
    if (!session) {
        return res.status(403).json({ error: 'Sessão expirada', redirect: '/' });
    }
    
    const clientStep = parseInt(currentStep);
    
    if (session.etapa_atual !== clientStep) {
        return res.status(400).json({ error: 'Sequência inválida', redirect: '/' });
    }
    
    const link = linksData.find(l => l.alias === session.alias);
    if (!link) {
        return res.status(404).json({ error: 'Link não encontrado', redirect: '/' });
    }
    
    // Última etapa - redireciona para o link final
    if (clientStep >= session.totalSteps) {
        console.log(`✅ Finalizado! Redirecionando para: ${link.original_url}`);
        return res.json({ 
            redirect: link.original_url,
            final: true
        });
    }
    
    // Avança etapa
    const novaEtapa = clientStep + 1;
    await updateSession(sessionId, novaEtapa);
    
    console.log(`✅ Avançando: etapa ${clientStep} → ${novaEtapa} (total: ${session.totalSteps})`);
    
    return res.json({ 
        redirect: `/page${novaEtapa}`,
        final: false
    });
});

// API para obter configuração
app.get('/api/step-config', async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    if (!sessionId) {
        return res.status(403).json({ error: 'Sessão inválida' });
    }
    
    const session = await getSession(sessionId);
    if (!session) {
        return res.status(403).json({ error: 'Sessão expirada' });
    }
    
    const config = getStepConfig(session.etapa_atual, session.totalSteps);
    const cpaLink = (!config.temAnuncio && session.etapa_atual < session.totalSteps) ? getRandomCpaLink() : null;
    
    res.json({
        etapa: session.etapa_atual,
        totalSteps: session.totalSteps,
        ...config,
        cpaLink: cpaLink
    });
});

// =================================================================
// FUNÇÃO: Gerar HTML da página (DESIGN APRIMORADO - BOTÕES MENORES)
// =================================================================
function gerarHTMLPagina(etapa, totalSteps, config, sessionId, cpaLink, linkFinal) {
    const scriptMonetag = config.temAnuncio 
        ? '<script src="https://quge5.com/88/tag.min.js" data-zone="203209" async data-cfasync="false"></script>'
        : '';
    
    const bannersAdsterra = config.temAnuncio
        ? `
        <div class="ad-container ad-sticky">
            <div id="container-57af132f9a89824d027d70445ba09a9a"></div>
        </div>
        <div class="ad-container ad-middle">
            <div id="container-57af132f9a89824d027d70445ba09a9a-2"></div>
        </div>
        <div class="ad-container ad-footer">
            <div id="container-57af132f9a89824d027d70445ba09a9a-3"></div>
        </div>
        <script>
            if (!window.adsterraLoaded) {
                window.adsterraLoaded = true;
                const script = document.createElement('script');
                script.src = '//pl27551656.revenuecpmgate.com/57af132f9a89824d027d70445ba09a9a/invoke.js';
                script.async = true;
                script.setAttribute('data-cfasync', 'false');
                document.head.appendChild(script);
            }
        </script>
        `
        : '';
    
    const isCpaStep = !config.temAnuncio && etapa < totalSteps;
    const isFinalStep = etapa === totalSteps;
    
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Mr Doso - ${config.titulo}</title>
    ${scriptMonetag}
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #8b5cf6;
            --accent: #10b981;
            --dark: #1e293b;
            --text: #334155;
            --text-light: #64748b;
            --success: #10b981;
            --warning: #f59e0b;
            --error: #ef4444;
            --bg-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --radius-lg: 16px;
            --radius-xl: 24px;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-gradient);
            min-height: 100vh;
            padding: 16px;
            display: flex;
            justify-content: center;
            align-items: center;
            color: var(--text);
            -webkit-font-smoothing: antialiased;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(10px);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
            width: 100%;
            max-width: 520px;
            padding: 24px 20px;
            position: relative;
            overflow: hidden;
            animation: slideUp 0.3s ease;
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .container::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 3px;
            background: linear-gradient(90deg, var(--primary), var(--secondary), var(--accent));
        }
        
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
        }
        
        .step-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 5px 14px;
            border-radius: 100px;
            font-size: 0.8rem;
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        
        .step-progress {
            color: var(--text-light);
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        h1 {
            font-size: 1.6rem;
            color: var(--dark);
            margin-bottom: 6px;
            font-weight: 700;
            line-height: 1.3;
        }
        
        .subtitle {
            color: var(--text-light);
            font-size: 0.9rem;
            margin-bottom: 20px;
            line-height: 1.4;
        }
        
        .timer-section {
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-radius: var(--radius-lg);
            padding: 20px 16px;
            margin-bottom: 16px;
            border: 1px solid #e2e8f0;
        }
        
        .timer-display {
            display: flex;
            align-items: baseline;
            justify-content: center;
            gap: 3px;
            margin-bottom: 12px;
        }
        
        #countdown {
            font-size: 3rem;
            font-weight: 700;
            color: var(--primary);
            line-height: 1;
            font-variant-numeric: tabular-nums;
        }
        
        .timer-unit {
            color: var(--text-light);
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .countdown-label {
            text-align: center;
            color: var(--text-light);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
        }
        
        .loading-bar {
            width: 100%;
            height: 5px;
            background: #e2e8f0;
            border-radius: 100px;
            overflow: hidden;
        }
        
        .progress {
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, var(--primary), var(--accent));
            border-radius: 100px;
            transition: width 1s linear;
        }
        
        .ad-container {
            width: 100%;
            margin: 12px 0;
            display: flex;
            justify-content: center;
            min-height: 80px;
            background: #f8fafc;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
            padding: 6px;
            position: relative;
        }
        
        .ad-container.ad-sticky {
            position: sticky;
            top: 10px;
            z-index: 100;
            min-height: 180px;
        }
        
        .ad-container.ad-footer {
            min-height: 180px;
        }
        
        .content-area {
            background: #f8fafc;
            border-radius: var(--radius-lg);
            padding: 20px 16px;
            margin-top: 16px;
            border: 1px solid #e2e8f0;
        }
        
        .info-box {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            background: ${isCpaStep ? '#fef3c7' : '#d1fae5'};
            border-left: 3px solid ${isCpaStep ? 'var(--warning)' : 'var(--success)'};
            padding: 12px 14px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .info-box i {
            font-size: 1.1rem;
            color: ${isCpaStep ? 'var(--warning)' : 'var(--success)'};
        }
        
        .info-box-content {
            flex: 1;
        }
        
        .info-box strong {
            display: block;
            color: var(--dark);
            margin-bottom: 3px;
            font-size: 0.9rem;
        }
        
        .info-box p {
            color: var(--text);
            font-size: 0.85rem;
            line-height: 1.4;
        }
        
        .button-container {
            display: flex;
            justify-content: center;
        }
        
        .action-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            max-width: 300px;
            padding: 12px 20px;
            border-radius: 10px;
            font: 600 0.95rem 'Inter', sans-serif;
            border: none;
            cursor: pointer;
            color: white;
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            box-shadow: 0 3px 10px rgba(99, 102, 241, 0.3);
            transition: all 0.2s ease;
        }
        
        .action-button.cpa-button {
            background: linear-gradient(135deg, var(--success), #059669);
            box-shadow: 0 3px 10px rgba(16, 185, 129, 0.3);
        }
        
        .action-button.final-button {
            background: linear-gradient(135deg, var(--warning), #d97706);
            box-shadow: 0 3px 10px rgba(245, 158, 11, 0.3);
        }
        
        .action-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            box-shadow: none;
        }
        
        .action-button:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
        }
        
        .back-hint {
            text-align: center;
            margin-top: 12px;
            padding: 10px;
            background: #e0e7ff;
            border-radius: 8px;
            display: none;
            animation: pulse 1.5s infinite;
        }
        
        .back-hint.show {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        
        .back-hint i {
            color: var(--primary);
            font-size: 0.9rem;
        }
        
        .back-hint strong {
            color: var(--dark);
            font-size: 0.85rem;
        }
        
        @keyframes pulse { 
            0%, 100% { opacity: 1; } 
            50% { opacity: 0.7; } 
        }
        
        footer {
            margin-top: 20px;
            color: var(--text-light);
            font-size: 0.75rem;
            text-align: center;
        }
        
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            opacity: 0;
            visibility: hidden;
            transition: all 0.2s;
        }
        
        .modal-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        
        .modal-box {
            background: white;
            padding: 24px 20px;
            border-radius: 16px;
            max-width: 320px;
            width: 90%;
            text-align: center;
            box-shadow: var(--shadow-lg);
        }
        
        .modal-box h3 {
            color: var(--dark);
            margin-bottom: 10px;
            font-size: 1.2rem;
        }
        
        .modal-box p {
            color: var(--text);
            margin-bottom: 20px;
            line-height: 1.5;
            font-size: 0.9rem;
        }
        
        .modal-close {
            padding: 8px 24px;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9rem;
        }
        
        .force-advance {
            margin-top: 10px;
            font-size: 0.8rem;
            color: var(--text-light);
            cursor: pointer;
            text-decoration: underline;
            opacity: 0.7;
            text-align: center;
        }
        
        .force-advance:hover { opacity: 1; }
        
        @media (max-width: 480px) {
            body { padding: 12px; }
            .container { padding: 20px 16px; }
            h1 { font-size: 1.4rem; }
            #countdown { font-size: 2.5rem; }
            .ad-container.ad-sticky, .ad-container.ad-footer { min-height: 150px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="step-badge">
                <i class="fas fa-${config.icone}"></i>
                <span>ETAPA ${etapa}/${totalSteps}</span>
            </div>
            <div class="step-progress">
                ${Math.round((etapa / totalSteps) * 100)}%
            </div>
        </div>
        
        <h1>${config.titulo}</h1>
        <p class="subtitle">${config.subtitulo}</p>
        
        <div class="timer-section">
            <div class="timer-display">
                <span id="countdown">${config.timer}</span>
                <span class="timer-unit">seg</span>
            </div>
            <div class="countdown-label">AGUARDE PARA CONTINUAR</div>
            <div class="loading-bar">
                <div id="progressBar" class="progress"></div>
            </div>
        </div>
        
        ${bannersAdsterra}
        
        <div class="content-area">
            <div class="info-box">
                <i class="fas ${isCpaStep ? 'fa-shield-alt' : isFinalStep ? 'fa-check-circle' : 'fa-clock'}"></i>
                <div class="info-box-content">
                    <strong>${isCpaStep ? 'Verificação' : isFinalStep ? 'Pronto!' : 'Processando'}</strong>
                    <p>${isCpaStep ? 'Clique para verificar acesso' : isFinalStep ? 'Link pronto para acesso' : 'Botão será liberado'}</p>
                </div>
            </div>
            
            <div class="button-container">
                <button id="mainActionBtn" class="action-button ${isCpaStep ? 'cpa-button' : isFinalStep ? 'final-button' : ''}" disabled>
                    <i class="fas fa-hourglass-half"></i>
                    <span>Aguarde...</span>
                </button>
            </div>
            
            <div id="backHint" class="back-hint">
                <i class="fas fa-check-circle"></i>
                <strong>Verificado! Clique para avançar</strong>
            </div>
            
            <div class="force-advance" id="forceAdvance" style="display: none;">
                <i class="fas fa-arrow-right"></i> Avançar manualmente
            </div>
        </div>
        
        <footer>© 2026 Mr Doso Web</footer>
    </div>
    
    <div id="alertModal" class="modal-overlay">
        <div class="modal-box">
            <h3 id="alertTitle">Aviso</h3>
            <p id="alertMessage"></p>
            <button class="modal-close" onclick="closeModal()">OK</button>
        </div>
    </div>
    
    <script>
        const CONFIG = {
            etapa: ${etapa},
            totalSteps: ${totalSteps},
            timer: ${config.timer},
            cpaLink: ${cpaLink ? JSON.stringify(cpaLink) : 'null'},
            sessionId: '${sessionId}',
            isCpaStep: ${isCpaStep},
            isFinalStep: ${isFinalStep},
            linkFinal: ${isFinalStep ? JSON.stringify(linkFinal) : 'null'}
        };
        
        let timeLeft = CONFIG.timer;
        let cpaOpened = false;
        let isProcessing = false;
        
        const countdownEl = document.getElementById('countdown');
        const progressBar = document.getElementById('progressBar');
        const mainBtn = document.getElementById('mainActionBtn');
        const backHint = document.getElementById('backHint');
        const forceAdvance = document.getElementById('forceAdvance');
        
        window.addEventListener('focus', () => {
            if (CONFIG.isCpaStep && cpaOpened && !isProcessing) {
                backHint.classList.add('show');
                forceAdvance.style.display = 'block';
            }
        });
        
        function startTimer() {
            if (CONFIG.timer === 0) {
                enableButton();
                return;
            }
            
            const totalTime = CONFIG.timer;
            countdownEl.textContent = timeLeft;
            progressBar.style.width = '0%';
            
            const interval = setInterval(() => {
                if (timeLeft > 0) {
                    timeLeft--;
                    countdownEl.textContent = timeLeft;
                    progressBar.style.width = ((totalTime - timeLeft) / totalTime) * 100 + '%';
                }
                
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    enableButton();
                }
            }, 1000);
        }
        
        function enableButton() {
            mainBtn.disabled = false;
            
            if (CONFIG.isFinalStep) {
                mainBtn.innerHTML = '<i class="fas fa-external-link-alt"></i><span>Acessar Conteúdo</span>';
                mainBtn.className = 'action-button final-button';
            } else if (CONFIG.isCpaStep) {
                if (!cpaOpened) {
                    mainBtn.innerHTML = '<i class="fas fa-shield-alt"></i><span>Verificar Acesso</span>';
                    mainBtn.className = 'action-button cpa-button';
                } else {
                    mainBtn.innerHTML = '<i class="fas fa-arrow-right"></i><span>Continuar</span>';
                    mainBtn.className = 'action-button';
                }
            } else {
                mainBtn.innerHTML = '<i class="fas fa-arrow-right"></i><span>Continuar</span>';
                mainBtn.className = 'action-button';
            }
        }
        
        forceAdvance.addEventListener('click', () => {
            if (CONFIG.isCpaStep && !cpaOpened) {
                cpaOpened = true;
                enableButton();
                backHint.classList.add('show');
            }
        });
        
        mainBtn.addEventListener('click', async () => {
            if (isProcessing) return;
            if (timeLeft > 0 && CONFIG.timer > 0) {
                showModal('Aguarde', 'Faltam ' + timeLeft + ' segundos.');
                return;
            }
            
            isProcessing = true;
            
            if (CONFIG.isFinalStep) {
                window.location.href = CONFIG.linkFinal;
                return;
            }
            
            if (CONFIG.isCpaStep && !cpaOpened && CONFIG.cpaLink) {
                mainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Abrindo...</span>';
                window.open(CONFIG.cpaLink, '_blank');
                cpaOpened = true;
                enableButton();
                backHint.classList.add('show');
                forceAdvance.style.display = 'block';
                isProcessing = false;
                return;
            }
            
            mainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Processando...</span>';
            mainBtn.disabled = true;
            
            try {
                const response = await fetch('/api/next-step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        currentStep: CONFIG.etapa, 
                        sessionId: CONFIG.sessionId 
                    })
                });
                
                const data = await response.json();
                
                if (data.redirect) {
                    window.location.href = data.redirect;
                } else {
                    showModal('Erro', data.error || 'Falha ao avançar');
                    mainBtn.disabled = false;
                    enableButton();
                }
            } catch (e) {
                showModal('Erro', 'Falha na conexão');
                mainBtn.disabled = false;
                enableButton();
            } finally {
                isProcessing = false;
            }
        });
        
        function showModal(title, msg) {
            document.getElementById('alertTitle').textContent = title;
            document.getElementById('alertMessage').textContent = msg;
            document.getElementById('alertModal').classList.add('active');
        }
        
        function closeModal() {
            document.getElementById('alertModal').classList.remove('active');
        }
        
        startTimer();
    </script>
</body>
</html>`;
}

// =================================================================
// INICIA O SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`
    🚀 SERVIDOR RODANDO NA PORTA ${PORT}
    
    ✅ REDIS CLOUD CONECTADO!
    📋 Links carregados: ${linksData.length}
    🔗 URLs LIMPAS - Sem tokens na URL!
    ⚡ Performance máxima com Redis
    `);
});