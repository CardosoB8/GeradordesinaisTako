const express = require('express');
const app = express();
const port = 3000; // Use a porta que você está usando no Vercel/servidor, se for diferente de 3000

// Middleware para processar JSON no corpo das requisições POST
app.use(express.json());

// Armazenamento de estado (ATENÇÃO: Deve ser persistente em produção - use um banco de dados!)
let devices = {};

// --- Endpoint de Login (POST) ---
app.post('/login', (req, res) => {
    // 1. Recebe os dados do corpo (body) da requisição POST
    const { deviceId, username, password } = req.body;
    
    console.log('📱 Tentativa de Login:', { deviceId, username });
    
    if (!deviceId || !username || !password) {
        // HTTP 400 Bad Request
        return res.status(400).json({ success: false, message: 'Dados incompletos: ID, Usuário e Senha são obrigatórios.' });
    }

    const now = new Date();
    const device = devices[deviceId];

    // --- LÓGICA CONTA DE TESTE (user1, pass: 25) ---
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (device) {
            const timeDiff = (now - new Date(device.firstSeen)) / (1000 * 60 * 60); // Diferença em horas
            
            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                // Acesso Negado (Trial Expirado)
                console.log('⏰ Trial expirado para:', deviceId);
                return res.json({ 
                    success: false, 
                    message: 'Acesso limitado: Seu teste de 1 hora expirou.',
                    expired: true, // Campo esperado pelo seu código Java
                    type: 'expired'
                });
            } else {
                // Trial Ativo
                device.lastSeen = now;
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                console.log(`✅ Acesso trial: ${deviceId} (${remainingMinutes}min restantes)`);
                return res.json({ 
                    success: true, 
                    message: `Acesso Trial permitido (${remainingMinutes} min restantes)`,
                    type: 'trial' // Campo esperado pelo seu código Java
                });
            }
        } else {
            // Novo Trial
            devices[deviceId] = {
                username: 'user1',
                type: 'trial',
                firstSeen: now,
                lastSeen: now,
            };
            console.log('🎉 Novo trial registrado:', deviceId);
            return res.json({ 
                success: true, 
                message: 'Trial iniciado. Você tem 1 hora de acesso.',
                type: 'trial'
            });
        }
    }

    // --- LÓGICA CONTAS PREMIUM (Exemplo de Credenciais Válidas) ---
    const PREMIUM_ACCOUNTS = {
        "premium_user": "secret_pass"
    };
    
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        if (!device || device.type !== 'premium') {
             devices[deviceId] = {
                username: username,
                type: 'premium',
                firstSeen: now,
                lastSeen: now,
            };
            console.log('⭐ Nova conta premium registrada:', username, deviceId);
        } else {
            devices[deviceId].lastSeen = now;
        }

        return res.json({ 
            success: true, 
            message: 'Acesso Premium permitido. Bem-vindo!',
            type: 'premium'
        });
    }

    // --- FALHA DE CREDENCIAIS GERAIS ---
    res.json({ success: false, message: 'Credenciais inválidas: Usuário ou senha incorretos.' });
});

// --- Endpoint para Remoção (GET) ---
app.get('/remove', (req, res) => {
    const { deviceId } = req.query;
    if (deviceId && devices[deviceId]) {
        delete devices[deviceId];
        console.log('🗑️ Dispositivo removido (licença resetada):', deviceId);
        res.json({ success: true, message: `Dispositivo ${deviceId} removido` });
    } else {
        res.json({ success: false, message: 'Dispositivo não encontrado' });
    }
});


app.listen(port, () => {
    console.log(`🚀 Servidor rodando na porta ${port}`);
});
