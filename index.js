const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Arquivo para armazenar os dados
const DATA_FILE = path.join(__dirname, 'users.json');

// Chave secreta para assinatura (proteção contra manipulação)
const SECRET_KEY = 'sua_chave_super_secreta_aqui_12345';

// Inicializar arquivo de dados
function initializeData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            users: [
                {
                    username: "user1",
                    password: "25",
                    type: "trial",
                    createdAt: new Date().toISOString()
                }
            ],
            authorizedDevices: [],
            premiumAccounts: []
        };
        saveData(initialData);
    }
}

// Funções de segurança
function generateSignature(data) {
    return crypto.createHmac('sha256', SECRET_KEY)
        .update(JSON.stringify(data))
        .digest('hex');
}

function verifySignature(data, signature) {
    const expectedSignature = generateSignature(data);
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
}

// Função para ler dados
function readData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        return { users: [], authorizedDevices: [], premiumAccounts: [] };
    }
}

// Função para salvar dados
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Middleware de verificação de assinatura
function verifyRequest(req, res, next) {
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];
    
    // Verificar se timestamp está dentro de 5 minutos (proteção contra replay attacks)
    if (Math.abs(Date.now() - parseInt(timestamp)) > 300000) {
        return res.json({ success: false, message: 'Requisição expirada' });
    }
    
    // Verificar assinatura
    if (!signature || !verifySignature(req.body, signature)) {
        return res.json({ success: false, message: 'Assinatura inválida' });
    }
    
    next();
}

// Rota de login
app.post('/login', verifyRequest, (req, res) => {
    const { username, password, deviceId } = req.body;
    
    if (!username || !password || !deviceId) {
        return res.json({ 
            success: false, 
            message: 'Dados incompletos' 
        });
    }

    const data = readData();
    
    // Verificar usuário
    const user = data.users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.json({ 
            success: false, 
            message: 'Credenciais inválidas' 
        });
    }

    // Verificar se é conta premium
    const premiumAccount = data.premiumAccounts.find(pa => 
        pa.username === username && pa.deviceId === deviceId
    );

    if (premiumAccount) {
        // Conta premium - acesso ilimitado
        return res.json({ 
            success: true, 
            message: 'Login premium realizado com sucesso',
            accountType: 'premium',
            user: { username: user.username }
        });
    }

    // Verificar se é conta de teste
    if (user.type === 'trial') {
        const existingDevice = data.authorizedDevices.find(device => 
            device.deviceId === deviceId && device.username === username
        );

        if (existingDevice) {
            // Verificar se passou 1 hora
            const deviceTime = new Date(existingDevice.authorizedAt);
            const currentTime = new Date();
            const timeDiff = (currentTime - deviceTime) / (1000 * 60 * 60); // Diferença em horas
            
            if (timeDiff >= 1) {
                return res.json({ 
                    success: false, 
                    message: 'Acesso limitado - Trial expirado (1 hora)',
                    accountType: 'trial_expired'
                });
            } else {
                const remainingTime = 60 - Math.floor(timeDiff * 60); // Tempo restante em minutos
                return res.json({ 
                    success: true, 
                    message: `Login trial realizado - ${remainingTime} minutos restantes`,
                    accountType: 'trial',
                    remainingTime: remainingTime
                });
            }
        } else {
            // Primeiro login - registrar dispositivo
            data.authorizedDevices.push({
                username: username,
                deviceId: deviceId,
                authorizedAt: new Date().toISOString(),
                accountType: 'trial'
            });
            saveData(data);
            
            return res.json({ 
                success: true, 
                message: 'Login trial realizado - Você tem 1 hora de acesso',
                accountType: 'trial',
                remainingTime: 60
            });
        }
    }

    res.json({ 
        success: false, 
        message: 'Tipo de conta não reconhecido' 
    });
});

