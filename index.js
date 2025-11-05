const express = require('express');
const app = express();

// Armazenamento simples
let devices = {};

app.get('/login', (req, res) => {
    const { deviceId, username, type } = req.query;
    
    console.log('📱 Dispositivo registrado:', { deviceId, username, type });
    
    if (deviceId) {
        if (!devices[deviceId]) {
            devices[deviceId] = {
                firstSeen: new Date(),
                lastSeen: new Date(),
                username: username || 'unknown',
                type: type || 'trial'
            };
            console.log('✅ Novo dispositivo:', deviceId);
        } else {
            devices[deviceId].lastSeen = new Date();
            console.log('🔄 Dispositivo existente:', deviceId);
        }
    }
    
    // Sempre responde sucesso
    res.json({ status: 'ok', message: 'Device registered' });
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
        res.json({ status: 'removed' });
    } else {
        res.json({ status: 'not_found' });
    }
});

app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000');
    console.log('📱 Login: http://localhost:3000/login?deviceId=TEST');
    console.log('👀 Devices: http://localhost:3000/devices');
});
