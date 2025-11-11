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
    "mrodoso": "20050202",
    "premium14": "8367266472",
    "premium01": "84778637276",
    "premium02": "85827372775",
    "premium03": "86927463728",
    "premium04": "87928374659",
    "premium05": "88746372819",
    "premium06": "89736281947",
    "premium07": "90817263548",
    "premium08": "91827364506",
    "premium09": "92736481920",
    "premium10": "93827164503",
    "premium11": "94738291056",
    "premium12": "95847382910",
    "premium13": "96857483921",
    "premium15": "97868574839",
    "premium16": "98765847392",
    "premium17": "99685748302",
    "premium18": "10085748392",
    "premium19": "10195847382",
    "premium20": "10294857648",
    "premium21": "10385749203",
    "premium22": "10475849302",
    "premium23": "10584930291",
    "premium24": "10675849301",
    "premium25": "10785940382",
    "premium26": "10876958403",
    "premium27": "10985746382",
    "premium28": "11095847362",
    "premium29": "11185749302",
    "premium30": "11295847301",
    "premium31": "11385749203",
    "premium32": "11495847362",
    "premium33": "11585749382",
    "premium34": "11695847301",
    "premium35": "11785749203",
    "premium36": "11895847362",
    "premium37": "11985749382",
    "premium38": "12095847301",
    "premium39": "12185749203",
    "premium40": "12295847362",
    "premium41": "12385749382",
    "premium42": "12495847301",
    "premium43": "12585749203",
    "premium44": "12695847362",
    "premium45": "12785749382",
    "premium46": "12895847301",
    "premium47": "12985749203",
    "premium48": "13095847362",
    "premium49": "13185749382",
    "premium50": "13295847301"
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
    if (username === 'teste1' && password === '2025') {
        const TRIAL_LIMIT_HOURS = 24;

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
