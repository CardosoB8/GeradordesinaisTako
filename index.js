const express = require('express');
const app = express();

// Armazenamento com controle de tempo
let devices = {};

app.get('/login', (req, res) => {
    const { deviceId, username, type } = req.query;
    
    console.log('📱 Login attempt:', { deviceId, username, type });
    
    if (!deviceId) {
        return res.json({ success: false, message: 'Device ID required' });
    }

    const now = new Date();
    const device = devices[deviceId];

    // Conta de teste (user1) - limite de 1 hora
    if (username === 'user1') {
        if (device) {
            const timeDiff = (now - new Date(device.firstSeen)) / (1000 * 60 * 60);
            
            if (timeDiff >= 1) {
                console.log('⏰ Trial expirado para:', deviceId);
                return res.json({ 
                    success: false, 
                    message: 'Acesso trial expirado (1 hora)',
                    expired: true 
                });
            } else {
                device.lastSeen = now;
                device.accessCount = (device.accessCount || 0) + 1;
                console.log('✅ Acesso trial:', deviceId, `(${Math.floor(60 - (timeDiff * 60))}min restantes)`);
                return res.json({ 
                    success: true, 
                    message: 'Acesso trial permitido',
                    remaining: Math.floor(60 - (timeDiff * 60))
                });
            }
        } else {
            // Primeiro acesso
            devices[deviceId] = {
                username: 'user1',
                type: 'trial',
                firstSeen: now,
                lastSeen: now,
                accessCount: 1
            };
            console.log('🎉 Novo trial registrado:', deviceId);
            return res.json({ 
                success: true, 
                message: 'Trial iniciado - 1 hora de acesso',
                remaining: 60
            });
        }
    }

    // Contas premium (sempre permitido)
    if (username && username !== 'user1') {
        if (!device) {
            devices[deviceId] = {
                username: username,
                type: 'premium',
                firstSeen: now,
                lastSeen: now,
                accessCount: 1
            };
            console.log('⭐ Nova conta premium:', username, deviceId);
        } else {
            device.lastSeen = now;
            device.accessCount = (device.accessCount || 0) + 1;
        }
        
        return res.json({ 
            success: true, 
            message: 'Acesso premium permitido'
        });
    }

    res.json({ success: false, message: 'Credenciais inválidas' });
});

// Ver dispositivos
app.get('/devices', (req, res) => {
    res.json(devices);
});

// Remover dispositivo
app.get('/remove', (req, res) => {
    const { deviceId } = req.query;
    if (deviceId && devices[deviceId]) {
        delete devices[deviceId];
        console.log('🗑️ Dispositivo removido:', deviceId);
        res.json({ success: true, message: 'Dispositivo removido' });
    } else {
        res.json({ success: false, message: 'Dispositivo não encontrado' });
    }
});

// Limpar trials expirados
app.get('/cleanup', (req, res) => {
    const now = new Date();
    let removed = 0;
    
    Object.keys(devices).forEach(deviceId => {
        const device = devices[deviceId];
        if (device.type === 'trial') {
            const timeDiff = (now - new Date(device.firstSeen)) / (1000 * 60 * 60);
            if (timeDiff >= 1) {
                delete devices[deviceId];
                removed++;
            }
        }
    });
    
    console.log('🧹 Cleanup realizado:', removed, 'dispositivos removidos');
    res.json({ removed });
});

app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000');
    console.log('📱 Login: http://localhost:3000/login?deviceId=TEST&username=user1');
    console.log('👀 Devices: http://localhost:3000/devices');
    console.log('🧹 Cleanup: http://localhost:3000/cleanup');
});
