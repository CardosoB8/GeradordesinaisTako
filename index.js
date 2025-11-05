const express = require('express');
const fs = require('fs'); // Importa o módulo File System do Node.js
const path = require('path');
const app = express();
const port = 3000; 

// Nome e caminho do arquivo de persistência
const LICENSES_FILE = path.join(__dirname, 'licenses.json');

// Configuração (Middleware)
app.use(express.json());

// Armazenamento em memória (cache) que será sincronizado com o arquivo
let devices = {}; 

// --- Contas Premium Estáticas ---
const PREMIUM_ACCOUNTS = {
    "seu_primeiro_cliente": "licenca123",
    "usuario_vip": "minha_senha_secreta"
};

// =================================================================
// FUNÇÕES DE PERSISTÊNCIA (LER E SALVAR NO DISCO)
// =================================================================

/**
 * Carrega os dados de licença do arquivo JSON para a memória (cache).
 */
function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8');
            devices = JSON.parse(data);
            console.log(`✅ Licenças carregadas do disco: ${Object.keys(devices).length} IDs.`);
        } else {
            // Se o arquivo não existe, cria um objeto vazio.
            devices = {}; 
            console.log('⚠️ Arquivo licenses.json não encontrado. Iniciando com dados vazios.');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar licenças:', error.message);
        devices = {}; // Falha no parse, inicia vazio para evitar travar.
    }
}

/**
 * Salva os dados de licença da memória para o arquivo JSON no disco.
 * @returns {Promise<void>}
 */
function saveLicenses() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(devices, null, 4); // null, 4 para formatação bonita
        fs.writeFile(LICENSES_FILE, data, 'utf8', (err) => {
            if (err) {
                console.error('❌ Erro ao salvar licenças:', err.message);
                return reject(err);
            }
            console.log('💾 Licenças salvas com sucesso.');
            resolve();
        });
    });
}

// Carrega os dados ao iniciar o servidor
loadLicenses();


// =================================================================
// ENDPOINT PRINCIPAL
// =================================================================

app.post('/login', async (req, res) => { // Tornar a função assíncrona para usar await
    const { deviceId, username, password } = req.body;
    
    // ... (restante da validação inicial)
    if (!deviceId || !username || !password) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    const now = new Date();
    // Usa a cópia em memória (cache) para a leitura
    const deviceRecord = devices[deviceId];
    let dataChanged = false; // Flag para saber se precisamos salvar

    // ---------------------- LÓGICA DE TESTE (TRIAL) ----------------------
    if (username === 'user1' && password === '25') {
        const TRIAL_LIMIT_HOURS = 1;

        if (deviceRecord) {
            const timeDiff = (now - new Date(deviceRecord.firstSeen)) / (1000 * 60 * 60);
            
            if (timeDiff >= TRIAL_LIMIT_HOURS) {
                // TRIAL EXPIRADO
                return res.json({ 
                    success: false, 
                    message: 'Seu teste de 1 hora expirou. ID bloqueado.',
                    expired: true, 
                    type: 'expired'
                });
            } else {
                // TRIAL ATIVO - Apenas atualiza a hora e continua
                deviceRecord.lastSeen = now;
                dataChanged = true;
                const remainingMinutes = Math.floor((TRIAL_LIMIT_HOURS - timeDiff) * 60);
                // ... (resposta de sucesso trial)
                // Se a lógica passou, salve antes de responder
                if(dataChanged) await saveLicenses(); 
                return res.json({ success: true, message: `Acesso Trial permitido (${remainingMinutes} min restantes)`, type: 'trial' });
            }
        } else {
            // NOVO TRIAL
            devices[deviceId] = {
                username: 'user1',
                type: 'trial',
                firstSeen: now.toISOString(), // Salva a data em formato string para o JSON
                lastSeen: now.toISOString(),
            };
            dataChanged = true;
            console.log('🎉 Novo trial registrado:', deviceId);
            // Salve os dados
            await saveLicenses(); 
            return res.json({ success: true, message: 'Trial iniciado. Você tem 1 hora de acesso.', type: 'trial' });
        }
    }

    // ---------------------- LÓGICA PREMIUM ----------------------
    if (PREMIUM_ACCOUNTS[username] && PREMIUM_ACCOUNTS[username] === password) {
        
        // 1. Verificação de USO ÚNICO (Multi-Dispositivo)
        const activePremiumDevice = Object.keys(devices).find(id => 
            devices[id].username === username && 
            devices[id].type === 'premium' && 
            id !== deviceId
        );

        if (activePremiumDevice) {
            // Bloqueio de Multi-Dispositivo
            return res.json({ 
                success: false, 
                message: `Esta conta Premium já está em uso em outro dispositivo.`,
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
                firstSeen: now.toISOString(), 
                lastSeen: now.toISOString(),
            };
            dataChanged = true;
        } else {
            // Atualização de sessão para o mesmo ID/usuário
            deviceRecord.lastSeen = now.toISOString();
            dataChanged = true;
        }

        // Se a lógica passou e houve alteração, salve no disco
        if(dataChanged) await saveLicenses();
        
        return res.json({ 
            success: true, 
            message: `Acesso Premium permitido. Bem-vindo, ${username}!`,
            type: 'premium'
        });
    }

    // --- FALHA DE CREDENCIAIS GERAIS ---
    res.json({ success: false, message: 'Credenciais inválidas: Usuário ou senha incorretos.' });
});

// ... (Endpoint /remove também precisa ser atualizado)

app.get('/remove', async (req, res) => { // Torna a função assíncrona
    const { deviceId } = req.query;
    if (deviceId && devices[deviceId]) {
        delete devices[deviceId];
        // Salva a alteração
        await saveLicenses(); 
        console.log('🗑️ Dispositivo removido (licença resetada):', deviceId);
        res.json({ success: true, message: `Dispositivo ${deviceId} removido` });
    } else {
        res.json({ success: false, message: 'Dispositivo não encontrado' });
    }
});


app.listen(port, () => {
    console.log(`🚀 Servidor de Licenças rodando na porta ${port}`);
    console.log('Dados de licença persistentes via licenses.json.');
});
