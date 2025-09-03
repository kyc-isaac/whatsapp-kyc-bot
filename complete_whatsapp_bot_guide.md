# 📱 Guía Completa: Bot WhatsApp con Twilio para API KYC-LISTAS

## 📋 Resumen del Proyecto

Crear un bot de WhatsApp que consuma tu API KYC-LISTAS usando Twilio, desplegado en Ubuntu Server con Nginx como proxy reverso.

### Características del Bot:
- ✅ Menú interactivo de bienvenida
- ✅ Búsqueda de personas físicas y morales
- ✅ Consulta a listas OFAC, DEA, SAT, PEP, FBI
- ✅ Generación y envío de PDFs
- ✅ Manejo de sesiones por usuario
- ✅ Sistema de logs completo

---

## 🚀 PASO 1: Configuración de Twilio

### 1.1 Crear Cuenta
1. Ve a [Twilio.com](https://www.twilio.com) → Sign up
2. Completa registro y verifica tu teléfono
3. Ve a Dashboard → Messaging → Try it out → Send a WhatsApp message

### 1.2 Configurar WhatsApp Sandbox
1. En WhatsApp Sandbox verás:
   - Número: `+1 415 523-8886`
   - Código: `join happy-duck` (tu código específico)
2. Desde tu WhatsApp envía: `join happy-duck` al número de Twilio
3. Recibirás confirmación de conexión

### 1.3 Obtener Credenciales
- Ve a Settings → General
- Copia **Account SID** y **Auth Token**

---

## 🛠 PASO 2: Configurar Ubuntu Server

### 2.1 Instalación de Dependencias

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PM2 y Nginx
sudo npm install -g pm2
sudo apt install -y nginx

# Verificar instalaciones
node --version
npm --version
nginx -v
```

### 2.2 Preparar Directorio de la Aplicación

```bash
# Crear directorio
sudo mkdir -p /var/www/whatsapp-bot
sudo chown $USER:$USER /var/www/whatsapp-bot
```

---

## 📝 PASO 3: Crear la Aplicación

### 3.1 Estructura del Proyecto

```bash
whatsapp-bot/
├── server.js          # Aplicación principal
├── package.json       # Dependencias
├── .env              # Variables de entorno
├── .gitignore        # Archivos a ignorar
├── ecosystem.config.js # Configuración PM2
├── temp/             # PDFs temporales
└── logs/             # Archivos de log
```

### 3.2 Inicializar Proyecto

```bash
cd /var/www/whatsapp-bot

# Inicializar proyecto Node.js
npm init -y

# Instalar dependencias
npm install express twilio axios dotenv

# Crear directorios
mkdir -p temp logs
```

### 3.3 Archivo package.json

```json
{
  "name": "whatsapp-kyc-bot",
  "version": "1.0.0",
  "description": "Bot de WhatsApp para consultas KYC",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "twilio": "^4.19.0",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1"
  }
}
```

### 3.4 Variables de Entorno (.env)

```bash
# Credenciales de Twilio
TWILIO_ACCOUNT_SID=tu_account_sid_aqui
TWILIO_AUTH_TOKEN=tu_auth_token_aqui
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Configuración API KYC
KYC_API_URL=http://localhost:3000/api/listas
KYC_API_KEY=KYC-062192Sj2NgK8aPyPHXYSxjKY

# Servidor
PORT=3001
SERVER_URL=http://tu-ip-publica
NODE_ENV=production
```

### 3.5 Archivo .gitignore

```bash
# Variables de entorno
.env

# Dependencias
node_modules/

# Archivos temporales
temp/
logs/
*.tmp
*.log

# Sistema
.DS_Store
Thumbs.db
```

### 3.6 Código Principal (server.js)

```javascript
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const KYC_API_URL = process.env.KYC_API_URL;
const KYC_API_KEY = process.env.KYC_API_KEY;

// Store de sesiones de usuarios
const userSessions = new Map();

// Estados de conversación
const STATES = {
  WELCOME: 'welcome',
  WAITING_NAME: 'waiting_name',
  WAITING_APATERNO: 'waiting_apaterno',
  WAITING_AMATERNO: 'waiting_amaterno',
  WAITING_PERSON_TYPE: 'waiting_person_type',
  PROCESSING: 'processing'
};

// Crear directorios
const tempDir = path.join(__dirname, 'temp');
const logsDir = path.join(__dirname, 'logs');
[tempDir, logsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Función de logging
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${level}: ${message}`;
  console.log(logMessage);
  
  const logFile = path.join(logsDir, `bot-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logMessage + '\n');
}

