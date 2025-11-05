const express = require('express');
const Redis = require('ioredis'); // Importa a biblioteca Redis
const app = express();
const port = 3000; 

// 1. Configurar a Conexão com o Redis (usando as variáveis de ambiente)
const redis = new Redis({
    port: process.env.REDIS_PORT || 6379,
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 10000 // Aumenta um pouco o tempo de conexão, se necessário
});

redis.on("connect", () => console.log("✔️ Conectado ao Redis com sucesso."));
redis.on("error", (err) => console.error("❌ Erro na Conexão Redis:", err));


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
 * @returns {Promise<object | null>}
 */
async function getDeviceData(deviceId) {
    const data = await redis.get(deviceId);
    if (!data) return null;
    return JSON.parse(data);
}

/**
 * Salva os dados de licença para um Device ID.
 * @param {string} deviceId 
 * @param {object} data - Os dados do dispositivo (username, type, firstSeen, etc.)
 * @returns {Promise<void>}
 */
async function setDeviceData(deviceId, data) {
    // Salvamos como uma string JSON
    await redis.set(deviceId, JSON.stringify(data));
}


// =================================================================
// ENDPOINT PRINCIPAL (AGORA 100% ASSÍNCRONO)
// =================================================================

app.post('/login', async (req, res) => {
    const { deviceId, username, password } = req.body;
    
    if (!deviceId || !username || !password) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    const now = new Date();
    // LEITURA DO REDIS
    const deviceRecord = await getDeviceData(deviceId);
    
    // ---------------------- LÓGICA DE TESTE (TRIAL) ----------------------
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (deviceRecord) {
            // ... (Lógica de tempo e expiração, idêntica ao anterior)
            
            const timeDiff = (now - new Date(deviceRecord.firstSeen)) / (1000 * 60 * 60);

            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                // EXPIRADO
                return res.json({ success: false, message: 'Seu teste de 1 hora expirou. ID bloqueado.', expired: true, type: 'expired' });
            } else {
                // ATIVO - ATUALIZAÇÃO E SALVAMENTO
                deviceRecord.lastSeen = now.toISOString();
                await setDeviceData(deviceId, deviceRecord); // SALVA NO REDIS
                
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                return res.json({ success: true, message: `Acesso Trial permitido (${remainingMinutes} min restantes)`, type: 'trial' });
            }
        } else {
            // NOVO TRIAL - CRIAÇÃO E SALVAMENTO
            const newRecord = {
                username: 'user1', type: 'trial',
                firstSeen: now.toISOString(), lastSeen: now.toISOString(),
            };
            await setDeviceData(deviceId, newRecord); // SALVA NO REDIS
            return res.json({ success: true, message: 'Trial iniciado. Você tem 1 hora de acesso.', type: 'trial' });
        }
    }

    // ---------------------- LÓGICA PREMIUM ----------------------
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        // 1. Verificação de USO ÚNICO (Multi-Dispositivo)
        // Usamos SCAN ou uma busca pré-indexada para grandes bancos de dados. 
        // Para simplificar, faremos uma varredura (menos performática, mas funciona):
        
        // Lógica de varredura simplificada: Você precisará de uma forma de listar todos os IDs 
        // ou usar um índice secundário. A lógica de array anterior não funciona diretamente no Redis.
        
        // **OPÇÃO MAIS SEGURA E SIMPLES COM REDIS PARA UNICIDADE:**
        // Crie uma chave de índice: `premium_user_index:USERNAME`
        
        const premiumIndexKey = `premium_user_index:${username}`;
        const activeIdForUser = await redis.get(premiumIndexKey); // Vê qual ID está ativo para esta conta

        if (activeIdForUser && activeIdForUser !== deviceId) {
            // Bloqueio de Multi-Dispositivo: A conta está ativa em outro lugar
            return res.json({ 
                success: false, 
                message: `Esta conta Premium já está em uso em outro dispositivo.`,
                expired: true, type: 'multi_device_lock'
            });
        }
        
        // 2. Registro/Atualização do Device ID atual
        // ... (criação de newRecord)
        
        const recordToSave = deviceRecord && deviceRecord.username === username ? deviceRecord : { username, type: 'premium', firstSeen: now.toISOString() };
        recordToSave.lastSeen = now.toISOString();
        
        // SALVA NO REDIS: Chave do dispositivo e Chave de índice
        await setDeviceData(deviceId, recordToSave); 
        await redis.set(premiumIndexKey, deviceId); // Registra este ID como o ID oficial desta conta

        return res.json({ 
            success: true, 
            message: `Acesso Premium permitido. Bem-vindo, ${username}!`,
            type: 'premium'
        });
    }

    // --- FALHA DE CREDENCIAIS GERAIS ---
    res.json({ success: false, message: 'Credenciais inválidas: Usuário ou senha incorretos.' });
});

// ... (Endpoint /remove também deve usar redis.del(deviceId))

app.listen(port, () => {
    console.log(`🚀 Servidor de Licenças rodando na porta ${port}`);
});
