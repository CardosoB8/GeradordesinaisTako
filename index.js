const express = require('express');
const { createClient } = require('redis'); 
const app = express();
const port = 3000; 

// --- Configuração das Credenciais do Redis ---
// 🚨 ATENÇÃO: SUBSTITUA ESSA STRING PELA SUA REAL E MOVA PARA VARIÁVEL DE AMBIENTE NO VERCEL!
// Deve começar com 'rediss://'
const REDIS_URL = 'rediss://default:UnK847ICOOWU5DS7RTGOHbauOq0PemVj@redis-16345.c81.us-east-1-2.ec2.redns.redis-cloud.com:16345'; 


// 1. Inicializa o Cliente Redis usando a URL (método mais robusto para Serverless)
const client = createClient({
    url: REDIS_URL // Isso lida com o SSL/TLS automaticamente (rediss://)
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
// Conecta no início
connectRedis();


app.use(express.json());

// --- Contas Premium Estáticas ---
const PREMIUM_ACCOUNTS = {
    "seu_primeiro_cliente": "licenca123",
    "usuario_vip": "minha_senha_secreta"
    // Adicione mais contas Premium aqui
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
    try {
        const data = await client.get(deviceId); // Obtém a string JSON
        if (!data) return null;
        return JSON.parse(data);
    } catch (e) {
        // Erro de Redis ou Parse (o que pode ter causado o timeout anterior)
        console.error(`Erro ao obter dados para ${deviceId}:`, e.message);
        return null; 
    }
}

/**
 * Salva os dados de licença para um Device ID.
 * @param {string} deviceId 
 * @param {object} data - Os dados do dispositivo (username, type, firstSeen, etc.)
 * @returns {Promise<void>}
 */
async function setDeviceData(deviceId, data) {
    // Salvamos como uma string JSON
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
    // LEITURA DO REDIS
    const deviceRecord = await getDeviceData(deviceId);
    
    // ---------------------- LÓGICA DE TESTE (TRIAL: user1/25) ----------------------
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (deviceRecord && deviceRecord.username === 'user1') {
            // ID JÁ REGISTRADO COMO TRIAL
            const timeDiff = (now - new Date(deviceRecord.firstSeen)) / (1000 * 60 * 60);

            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                // EXPIRADO
                console.log(`⏰ Trial expirado para ID: ${deviceId}`);
                return res.json({ success: false, message: 'Seu teste de 1 hora expirou. ID bloqueado.', expired: true, type: 'expired' });
            } else {
                // ATIVO - ATUALIZAÇÃO E SALVAMENTO
                deviceRecord.lastSeen = now.toISOString();
                await setDeviceData(deviceId, deviceRecord); // SALVA NO REDIS
                
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                return res.json({ success: true, message: `Acesso Trial permitido (${remainingMinutes} min restantes)`, type: 'trial' });
            }
        } else {
            // NOVO TRIAL (ou ID era Premium/Outro, mas tenta Trial agora)
            const newRecord = {
                username: 'user1', type: 'trial',
                firstSeen: now.toISOString(), lastSeen: now.toISOString(),
            };
            await setDeviceData(deviceId, newRecord); // SALVA NO REDIS
            console.log(`🎉 Novo Trial iniciado para ID: ${deviceId}`);
            return res.json({ success: true, message: 'Trial iniciado. Você tem 1 hora de acesso.', type: 'trial' });
        }
    }

    // ---------------------- LÓGICA PREMIUM ----------------------
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        // Chave de índice: Onde guardamos qual ID está usando esta conta Premium
        const premiumIndexKey = `premium_user_index:${username}`;
        const activeIdForUser = await client.get(premiumIndexKey); 

        // 1. Verificação de USO ÚNICO (Multi-Dispositivo)
        if (activeIdForUser && activeIdForUser !== deviceId) {
            // Bloqueio de Multi-Dispositivo
            console.log(`❌ Bloqueio: ${username} já ativo em ID: ${activeIdForUser}`);
            return res.json({ 
                success: false, 
                message: `Esta conta Premium já está em uso em outro dispositivo.`,
                expired: true, type: 'multi_device_lock'
            });
        }
        
        // 2. Registro/Atualização do Device ID atual
        let recordToSave;

        if (deviceRecord && deviceRecord.username === username && deviceRecord.type === 'premium') {
            // Sessão existente
            recordToSave = deviceRecord;
        } else {
            // Novo registro premium/Upgrade
            recordToSave = { 
                username, type: 'premium', 
                firstSeen: now.toISOString(), // Registra a ativação Premium
            };
        }
        
        recordToSave.lastSeen = now.toISOString();
        
        // SALVA NO REDIS: Chave do dispositivo e Chave de índice (para unicidade)
        await setDeviceData(deviceId, recordToSave); 
        await client.set(premiumIndexKey, deviceId); // Registra este ID como o ID oficial desta conta

        console.log(`⭐ Login Premium Sucedido: ${username} no ID: ${deviceId}`);
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
    
    // NOTA: É recomendável que você adicione uma chave de segurança (API Key) a este endpoint /remove

    if (deviceId) {
        // 1. Obtém dados do dispositivo antes de deletar
        const deviceData = await getDeviceData(deviceId); 
        // 2. Remove a chave principal do dispositivo
        await client.del(deviceId); 
        
        // 3. Se for Premium, remove o índice de unicidade também
        if (deviceData && deviceData.type === 'premium') {
             const premiumIndexKey = `premium_user_index:${deviceData.username}`;
             await client.del(premiumIndexKey);
        }
        
        console.log(`🗑️ Licença do ID ${deviceId} e índices relacionados removidos.`);
        res.json({ success: true, message: `Licença do ID ${deviceId} removida` });
        
    } else if (username) {
         // Remove apenas pelo username Premium (liberando a licença para outro dispositivo)
         const premiumIndexKey = `premium_user_index:${username}`;
         const activeId = await client.get(premiumIndexKey);
         if (activeId) {
             // Deleta o registro do dispositivo
             await client.del(activeId); 
             // Deleta o índice que liga o usuário ao ID
             await client.del(premiumIndexKey); 
             
             console.log(`🗑️ Licença Premium de ${username} removida e ID ${activeId} liberado.`);
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
