const express = require('express');
const { createClient } = require('redis'); 
const app = express();
const port = 3000; 

// --- Configuração das Credenciais do Redis ---
// 🚨 ATENÇÃO: Substitua os valores abaixo pelos seus e mova para Variáveis de Ambiente no Vercel!
const REDIS_HOST = 'redis-16345.c81.us-east-1-2.ec2.redns.redis-cloud.com';
const REDIS_PORT = 16345;
const REDIS_PASSWORD = 'UnK847ICOOWU5DS7RTGOHbauOq0PemVj'; // Mova para process.env.REDIS_PASSWORD


// 1. Inicializa o Cliente Redis com a correção SSL/TLS
const client = createClient({
    username: 'default',
    password: REDIS_PASSWORD, // Use process.env.REDIS_PASSWORD aqui
    socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        
        // 🚨 CONFIGURAÇÃO CRÍTICA PARA SERVERLESS E ERROS TLS:
        // tls: true habilita a criptografia.
        // rejectUnauthorized: false ignora a falha na validação do certificado (que causa o 'packet length too long')
        tls: { 
            rejectUnauthorized: false
        }
    }
});

client.on('error', err => console.error('❌ Redis Client Error:', err));

// Tentativa de conexão (async)
async function connectRedis() {
    try {
        await client.connect();
        console.log("✔️ Conectado ao Redis com sucesso.");
    } catch (err) {
        console.error("❌ Falha ao conectar no Redis:", err.message);
    }
}
connectRedis();


app.use(express.json());

// --- Contas Premium Estáticas ---
const PREMIUM_ACCOUNTS = {
    "seu_primeiro_cliente": "licenca123",
    "usuario_vip": "minha_senha_secreta"
};

// =================================================================
// FUNÇÕES AUXILIARES DO REDIS
// =================================================================

/**
 * Obtém os dados de licença para um Device ID.
 * @param {string} deviceId 
 */
async function getDeviceData(deviceId) {
    try {
        const data = await client.get(deviceId);
        if (!data) return null;
        return JSON.parse(data);
    } catch (e) {
        console.error(`Erro ao obter dados para ${deviceId}:`, e.message);
        return null;
    }
}

/**
 * Salva os dados de licença para um Device ID.
 * @param {string} deviceId 
 * @param {object} data - Os dados do dispositivo
 */
async function setDeviceData(deviceId, data) {
    await client.set(deviceId, JSON.stringify(data));
}


// =================================================================
// ENDPOINT PRINCIPAL: /login
// =================================================================

app.post('/login', async (req, res) => {
    const { deviceId, username, password } = req.body;
    
    if (!deviceId || !username || !password) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    const now = new Date();
    const deviceRecord = await getDeviceData(deviceId);
    
    // ---------------------- LÓGICA DE TESTE (TRIAL: user1/25) ----------------------
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (deviceRecord && deviceRecord.username === 'user1') {
            const timeDiff = (now - new Date(deviceRecord.firstSeen)) / (1000 * 60 * 60);

            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                return res.json({ success: false, message: 'Seu teste de 1 hora expirou. ID bloqueado.', expired: true, type: 'expired' });
            } else {
                deviceRecord.lastSeen = now.toISOString();
                await setDeviceData(deviceId, deviceRecord); 
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                return res.json({ success: true, message: `Acesso Trial permitido (${remainingMinutes} min restantes)`, type: 'trial' });
            }
        } else {
            const newRecord = {
                username: 'user1', type: 'trial',
                firstSeen: now.toISOString(), lastSeen: now.toISOString(),
            };
            await setDeviceData(deviceId, newRecord); 
            return res.json({ success: true, message: 'Trial iniciado. Você tem 1 hora de acesso.', type: 'trial' });
        }
    }

    // ---------------------- LÓGICA PREMIUM ----------------------
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        const premiumIndexKey = `premium_user_index:${username}`;
        const activeIdForUser = await client.get(premiumIndexKey); 

        // 1. Verificação de USO ÚNICO (Multi-Dispositivo)
        if (activeIdForUser && activeIdForUser !== deviceId) {
            return res.json({ 
                success: false, 
                message: `Esta conta Premium já está em uso em outro dispositivo.`,
                expired: true, type: 'multi_device_lock'
            });
        }
        
        // 2. Registro/Atualização
        let recordToSave;
        if (deviceRecord && deviceRecord.username === username && deviceRecord.type === 'premium') {
            recordToSave = deviceRecord;
        } else {
            recordToSave = { 
                username, type: 'premium', 
                firstSeen: now.toISOString(), 
            };
        }
        recordToSave.lastSeen = now.toISOString();
        
        await setDeviceData(deviceId, recordToSave); 
        await client.set(premiumIndexKey, deviceId);

        return res.json({ 
            success: true, 
            message: `Acesso Premium permitido. Bem-vindo, ${username}!`,
            type: 'premium'
        });
    }

    // --- FALHA DE CREDENCIAIS GERAIS ---
    res.json({ success: false, message: 'Credenciais inválidas: Usuário ou senha incorretos.' });
});

// =================================================================
// ENDPOINT PARA REMOÇÃO DE LICENÇA (ADMIN)
// =================================================================
app.get('/remove', async (req, res) => {
    const { deviceId, username } = req.query;
    
    if (deviceId) {
        const deviceData = await getDeviceData(deviceId); 
        await client.del(deviceId); 
        
        if (deviceData && deviceData.type === 'premium') {
             const premiumIndexKey = `premium_user_index:${deviceData.username}`;
             await client.del(premiumIndexKey);
        }
        
        res.json({ success: true, message: `Licença do ID ${deviceId} removida` });
        
    } else if (username) {
         const premiumIndexKey = `premium_user_index:${username}`;
         const activeId = await client.get(premiumIndexKey);
         if (activeId) {
             await client.del(activeId); 
             await client.del(premiumIndexKey); 
             res.json({ success: true, message: `Licença Premium de ${username} removida e ID ${activeId} liberado.` });
         } else {
             res.json({ success: false, message: `Usuário Premium ${username} não encontrado ou sem dispositivo ativo.` });
         }
    } else {
        res.status(400).json({ success: false, message: 'Parâmetro deviceId ou username necessário.' });
    }
});


app.listen(port, () => {
    console.log(`🚀 Servidor de Licenças rodando na porta ${port}`);
});
