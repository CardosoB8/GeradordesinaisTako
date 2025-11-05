const express = require('express');
const app = express();
const port = 3000; 

// Configuração para processar JSON no corpo das requisições POST
app.use(express.json());

// Armazenamento de estado (Em produção, use um Banco de Dados!)
let devices = {};
// Estrutura: { 'deviceId_ABC': { username: 'user1', type: 'trial', firstSeen: '...', lastSeen: '...' } }

// --- Contas Premium Estáticas ---
const PREMIUM_ACCOUNTS = {
    // FORMATO: "username": "password"
    "seu_primeiro_cliente": "licenca123",
    "usuario_vip": "minha_senha_secreta",
    "pro_member": "12345"
};

// --- Endpoint de Login (POST) ---
app.post('/login', (req, res) => {
    // 1. Recebe os dados
    const { deviceId, username, password } = req.body;
    
    console.log('📱 Tentativa de Login:', { deviceId, username });
    
    if (!deviceId || !username || !password) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    const now = new Date();
    const deviceRecord = devices[deviceId];
    
    // --- LÓGICA CONTA DE TESTE (user1, pass: 25) ---
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (deviceRecord) {
            // ID JÁ REGISTRADO (Voltando)
            const timeDiff = (now - new Date(deviceRecord.firstSeen)) / (1000 * 60 * 60); // Diferença em horas
            
            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                // TRIAL EXPIRADO
                console.log('⏰ Trial expirado para:', deviceId);
                return res.json({ 
                    success: false, 
                    message: 'Acesso limitado: Seu teste de 1 hora expirou. O ID deste dispositivo não pode mais ser usado.',
                    expired: true, 
                    type: 'expired'
                });
            } else {
                // TRIAL ATIVO
                deviceRecord.lastSeen = now;
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                console.log(`✅ Acesso trial: ${deviceId} (${remainingMinutes}min restantes)`);
                return res.json({ 
                    success: true, 
                    message: `Acesso Trial permitido (${remainingMinutes} min restantes)`,
                    type: 'trial'
                });
            }
        } else {
            // NOVO TRIAL (Primeiro Acesso com este ID)
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

    // --- LÓGICA CONTAS PREMIUM ---
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        // 1. Verificação de USO ÚNICO (Multi-Dispositivo)
        // Encontrar se ESTA CONTA JÁ ESTÁ EM USO em *qualquer* outro Device ID
        const activePremiumDevice = Object.keys(devices).find(id => 
            devices[id].username === username && 
            devices[id].type === 'premium' && 
            id !== deviceId
        );

        if (activePremiumDevice) {
            // Bloqueio de Multi-Dispositivo: A conta está ativa em outro lugar
            console.log(`❌ Bloqueio Premium: ${username} já está em uso em ${activePremiumDevice}`);
            return res.json({ 
                success: false, 
                message: `Esta conta Premium já está em uso em outro dispositivo. ID ativo: ${activePremiumDevice}.`,
                expired: true, 
                type: 'multi_device_lock'
            });
        }
        
        // 2. Registro/Atualização do Device ID atual
        if (!deviceRecord || deviceRecord.type !== 'premium' || deviceRecord.username !== username) {
             // Novo registro premium ou upgrade de trial
             devices[deviceId] = {
                username: username,
                type: 'premium',
                firstSeen: now,
                lastSeen: now,
            };
            console.log(`⭐ Nova licença Premium registrada para ${username} no ID: ${deviceId}`);
        } else {
            // Atualização de sessão para o mesmo ID/usuário
            deviceRecord.lastSeen = now;
            console.log(`✔️ Acesso Premium para ${username} atualizado no ID: ${deviceId}`);
        }

        return res.json({ 
            success: true, 
            message: `Acesso Premium permitido. Bem-vindo, ${username}!`,
            type: 'premium'
        });
    }

    // --- FALHA DE CREDENCIAIS GERAIS ---
    res.json({ success: false, message: 'Credenciais inválidas: Usuário ou senha incorretos.' });
});

// --- Endpoint de Remoção (GET) ---
// Útil para liberar uma licença premium ou resetar um trial.
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
    console.log(`🚀 Servidor de Licenças rodando na porta ${port}`);
    console.log('Lembre-se de rodar em um servidor acessível e usar HTTPS.');
});