// Gestión de sesiones de usuario
function getUserSession(from) {
  if (!userSessions.has(from)) {
    userSessions.set(from, {
      state: STATES.WELCOME,
      data: {},
      lastActivity: new Date()
    });
    log(`Nueva sesión creada para ${from}`);
  } else {
    userSessions.get(from).lastActivity = new Date();
  }
  return userSessions.get(from);
}

// Envío de mensajes WhatsApp
async function sendWhatsAppMessage(to, body, mediaUrl = null) {
  try {
    const messageOptions = {
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: body
    };

    if (mediaUrl) messageOptions.mediaUrl = mediaUrl;

    const message = await client.messages.create(messageOptions);
    log(`Mensaje enviado a ${to}: SID ${message.sid}`);
    return message;
  } catch (error) {
    log(`Error enviando mensaje a ${to}: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Conversión de PDF base64 a archivo
function convertBase64ToFile(base64Data, fileName) {
  try {
    const base64Clean = base64Data.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, buffer);
    
    log(`Archivo PDF creado: ${fileName}`);
    return `${process.env.SERVER_URL}/temp/${fileName}`;
  } catch (error) {
    log(`Error convirtiendo base64 a archivo: ${error.message}`, 'ERROR');
    return null;
  }
}

// Búsqueda en API KYC
async function searchKYC(searchData) {
  try {
    log(`Búsqueda KYC iniciada: ${JSON.stringify(searchData)}`);
    
    const response = await axios.post(`${KYC_API_URL}/search`, {
      ...searchData,
      document: 1
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': KYC_API_KEY
      },
      timeout: 30000
    });
    
    log(`Búsqueda KYC completada: ${response.data.coincidences} coincidencias`);
    return response.data;
  } catch (error) {
    log(`Error en búsqueda KYC: ${error.response?.data?.message || error.message}`, 'ERROR');
    return { 
      err: true, 
      message: error.response?.data?.message || 'Error interno en la búsqueda' 
    };
  }
}

// MANEJADORES DE ESTADO

async function handleWelcome(from, body, session) {
  const welcomeMessage = `¡Hola! 👋 *Bienvenido al Bot KYC-LISTAS*

🔍 *Sistema de Consulta de Listas Restrictivas*

Selecciona una opción:
*1* - 🔎 Búsqueda en listas
*2* - ℹ️ Información del sistema  
*3* - 📞 Contacto soporte

Escribe el número de la opción que deseas.`;

  await sendWhatsAppMessage(from, welcomeMessage);
  
  const option = body.trim();
  
  if (option === '1') {
    session.state = STATES.WAITING_PERSON_TYPE;
    session.data = {};
    
    const personTypeMessage = `🔍 *Búsqueda en Listas Restrictivas*

Selecciona el tipo de persona:
*1* - 👤 Persona Física (Individual)
*2* - 🏢 Persona Moral (Empresa)

Escribe *1* o *2*:`;
    
    await sendWhatsAppMessage(from, personTypeMessage);
  } else if (option === '2') {
    const infoMessage = `ℹ️ *Información del Sistema KYC-LISTAS*

✅ *Listas consultadas:*
• OFAC (Office of Foreign Assets Control)
• DEA (Drug Enforcement Administration)  
• SAT (Sistema de Administración Tributaria)
• PEP (Personas Expuestas Políticamente)
• FBI (Federal Bureau of Investigation)
• LPB (Listas Personas Bloqueadas)

🎯 *Características:*
• Búsqueda por similitud avanzada
• Generación automática de reportes PDF
• Procesamiento en tiempo real
• Algoritmo de coincidencias inteligente

📊 *Precisión:* >95%
⚡ *Tiempo promedio:* <100ms

Para realizar una búsqueda, escribe *1*.`;
    
    await sendWhatsAppMessage(from, infoMessage);
  } else if (option === '3') {
    const contactMessage = `📞 *Soporte Técnico KYC-LISTAS*

📧 *Email:* soporte@kyc-listas.com
📱 *WhatsApp:* +52 55 1234-5678
🌐 *Web:* www.kyc-listas.com

*Horario de atención:*
🕘 Lunes a Viernes: 9:00 AM - 6:00 PM
🕘 Sábados: 9:00 AM - 2:00 PM

*Tiempo de respuesta:*
• Email: 24 horas
• WhatsApp: Inmediato en horario laboral

Para volver al menú, escribe *menu*.`;
    
    await sendWhatsAppMessage(from, contactMessage);
  }
}

async function handlePersonType(from, body, session) {
  const option = body.trim();
  
  if (option === '1' || option === '2') {
    session.data.persona = option;
    session.state = STATES.WAITING_NAME;
    
    const nameMessage = option === '1' 
      ? `👤 *Persona Física Seleccionada*

📝 Escribe el *nombre(s)* de la persona:

*Ejemplo:* JUAN CARLOS
*Nota:* Solo el nombre, después te pediré los apellidos por separado.

Para cancelar, escribe *menu*.`
      : `🏢 *Persona Moral Seleccionada*

📝 Escribe la *razón social completa* de la empresa:

*Ejemplo:* CONSTRUCTORA EJEMPLO SA DE CV

Para cancelar, escribe *menu*.`;
    
    await sendWhatsAppMessage(from, nameMessage);
  } else if (body.toLowerCase() === 'menu') {
    session.state = STATES.WELCOME;
    await handleWelcome(from, '', session);
  } else {
    await sendWhatsAppMessage(from, 
      `❌ Opción inválida. Por favor escribe:

*1* - Para Persona Física
*2* - Para Persona Moral  
*menu* - Para volver al inicio`);
  }
}

async function handleName(from, body, session) {
  if (body.toLowerCase() === 'menu') {
    session.state = STATES.WELCOME;
    await handleWelcome(from, '', session);
    return;
  }

  const name = body.trim();
  if (name.length < 2) {
    await sendWhatsAppMessage(from, 
      `❌ El nombre debe tener al menos 2 caracteres. 

Por favor intenta nuevamente:
Para cancelar, escribe *menu*.`);
    return;
  }
  
  session.data.nombre = name.toUpperCase();
  
  if (session.data.persona === '2') {
    await processSearch(from, session);
  } else {
    session.state = STATES.WAITING_APATERNO;
    await sendWhatsAppMessage(from, 
      `📝 Perfecto. Ahora escribe el *apellido paterno*:

*Ejemplo:* GARCIA

Si no tiene apellido paterno o deseas omitirlo, escribe *skip*.
Para cancelar, escribe *menu*.`);
  }
}

async function handleApaterno(from, body, session) {
  if (body.toLowerCase() === 'menu') {
    session.state = STATES.WELCOME;
    await handleWelcome(from, '', session);
    return;
  }

  if (body.toLowerCase() !== 'skip') {
    session.data.apaterno = body.trim().toUpperCase();
  }
  
  session.state = STATES.WAITING_AMATERNO;
  await sendWhatsAppMessage(from, 
    `📝 Finalmente, escribe el *apellido materno*:

*Ejemplo:* LOPEZ

Si no tiene apellido materno o deseas omitirlo, escribe *skip*.
Para cancelar, escribe *menu*.`);
}

async function handleAmaterno(from, body, session) {
  if (body.toLowerCase() === 'menu') {
    session.state = STATES.WELCOME;
    await handleWelcome(from, '', session);
    return;
  }

  if (body.toLowerCase() !== 'skip') {
    session.data.amaterno = body.trim().toUpperCase();
  }
  
  await processSearch(from, session);
}

async function processSearch(from, session) {
  session.state = STATES.PROCESSING;
  
  let searchSummary = `🔍 *Iniciando búsqueda...*

*Datos a consultar:*
👤 Tipo: ${session.data.persona === '1' ? 'Persona Física' : 'Persona Moral'}
📝 Nombre: ${session.data.nombre}`;

  if (session.data.apaterno) searchSummary += `\n📝 Apellido Paterno: ${session.data.apaterno}`;
  if (session.data.amaterno) searchSummary += `\n📝 Apellido Materno: ${session.data.amaterno}`;
  
  searchSummary += `\n\n⏳ *Procesando...* 
Consultando listas OFAC, DEA, SAT, PEP, FBI...

Esto puede tomar unos segundos.`;
  
  await sendWhatsAppMessage(from, searchSummary);
  
  const searchData = {
    persona: session.data.persona,
    nombre: session.data.nombre,
    porcentaje_min: 85
  };
  
  if (session.data.apaterno) searchData.apaterno = session.data.apaterno;
  if (session.data.amaterno) searchData.amaterno = session.data.amaterno;
  
  const result = await searchKYC(searchData);
  await handleSearchResult(from, session, result);
}

async function handleSearchResult(from, session, result) {
  if (result.err) {
    await sendWhatsAppMessage(from, 
      `❌ *Error en la búsqueda:*

${result.message}

Para realizar una nueva búsqueda, escribe *1*.
Para volver al menú, escribe *menu*.`);
    
    session.state = STATES.WELCOME;
    session.data = {};
    return;
  }

  let responseMessage = `✅ *Búsqueda Completada*

👤 *Consultado:* ${session.data.nombre}`;
  
  if (session.data.apaterno) responseMessage += ` ${session.data.apaterno}`;
  if (session.data.amaterno) responseMessage += ` ${session.data.amaterno}`;
  
  responseMessage += `\n⏱️ *Tiempo:* ${result.performance?.processing_time_ms}ms\n`;
  
  if (result.coincidences > 0) {
    responseMessage += `\n🚨 *${result.coincidences} COINCIDENCIA(S) ENCONTRADA(S)*

⚠️ *ATENCIÓN: La persona consultada APARECE en listas restrictivas*\n`;
    
    result.person.slice(0, 3).forEach((match, index) => {
      responseMessage += `\n*${index + 1}. ${match.nombre}*`;
      responseMessage += `\n   📊 Similitud: *${match.porcentaje_coincidencia}%*`;
      responseMessage += `\n   📋 Lista: *${match.tipo}*`;
      responseMessage += `\n   📍 Estado: ${match.status || 'Activo'}`;
      if (match.observaciones) {
        responseMessage += `\n   📝 ${match.observaciones}`;
      }
      responseMessage += `\n`;
    });
    
    if (result.coincidences > 3) {
      responseMessage += `\n... y ${result.coincidences - 3} coincidencias más.`;
    }
    
  } else {
    responseMessage += `\n✅ *SIN COINCIDENCIAS*

🎉 La persona consultada *NO aparece* en las listas restrictivas.

📋 *Listas consultadas:* OFAC, DEA, SAT, PEP, FBI, LPB`;
  }
  
  await sendWhatsAppMessage(from, responseMessage);
  
  // Envío de PDF
  if (result.pdf_base64) {
    await sendWhatsAppMessage(from, '📄 *Generando reporte PDF...*');
    
    try {
      const fileName = `KYC_${session.data.nombre.replace(/ /g, '_')}_${Date.now()}.pdf`;
      const pdfUrl = convertBase64ToFile(result.pdf_base64, fileName);
      
      if (pdfUrl) {
        await sendWhatsAppMessage(from, 
          `📄 *Reporte PDF disponible:*

${pdfUrl}

*Contenido del reporte:*
• Datos consultados
• Resultados de búsqueda
• Detalles de coincidencias
• Fecha y hora de consulta

El archivo estará disponible por 24 horas.`, 
          pdfUrl);
      } else {
        await sendWhatsAppMessage(from, '❌ Error al generar el PDF. Los datos ya fueron enviados arriba.');
      }
    } catch (error) {
      log(`Error procesando PDF: ${error.message}`, 'ERROR');
      await sendWhatsAppMessage(from, '❌ Error al procesar el PDF, pero la consulta fue exitosa.');
    }
  }
  
  // Resetear sesión
  session.state = STATES.WELCOME;
  session.data = {};
  
  setTimeout(async () => {
    const finalMessage = `🔄 *¿Qué deseas hacer ahora?*

*1* - 🔎 Nueva búsqueda
*2* - ℹ️ Información del sistema  
*3* - 📞 Contacto soporte

_Sistema KYC-LISTAS v1.0_`;
    
    await sendWhatsAppMessage(from, finalMessage);
  }, 3000);
}

// ENDPOINTS

// Webhook principal
app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body?.trim() || '';
  
  log(`Mensaje recibido de ${from}: ${body}`);
  
  const session = getUserSession(from);
  
  try {
    if (body.toLowerCase() === 'menu' || body.toLowerCase() === 'inicio') {
      session.state = STATES.WELCOME;
      session.data = {};
      await handleWelcome(from, '', session);
      res.status(200).send('OK');
      return;
    }
    
    switch (session.state) {
      case STATES.WELCOME:
        await handleWelcome(from, body, session);
        break;
      case STATES.WAITING_PERSON_TYPE:
        await handlePersonType(from, body, session);
        break;
      case STATES.WAITING_NAME:
        await handleName(from, body, session);
        break;
      case STATES.WAITING_APATERNO:
        await handleApaterno(from, body, session);
        break;
      case STATES.WAITING_AMATERNO:
        await handleAmaterno(from, body, session);
        break;
      default:
        session.state = STATES.WELCOME;
        await handleWelcome(from, body, session);
    }
  } catch (error) {
    log(`Error procesando mensaje de ${from}: ${error.message}`, 'ERROR');
    await sendWhatsAppMessage(from, 
      '❌ Ocurrió un error interno. Por favor intenta nuevamente o escribe *menu* para volver al inicio.');
  }
  
  res.status(200).send('OK');
});

// Servir archivos temporales
app.use('/temp', express.static(tempDir));

// Health check
app.get('/health', (req, res) => {
  const stats = {
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeSessions: userSessions.size,
    memory: process.memoryUsage()
  };
  
  res.json(stats);
});

// Estadísticas
app.get('/stats', (req, res) => {
  const stats = {
    activeSessions: userSessions.size,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
  
  res.json(stats);
});

// TAREAS DE MANTENIMIENTO

// Limpiar archivos temporales cada hora
setInterval(() => {
  try {
    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        log(`Archivo temporal eliminado: ${file}`);
      }
    });
  } catch (error) {
    log(`Error limpiando archivos temporales: ${error.message}`, 'ERROR');
  }
}, 60 * 60 * 1000);

// Limpiar sesiones inactivas cada 6 horas
setInterval(() => {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  
  for (const [key, session] of userSessions.entries()) {
    if (session.lastActivity < sixHoursAgo) {
      userSessions.delete(key);
      log(`Sesión inactiva eliminada: ${key}`);
    }
  }
}, 6 * 60 * 60 * 1000);

// Iniciar servidor
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  log(`🤖 Bot WhatsApp KYC-LISTAS iniciado en puerto ${PORT}`);
  log(`📂 Directorio temporal: ${tempDir}`);
  log(`📝 Directorio de logs: ${logsDir}`);
  console.log(`\n🚀 Servidor listo en http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Estadísticas: http://localhost:${PORT}/stats`);
});
```

---

## 🌐 PASO 4: Configurar Nginx

### 4.1 Configuración de Nginx

```bash
# Crear archivo de configuración
sudo nano /etc/nginx/sites-available/whatsapp-bot
```

Contenido del archivo:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;  # O tu IP pública
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /temp/ {
        alias /var/www/whatsapp-bot/temp/;
        expires 24h;
    }

    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
}
```

### 4.2 Habilitar Sitio

```bash
# Habilitar el sitio
sudo ln -s /etc/nginx/sites-available/whatsapp-bot /etc/nginx/sites-enabled/

# Probar configuración
sudo nginx -t

# Recargar Nginx
sudo systemctl reload nginx
```

---

## 🔧 PASO 5: Configurar PM2

### 5.1 Archivo de configuración PM2

```bash
# Crear ecosystem.config.js
nano /var/www/whatsapp-bot/ecosystem.config.js
```

```javascript
module.exports = {
  apps: [
    {
      name: 'whatsapp-kyc-bot',
      script: 'server.js',
      cwd: '/var/www/whatsapp-bot',
      instances: 1,
      exec_mode: 'fork',
      
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      
      log_file: '/var/www/whatsapp-bot/logs/pm2-combined.log',
      out_file: '/var/www/whatsapp-bot/logs/pm2-out.log',
      error_file: '/var/www/whatsapp-bot/logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      max_memory_restart: '500M',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'temp']
    }
  ]
};
```

### 5.2 Iniciar con PM2

```bash
cd /var/www/whatsapp-bot

# Iniciar aplicación
pm2 start ecosystem.config.js --env production

# Configurar para inicio automático
pm2 startup
pm2 save
```

---

## 🔒 PASO 6: Configurar Seguridad

### 6.1 Firewall

```bash
# Configurar UFW
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Verificar estado
sudo ufw status
```

### 6.2 SSL con Let's Encrypt (Opcional)

```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx

# Obtener certificado
sudo certbot --nginx -d tu-dominio.com

# Verificar renovación automática
sudo systemctl status certbot.timer
```

---

## 📝 PASO 7: Configurar Webhook en Twilio

1. Ve a tu Dashboard de Twilio
2. Ve a Messaging → Settings → WhatsApp Sandbox Settings
3. En "When a message comes in":
   - URL: `http://tu-ip-publica/webhook` o `https://tu-dominio.com/webhook`
   - Método: **POST**
4. Guardar cambios

---

## ✅ PASO 8: Verificación y Pruebas

### 8.1 Verificar Servicios

```bash
# Estado de servicios
sudo systemctl status nginx
pm2 status

# Ver logs
pm2 logs whatsapp-kyc-bot
sudo tail -f /var/log/nginx/access.log
tail -f /var/www/whatsapp-bot/logs/bot-$(date +%Y-%m-%d).log
```

### 8.2 Probar Endpoints

```bash
# Health check
curl http://localhost:3001/health
curl http://tu-ip-publica/health

# Estadísticas
curl http://localhost:3001/stats

# Probar API KYC (verificar que funcione)
curl -X POST http://localhost:3000/api/listas/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: KYC-062192Sj2NgK8aPyPHXYSxjKY" \
  -d '{
    "persona": "1",
    "nombre": "IVAN",
    "apaterno": "GUZMAN",
    "porcentaje_min": 85
  }'
```

### 8.3 Probar Bot

1. **Envía cualquier mensaje** al número de WhatsApp de Twilio
2. **Deberías recibir** el mensaje de bienvenida
3. **Prueba el flujo completo:**
   - Envía `1` → Búsqueda
   - Envía `1` → Persona física
   - Envía `IVAN ARCHIVALDO` → Nombre
   - Envía `GUZMAN` → Apellido paterno
   - Envía `SALAZAR` → Apellido materno
   - **Resultado:** Búsqueda + PDF si hay coincidencias

---

## 🔧 Comandos Útiles para Mantenimiento

### Monitoreo en Tiempo Real

```bash
# Ver logs del bot
pm2 logs whatsapp-kyc-bot --lines 50

# Ver logs de Nginx
sudo tail -f /var/log/nginx/access.log

# Ver uso de recursos
htop
pm2 monit
```

### Reinicio de Servicios

```bash
# Reiniciar bot
pm2 restart whatsapp-kyc-bot

# Recargar Nginx
sudo systemctl reload nginx

# Reiniciar Nginx
sudo systemctl restart nginx
```

### Limpieza Manual

```bash
# Limpiar archivos temporales
rm /var/www/whatsapp-bot/temp/*

# Limpiar logs antiguos
find /var/www/whatsapp-bot/logs -name "*.log" -mtime +7 -delete
```

---

## 🚨 Solución de Problemas Comunes

### Bot no responde
1. Verificar que PM2 esté ejecutándose: `pm2 status`
2. Revisar logs: `pm2 logs whatsapp-kyc-bot`
3. Verificar webhook URL en Twilio
4. Probar endpoint health: `curl http://localhost:3001/health`

### Error de conexión a API KYC
1. Verificar que tu API KYC esté ejecutándose
2. Probar API directamente con curl
3. Revisar variables de entorno (.env)

### Nginx 502 Bad Gateway
1. Verificar que la aplicación esté en puerto 3001: `netstat -tlnp | grep 3001`
2. Revisar logs de Nginx: `sudo tail -f /var/log/nginx/error.log`
3. Verificar configuración de Nginx: `sudo nginx -t`

### PDF no se genera
1. Verificar permisos del directorio temp: `ls -la /var/www/whatsapp-bot/temp/`
2. Revisar logs para errores de conversión base64
3. Verificar que SERVER_URL esté correctamente configurado

---

## 📊 Funcionalidades del Bot

### Comandos Disponibles
- **Cualquier mensaje** → Menú principal
- **1** → Búsqueda en listas
- **2** → Información del sistema
- **3** → Contacto soporte
- **menu** → Volver al menú (en cualquier momento)
- **skip** → Omitir apellidos en persona física

### Flujo de Búsqueda
1. **Selección de tipo:** Persona física o moral
2. **Captura de nombre:** Obligatorio
3. **Captura de apellidos:** Solo para persona física (opcional)
4. **Procesamiento:** Búsqueda en API KYC
5. **Resultado:** Mostrar coincidencias + envío de PDF
6. **Finalización:** Opciones para nueva búsqueda

### Características Técnicas
- ✅ **Sesiones por usuario:** Mantiene contexto de conversación
- ✅ **Timeouts:** Limpieza automática de sesiones inactivas
- ✅ **Logs completos:** Registro de todas las actividades
- ✅ **Health checks:** Monitoreo de estado del sistema
- ✅ **Manejo de errores:** Respuestas amigables ante fallos
- ✅ **Limpieza automática:** Eliminación de archivos temporales
- ✅ **Escalabilidad:** Preparado para múltiples usuarios concurrentes

---

¡Tu bot WhatsApp está listo para usar! 🎉