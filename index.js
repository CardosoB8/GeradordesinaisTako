const express = require('express');
const app = express();

app.use(express.json());

// Dados em memória (em produção use um banco)
let authorizedDevices = [];
let premiumAccounts = [];

// Conta de teste: user1 / 25 (1 hora)
app.post('/login', (req, res) => {
    const { username, password, deviceId } = req.body;
    
    console.log('Login attempt:', { username, deviceId });
    
    // SEMPRE retornar JSON válido
    if (!username || !password || !deviceId) {
        return res.json({ 
            success: false, 
            message: 'Dados incompletos' 
        });
    }

    // Conta de teste
    if (username === "user1" && password === "25") {
        const existingDevice = authorizedDevices.find(d => 
            d.deviceId === deviceId && d.username === "user1"
        );
        
        if (existingDevice) {
            const timeDiff = (Date.now() - new Date(existingDevice.authorizedAt).getTime()) / (1000 * 60 * 60);
            if (timeDiff >= 1) {
                return res.json({ 
                    success: false, 
                    message: "Acesso limitado - Trial de 1 hora expirado" 
                });
            }
            
            return res.json({ 
                success: true, 
                message: "Login trial realizado com sucesso" 
            });
        } else {
            // Primeiro login - registrar
            authorizedDevices.push({
                username: "user1",
                deviceId: deviceId,
                authorizedAt: new Date().toISOString(),
                accountType: "trial"
            });
            
            return res.json({ 
                success: true, 
                message: "Login trial realizado - Você tem 1 hora de acesso" 
            });
        }
    }
    
    // Verificar contas premium
    const premiumAccount = premiumAccounts.find(pa => 
        pa.username === username && pa.deviceId === deviceId
    );
    
    if (premiumAccount) {
        return res.json({ 
            success: true, 
            message: "Login premium realizado com sucesso" 
        });
    }
    
    // Credenciais inválidas
    res.json({ 
        success: false, 
        message: "Credenciais inválidas" 
    });
});

// Rota para adicionar conta premium
app.post('/add-premium', (req, res) => {
    const { username, deviceId, adminKey } = req.body;
    
    if (adminKey !== "minhaChaveSecreta123") {
        return res.json({ success: false, message: "Não autorizado" });
    }
    
    premiumAccounts.push({ 
        username, 
        deviceId, 
        addedAt: new Date().toISOString() 
    });
    
    res.json({ success: true, message: "Conta premium adicionada" });
});

// Rota para debug - ver dados atuais
app.get('/debug', (req, res) => {
    res.json({
        authorizedDevices,
        premiumAccounts
    });
});

app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000');
    console.log('📊 Debug: http://localhost:3000/debug');
});