// Rota para adicionar conta premium
app.post('/add-premium', verifyRequest, (req, res) => {
    const { username, deviceId, adminKey } = req.body;
    
    if (adminKey !== 'minhaChaveSecreta123') {
        return res.json({ success: false, message: 'Não autorizado' });
    }
    
    const data = readData();
    
    // Verificar se usuário existe
    const user = data.users.find(u => u.username === username);
    if (!user) {
        return res.json({ success: false, message: 'Usuário não encontrado' });
    }
    
    // Adicionar/atualizar conta premium
    const existingIndex = data.premiumAccounts.findIndex(pa => 
        pa.username === username && pa.deviceId === deviceId
    );
    
    if (existingIndex !== -1) {
        data.premiumAccounts[existingIndex].updatedAt = new Date().toISOString();
    } else {
        data.premiumAccounts.push({
            username: username,
            deviceId: deviceId,
            addedAt: new Date().toISOString()
        });
    }
    
    saveData(data);
    
    res.json({ 
        success: true, 
        message: 'Conta premium adicionada/atualizada com sucesso' 
    });
});

// Rota para remover dispositivo premium
app.post('/remove-premium', verifyRequest, (req, res) => {
    const { username, deviceId, adminKey } = req.body;
    
    if (adminKey !== 'minhaChaveSecreta123') {
        return res.json({ success: false, message: 'Não autorizado' });
    }
    
    const data = readData();
    const initialLength = data.premiumAccounts.length;
    
    data.premiumAccounts = data.premiumAccounts.filter(pa => 
        !(pa.username === username && pa.deviceId === deviceId)
    );
    
    saveData(data);
    
    res.json({ 
        success: true, 
        message: `Dispositivo premium removido. ${initialLength - data.premiumAccounts.length} removido(s).`
    });
});

// Rota para verificar status
app.post('/check-status', verifyRequest, (req, res) => {
    const { username, deviceId } = req.body;
    
    const data = readData();
    
    // Verificar premium
    const premiumAccount = data.premiumAccounts.find(pa => 
        pa.username === username && pa.deviceId === deviceId
    );
    
    if (premiumAccount) {
        return res.json({ 
            accountType: 'premium',
            message: 'Conta premium - Acesso ilimitado'
        });
    }
    
    // Verificar trial
    const trialDevice = data.authorizedDevices.find(device => 
        device.deviceId === deviceId && device.username === username
    );
    
    if (trialDevice) {
        const deviceTime = new Date(trialDevice.authorizedAt);
        const currentTime = new Date();
        const timeDiff = (currentTime - deviceTime) / (1000 * 60 * 60);
        
        if (timeDiff >= 1) {
            return res.json({ 
                accountType: 'trial_expired',
                message: 'Trial expirado - Acesso limitado a 1 hora'
            });
        } else {
            const remainingTime = 60 - Math.floor(timeDiff * 60);
            return res.json({ 
                accountType: 'trial',
                message: `Conta trial - ${remainingTime} minutos restantes`,
                remainingTime: remainingTime
            });
        }
    }
    
    res.json({ 
        accountType: 'none',
        message: 'Nenhum acesso configurado'
    });
});

// Listar dados (apenas para admin)
app.get('/admin/data', (req, res) => {
    const { adminKey } = req.query;
    
    if (adminKey !== 'minhaChaveSecreta123') {
        return res.json({ success: false, message: 'Não autorizado' });
    }
    
    const data = readData();
    res.json(data);
});

// Limpar trials expirados
app.post('/cleanup', verifyRequest, (req, res) => {
    const { adminKey } = req.body;
    
    if (adminKey !== 'minhaChaveSecreta123') {
        return res.json({ success: false, message: 'Não autorizado' });
    }
    
    const data = readData();
    const currentTime = new Date();
    const initialLength = data.authorizedDevices.length;
    
    data.authorizedDevices = data.authorizedDevices.filter(device => {
        if (device.accountType === 'trial') {
            const deviceTime = new Date(device.authorizedAt);
            const timeDiff = (currentTime - deviceTime) / (1000 * 60 * 60);
            return timeDiff < 1; // Manter apenas os que têm menos de 1 hora
        }
        return true; // Manter outros tipos
    });
    
    saveData(data);
    
    res.json({ 
        success: true, 
        message: `Cleanup realizado. ${initialLength - data.authorizedDevices.length} trials expirados removidos.`
    });
});

initializeData();
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📊 Admin: http://localhost:${PORT}/admin/data?adminKey=minhaChaveSecreta123`);
});
