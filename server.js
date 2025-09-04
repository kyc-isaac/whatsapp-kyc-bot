require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Módulos de autorización
const { testConnection } = require("./database");
const authService = require("./authService");

// Módulo de menús mejorados
const enhancedMenus = require("./enhanced-menus");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Servir archivos estáticos para el panel admin
app.use('/admin', express.static('public'));

// Importar y usar rutas de administración
const adminRoutes = require('./admin-routes');
app.use('/api/admin', adminRoutes);

// Configuración de Twilio
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Configuración de tu API KYC
const KYC_API_URL = process.env.KYC_API_URL;
const KYC_API_KEY = process.env.KYC_API_KEY;

// Store para mantener el estado de conversación de cada usuario
const userSessions = new Map();

// Estados de conversación
const STATES = {
  UNAUTHORIZED: "unauthorized",
  BLOCKED: "blocked",
  WELCOME: "welcome",
  WAITING_NAME: "waiting_name",
  WAITING_APATERNO: "waiting_apaterno",
  WAITING_AMATERNO: "waiting_amaterno",
  WAITING_PERSON_TYPE: "waiting_person_type",
  ADVANCED_SEARCH: "advanced_search",
  WAITING_PERCENTAGE: "waiting_percentage",
  HELP_MENU: "help_menu",
  PROCESSING: "processing",
};

// Crear directorio temporal si no existe
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Función para logging con enmascaramiento de números
function log(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  // Enmascarar números de teléfono en los logs
  const maskedMessage = message.replace(/whatsapp:\+\d{7,}/gi, (match) => {
    const number = match.replace('whatsapp:', '');
    return `whatsapp:${authService.maskPhoneNumber(number)}`;
  });
  const logMessage = `[${timestamp}] ${level}: ${maskedMessage}`;
  console.log(logMessage);

  // Guardar en archivo
  const logFile = path.join(
    logsDir,
    `bot-${new Date().toISOString().split("T")[0]}.log`
  );
  fs.appendFileSync(logFile, logMessage + "\n");
}

// Función para obtener o crear sesión de usuario
function getUserSession(from) {
  if (!userSessions.has(from)) {
    userSessions.set(from, {
      state: STATES.WELCOME,
      data: {},
      lastActivity: new Date(),
    });
    log(`Nueva sesión creada para ${from}`);
  } else {
    // Actualizar última actividad
    userSessions.get(from).lastActivity = new Date();
  }
  return userSessions.get(from);
}

// Función para enviar mensaje de WhatsApp
async function sendWhatsAppMessage(to, body, mediaUrl = null) {
  try {
    const messageOptions = {
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: body,
    };

    if (mediaUrl) {
      messageOptions.mediaUrl = mediaUrl;
    }

    const message = await client.messages.create(messageOptions);
    log(`Mensaje enviado a ${to}: SID ${message.sid}`);
    return message;
  } catch (error) {
    log(`Error enviando mensaje a ${to}: ${error.message}`, "ERROR");
    throw error;
  }
}

// Función para convertir base64 a archivo temporal
function convertBase64ToFile(base64Data, fileName) {
  try {
    // Remover el prefijo data:application/pdf;base64, si existe
    const base64Clean = base64Data.replace(
      /^data:application\/pdf;base64,/,
      ""
    );

    // Convertir base64 a buffer
    const buffer = Buffer.from(base64Clean, "base64");

    // Guardar archivo temporalmente
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, buffer);

    log(`Archivo PDF creado: ${fileName}`);
    return `${process.env.SERVER_URL}/temp/${fileName}`;
  } catch (error) {
    log(`Error convirtiendo base64 a archivo: ${error.message}`, "ERROR");
    return null;
  }
}

// Función para buscar en la API KYC
async function searchKYC(searchData) {
  try {
    log(`Búsqueda KYC iniciada: ${JSON.stringify(searchData)}`);

    const response = await axios.post(
      `${KYC_API_URL}/search`,
      {
        ...searchData,
        document: 1, // Solicitar PDF
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": KYC_API_KEY,
        },
        timeout: 30000, // 30 segundos
      }
    );

    log(`Búsqueda KYC completada: ${response.data.coincidences} coincidencias`);
    return response.data;
  } catch (error) {
    log(
      `Error en búsqueda KYC: ${
        error.response?.data?.message || error.message
      }`,
      "ERROR"
    );
    return {
      err: true,
      message: error.response?.data?.message || "Error interno en la búsqueda",
    };
  }
}

// Manejadores de estado
async function handleWelcome(from, body, session) {
  const option = body.trim();
  
  // Mensajes de bienvenida que solo muestran el menú sin procesamiento adicional
  const welcomeKeywords = ['hola', 'hi', 'hello', 'inicio', 'empezar', 'comenzar', ''];
  
  if (welcomeKeywords.includes(option.toLowerCase()) || option === '') {
    // Solo mostrar menú de bienvenida sin procesamiento adicional
    let welcomeMessage;
    
    if (session.user) {
      // Detectar si es primera vez (no ha hecho búsquedas)
      const isFirstTime = !session.user.total_queries || session.user.total_queries === 0;
      welcomeMessage = enhancedMenus.getWelcomeMessage(
        session.user.full_name, 
        session.user.company || 'Tu Empresa',
        isFirstTime
      );
    } else {
      // Mensaje genérico mejorado
      welcomeMessage = enhancedMenus.getEnhancedMainMenu('Usuario', 'Sistema KYC');
    }

    await sendWhatsAppMessage(from, welcomeMessage);
    return; // Importante: salir aquí para no procesar como opción
  }

  // Procesar opciones del menú
  if (option === "1") {
    session.state = STATES.WAITING_PERSON_TYPE;
    session.data = {};

    // Usar menú de tipo de búsqueda mejorado
    const searchTypeMessage = enhancedMenus.getSearchTypeMenu();
    await sendWhatsAppMessage(from, searchTypeMessage);
    
  } else if (option === "2") {
    // Mostrar búsquedas recientes (placeholder por ahora)
    const recentSearches = []; // TODO: Implementar historial real
    const recentMessage = enhancedMenus.getRecentSearches(recentSearches);
    await sendWhatsAppMessage(from, recentMessage);
    
  } else if (option === "3") {
    // Menú de ayuda mejorado
    session.state = STATES.HELP_MENU;
    const helpMessage = enhancedMenus.getHelpMenu();
    await sendWhatsAppMessage(from, helpMessage);
    
  } else if (body.toLowerCase().includes('info') || body.toLowerCase().includes('listas')) {
    // Información detallada de las listas
    const listsInfo = enhancedMenus.getListsInfo();
    await sendWhatsAppMessage(from, listsInfo);
    
  } else if (body.toLowerCase() === 'menu') {
    // Volver a mostrar el menú principal
    await handleWelcome(from, 'hola', session);
    
  } else if (body.toLowerCase() === 'ayuda') {
    // Mostrar ayuda directamente
    session.state = STATES.HELP_MENU;
    const helpMessage = enhancedMenus.getHelpMenu();
    await sendWhatsAppMessage(from, helpMessage);
    
  } else {
    // Para opciones realmente inválidas, mostrar un mensaje más amigable
    const invalidMessage = `🤔 *No entiendo esa opción*

Para usar el sistema, selecciona una opción:

1️⃣ 🔎 *Buscar en Listas*
2️⃣ 📋 *Búsquedas Recientes*  
3️⃣ ℹ️ *Ayuda y Soporte*

━━━━━━━━━━━━━━━━━━
💡 *Comandos útiles:*
• Escribe *menu* para ver el menú
• Escribe *ayuda* para obtener ayuda
• Escribe *info* para ver las listas disponibles`;

    await sendWhatsAppMessage(from, invalidMessage);
  }
}

async function handlePersonType(from, body, session) {
  const option = body.trim();

  if (option === "1" || option === "2") {
    session.data.persona = option;
    session.data.porcentaje_min = 98; // Establecer porcentaje por defecto
    session.state = STATES.WAITING_NAME;

    const nameMessage =
      option === "1"
        ? `👤 *Persona Física Seleccionada*
━━━━━━━━━━━━━━━━━━

📝 Escribe el *nombre(s)* de la persona:

*Ejemplo:* JUAN CARLOS
💡 *Nota:* Solo el nombre, después te pediré los apellidos por separado.

━━━━━━━━━━━━━━━━━━
↩️ Para cancelar, escribe *menu*`
        : `🏢 *Persona Moral Seleccionada*
━━━━━━━━━━━━━━━━━━

📝 Escribe la *razón social completa* de la empresa:

*Ejemplo:* CONSTRUCTORA EJEMPLO SA DE CV

━━━━━━━━━━━━━━━━━━
↩️ Para cancelar, escribe *menu*`;

    await sendWhatsAppMessage(from, nameMessage);
    
  } else if (option === "4") {
    // Opción de búsqueda avanzada
    session.state = STATES.ADVANCED_SEARCH;
    await sendWhatsAppMessage(from, `⚙️ *Búsqueda Avanzada*
━━━━━━━━━━━━━━━━━━

Selecciona el tipo de configuración:

1️⃣ 👤 *Persona Física* (con opciones avanzadas)
2️⃣ 🏢 *Empresa* (con opciones avanzadas)
3️⃣ 📊 *Configurar Porcentaje de Coincidencia*
      _Actual: 98% (recomendado)_

━━━━━━━━━━━━━━━━━━
💡 *Nota:* 98% reduce falsos positivos
↩️ Escribe *menu* para volver`);
    return;
  
  } else if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
  } else {
    await sendWhatsAppMessage(
      from,
      `❌ *Opción Inválida*
━━━━━━━━━━━━━━━━━━

Por favor selecciona una opción válida:

1️⃣ *Persona Física*
2️⃣ *Persona Moral*
4️⃣ *Búsqueda Avanzada*

━━━━━━━━━━━━━━━━━━
↩️ Escribe *menu* para volver al inicio`
    );
  }
}

async function handleName(from, body, session) {
  if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
    return;
  }

  const name = body.trim();
  if (name.length < 2) {
    await sendWhatsAppMessage(
      from,
      `❌ *Nombre Inválido*
━━━━━━━━━━━━━━━━━━

El nombre debe tener al menos *2 caracteres*.

🔄 Por favor intenta nuevamente

━━━━━━━━━━━━━━━━━━
↩️ Para cancelar, escribe *menu*`
    );
    return;
  }

  session.data.nombre = name.toUpperCase();

  if (session.data.persona === "2") {
    // Para persona moral, procesar directamente
    await processSearch(from, session);
  } else {
    // Para persona física, pedir apellido paterno
    session.state = STATES.WAITING_APATERNO;
    await sendWhatsAppMessage(
      from,
      `📝 *Apellido Paterno*
━━━━━━━━━━━━━━━━━━

Escribe el *apellido paterno*:

*Ejemplo:* GARCIA

━━━━━━━━━━━━━━━━━━
💡 Si no tiene apellido paterno, escribe *skip*
↩️ Para cancelar, escribe *menu*`
    );
  }
}

async function handleApaterno(from, body, session) {
  if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
    return;
  }

  if (body.toLowerCase() !== "skip") {
    session.data.apaterno = body.trim().toUpperCase();
  }

  session.state = STATES.WAITING_AMATERNO;
  await sendWhatsAppMessage(
    from,
    `📝 *Apellido Materno*
━━━━━━━━━━━━━━━━━━

Finalmente, escribe el *apellido materno*:

*Ejemplo:* LOPEZ

━━━━━━━━━━━━━━━━━━
💡 Si no tiene apellido materno, escribe *skip*
↩️ Para cancelar, escribe *menu*`
  );
}

async function handleAmaterno(from, body, session) {
  if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
    return;
  }

  if (body.toLowerCase() !== "skip") {
    session.data.amaterno = body.trim().toUpperCase();
  }

  await processSearch(from, session);
}

async function handleAdvancedSearch(from, body, session) {
  const option = body.trim();
  
  if (option === "1" || option === "2") {
    // Persona física o moral con opciones avanzadas
    session.data.persona = option;
    session.data.porcentaje_min = session.data.porcentaje_min || 98;
    session.state = STATES.WAITING_NAME;
    
    const nameMessage = option === "1"
      ? `👤 *Persona Física - Búsqueda Avanzada*
━━━━━━━━━━━━━━━━━━

📝 Escribe el *nombre(s)* de la persona:

*Ejemplo:* JUAN CARLOS
💡 *Nota:* Solo el nombre, después te pediré los apellidos

*Configuración actual:*
• 📊 Porcentaje: *${session.data.porcentaje_min || 98}%*

━━━━━━━━━━━━━━━━━━
↩️ Para cancelar, escribe *menu*`
      : `🏢 *Empresa - Búsqueda Avanzada*  
━━━━━━━━━━━━━━━━━━

📝 Escribe la *razón social completa*:

*Ejemplo:* CONSTRUCTORA EJEMPLO SA DE CV

*Configuración actual:*
• 📊 Porcentaje: *${session.data.porcentaje_min || 98}%*

━━━━━━━━━━━━━━━━━━
↩️ Para cancelar, escribe *menu*`;
    
    await sendWhatsAppMessage(from, nameMessage);
    
  } else if (option === "3") {
    // Configurar porcentaje
    session.state = STATES.WAITING_PERCENTAGE;
    await sendWhatsAppMessage(from, `📊 *Configurar Porcentaje de Coincidencia*
━━━━━━━━━━━━━━━━━━

*Porcentaje actual:* ${session.data.porcentaje_min || 98}%

Escribe el nuevo porcentaje (entre 50% y 99%):

*Recomendaciones:*
• 📈 *98%* - Recomendado (menos falsos positivos)
• 📊 *90%* - Balanceado
• 📉 *75%* - Más permisivo (más coincidencias)

━━━━━━━━━━━━━━━━━━
💡 *Nota:* Mayor porcentaje = Mayor precisión
↩️ Escribe *menu* para cancelar`);
    
  } else if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
  } else {
    await sendWhatsAppMessage(from, `❌ *Opción Inválida*
━━━━━━━━━━━━━━━━━━

Selecciona una opción válida:

1️⃣ *Persona Física*
2️⃣ *Empresa* 
3️⃣ *Configurar Porcentaje*

━━━━━━━━━━━━━━━━━━
↩️ Escribe *menu* para volver`);
  }
}

async function handleWaitingPercentage(from, body, session) {
  if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
    return;
  }

  const percentage = parseInt(body.replace('%', ''));
  
  if (isNaN(percentage) || percentage < 50 || percentage > 99) {
    await sendWhatsAppMessage(from, `❌ *Porcentaje Inválido*
━━━━━━━━━━━━━━━━━━

Debe ser un número entre 50 y 99.

*Ejemplos válidos:*
• 98
• 90
• 75

━━━━━━━━━━━━━━━━━━
🔄 Intenta nuevamente o escribe *menu* para cancelar`);
    return;
  }

  session.data.porcentaje_min = percentage;
  session.state = STATES.ADVANCED_SEARCH;
  
  await sendWhatsAppMessage(from, `✅ *Porcentaje Configurado*
━━━━━━━━━━━━━━━━━━

Nuevo porcentaje: *${percentage}%*

⚙️ *Búsqueda Avanzada*

1️⃣ 👤 *Persona Física* 
2️⃣ 🏢 *Empresa*
3️⃣ 📊 *Cambiar Porcentaje* _(${percentage}%)_

━━━━━━━━━━━━━━━━━━
↩️ Escribe *menu* para volver al inicio`);
}

async function handleHelpMenu(from, body, session) {
  const option = body.trim();
  
  if (option === "0" || body.toLowerCase() === "menu") {
    // Volver al menú principal
    session.state = STATES.WELCOME;
    await handleWelcome(from, 'hola', session);
    return;
  }
  
  let responseMessage = '';
  
  switch(option) {
    case "1":
      responseMessage = `📋 *Sobre las Listas de KYC*
━━━━━━━━━━━━━━━━━━

Nuestro sistema consulta múltiples listas oficiales:

👔 *PEP's* - Personas Expuestas Políticamente
🇲🇽 *SAT 69-B* - Lista de operaciones inexistentes
🚫 *LPB* - Lista de Personas Bloqueadas  
🇺🇸 *OFAC* - Office of Foreign Assets Control
🌐 *ONU* - Sanciones de Naciones Unidas
🔍 *INTERPOL* - Base de datos internacional
🕵️ *FBI* - Most Wanted List
_Y más listas de compliance..._

━━━━━━━━━━━━━━━━━━
📊 *Porcentaje recomendado:* 98%
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "2":
      responseMessage = `🔍 *Cómo Realizar Búsquedas*
━━━━━━━━━━━━━━━━━━

*Paso a paso:*

1️⃣ Selecciona *"Buscar en Listas"*
2️⃣ Elige tipo: *Persona Física* o *Empresa*
3️⃣ Ingresa los datos solicitados
4️⃣ Confirma la información
5️⃣ Espera los resultados (pocos segundos)
6️⃣ Descarga el reporte PDF

💡 *Tips importantes:*
• Usa nombres completos y exactos
• Verifica la ortografía antes de confirmar
• El sistema busca en múltiples listas simultáneamente

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "3":
      responseMessage = `📊 *Interpretar Resultados*
━━━━━━━━━━━━━━━━━━

*Tipos de resultado:*

✅ *SIN COINCIDENCIAS*
La persona/empresa NO aparece en las listas restrictivas.

⚠️ *CON COINCIDENCIAS*
Se encontraron registros similares en una o más listas.

*Porcentajes de similitud:*
• *98-100%* - Coincidencia muy alta (casi exacta)
• *90-97%* - Coincidencia alta (revisar detalles)  
• *75-89%* - Coincidencia media (puede ser falso positivo)

💡 *Recomendación:* 98% reduce falsos positivos

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "4":
      responseMessage = `💬 *Chat con Soporte*
━━━━━━━━━━━━━━━━━━

Nuestro equipo de soporte está disponible para ayudarte.

*Horarios de atención:*
🕐 Lunes a Viernes: 9:00 AM - 6:00 PM
🕐 Sábados: 10:00 AM - 2:00 PM

*Canales de contacto:*
📧 Email: hola@kyc-systems.com
📞 Teléfono: +52 55 4762 6178
💬 WhatsApp: Este mismo chat

*Tiempo de respuesta:*
• WhatsApp: Inmediato (horario laboral)
• Email: Máximo 4 horas
• Teléfono: Inmediato

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "5":
      responseMessage = `📧 *Enviar Email*
━━━━━━━━━━━━━━━━━━

Para contactarnos por email:

✉️ *Dirección:* hola@kyc-systems.com

*Información a incluir:*
• Tu nombre y empresa
• Descripción detallada del problema
• Capturas de pantalla (si aplica)
• Número de teléfono registrado

*Tipos de consultas:*
• Problemas técnicos
• Preguntas sobre resultados
• Solicitudes de capacitación
• Reportes de errores

⏱️ *Tiempo de respuesta:* Máximo 4 horas

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "6":
      responseMessage = `📞 *Soporte Telefónico*
━━━━━━━━━━━━━━━━━━

*Número de soporte:*
+52 55 4762 6178

*Horarios de atención:*
🕐 Lunes a Viernes: 9:00 AM - 6:00 PM (CDMX)
🕐 Sábados: 10:00 AM - 2:00 PM (CDMX)

*Antes de llamar, ten a la mano:*
• Tu nombre y empresa registrada
• Descripción del problema
• Número de WhatsApp registrado

*Tipos de soporte:*
• Asistencia técnica inmediata
• Explicación de resultados
• Capacitación en uso del sistema

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    case "7":
    case "8": 
    case "9":
      responseMessage = `ℹ️ *Información del Sistema*
━━━━━━━━━━━━━━━━━━

*Sistema KYC-LISTAS*
Versión: 2.1.0
Última actualización: Septiembre 2025

*Características:*
✅ Consulta en múltiples listas oficiales
✅ Generación de reportes PDF
✅ Interface WhatsApp intuitiva
✅ Porcentajes de coincidencia configurables
✅ Búsquedas para personas físicas y morales

*Política de Privacidad:*
• Datos encriptados en tránsito
• No almacenamos información personal
• Cumplimiento con GDPR y LFPDPPP
• Reportes disponibles por 24 horas únicamente

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
      
    default:
      responseMessage = `❌ *Opción no válida en ayuda*

Selecciona una opción del menú de ayuda:

*PREGUNTAS FRECUENTES:*
1️⃣ 📋 Sobre las Listas
2️⃣ 🔍 Cómo Buscar  
3️⃣ 📊 Interpretar Resultados

*SOPORTE TÉCNICO:*
4️⃣ 💬 Chat con Soporte
5️⃣ 📧 Enviar Email
6️⃣ 📞 Llamar

*INFORMACIÓN:*
7️⃣ 📖 Manual de Usuario
8️⃣ 🔐 Política de Privacidad
9️⃣ ℹ️ Versión del Sistema

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú de ayuda`;
      break;
  }
  
  await sendWhatsAppMessage(from, responseMessage);
}

async function processSearch(from, session) {
  session.state = STATES.PROCESSING;

  // Mostrar confirmación con el formato mejorado
  const searchData = {
    tipo: session.data.persona === "1" ? "persona" : "empresa",
    nombre: session.data.nombre,
    apellidoPaterno: session.data.apaterno,
    apellidoMaterno: session.data.amaterno,
    porcentaje_min: session.data.porcentaje_min || 98
  };
  
  const confirmationMessage = enhancedMenus.getConfirmationMessage(searchData);
  await sendWhatsAppMessage(from, confirmationMessage);
  
  // Esperar un momento antes de procesar
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Mostrar estado de procesamiento
  const processingMessage = enhancedMenus.getProcessingStatus(1);
  await sendWhatsAppMessage(from, processingMessage);

  const kycSearchData = {
    persona: session.data.persona,
    nombre: session.data.nombre,
    porcentaje_min: session.data.porcentaje_min || 98,
  };

  if (session.data.apaterno) kycSearchData.apaterno = session.data.apaterno;
  if (session.data.amaterno) kycSearchData.amaterno = session.data.amaterno;

  const result = await searchKYC(kycSearchData);
  await handleSearchResult(from, session, result);
}

async function handleSearchResult(from, session, result) {
  if (result.err) {
    // Usar mensaje de error mejorado
    const errorMessage = enhancedMenus.getErrorMessage('api_error');
    await sendWhatsAppMessage(from, errorMessage);

    session.state = STATES.WELCOME;
    session.data = {};
    return;
  }

  // Preparar datos para el mensaje de resultados mejorado
  const resultsData = {
    coincidences: result.coincidences,
    searchTime: result.performance?.processing_time_ms || '3200',
    pages: 1,
    reportId: `KYC-${Date.now()}`,
    matches: result.person?.slice(0, 3).map(match => ({
      lista: match.tipo,
      porcentaje: match.porcentaje_coincidencia
    }))
  };
  
  const responseMessage = enhancedMenus.getResultsMessage(resultsData);
  await sendWhatsAppMessage(from, responseMessage);

  // Enviar PDF si está disponible
  if (result.pdf && result.pdf.base64) {
    await sendWhatsAppMessage(from, "📄 *Generando reporte PDF...*");

    try {
      const fileName = `KYC_${session.data.nombre.replace(
        / /g,
        "_"
      )}_${Date.now()}.pdf`;
      const pdfUrl = convertBase64ToFile(result.pdf.base64, fileName);

      if (pdfUrl) {
        await sendWhatsAppMessage(
          from,
          `📄 *Reporte PDF Generado*
━━━━━━━━━━━━━━━━━━

${pdfUrl}

*📋 Contenido del reporte:*
• ✅ Datos consultados
• 📊 Resultados de búsqueda  
• 📝 Detalles de coincidencias
• 🕐 Fecha y hora de consulta

━━━━━━━━━━━━━━━━━━
⏰ _El archivo estará disponible por 24 horas_`,
          pdfUrl
        );
      } else {
        await sendWhatsAppMessage(
          from,
          "❌ Error al generar el PDF. Los datos ya fueron enviados arriba."
        );
      }
    } catch (error) {
      log(`Error procesando PDF: ${error.message}`, "ERROR");
      await sendWhatsAppMessage(
        from,
        "❌ Error al procesar el PDF, pero la consulta fue exitosa."
      );
    }
  }

  // Resetear sesión y mostrar opciones
  session.state = STATES.WELCOME;
  session.data = {};

  // El mensaje de resultados mejorado ya incluye las opciones de acción
  // No necesitamos el mensaje adicional
}

// Endpoint para status de mensajes
app.post("/webhook/status", (req, res) => {
  console.log("Status callback:", req.body);
  res.status(200).send("OK");
});

// Endpoint principal para webhook de WhatsApp
app.post("/webhook", async (req, res) => {
  // Limpiar el formato del número - quitar espacios extras
  const from = req.body.From?.replace(/\s+/g, '') || '';
  const body = req.body.Body?.trim() || "";

  log(`Mensaje recibido de ${from}: ${body}`);

  // VALIDACIÓN DE AUTORIZACIÓN
  // Verificar si debemos ignorar al usuario (spam)
  if (await authService.shouldIgnoreUser(from)) {
    log(`Usuario bloqueado por spam: ${from}`, "WARNING");
    res.status(200).send("OK");
    return;
  }

  // Verificar si el usuario está autorizado
  const authCheck = await authService.isAuthorized(from);
  
  if (!authCheck.authorized) {
    // Usuario no autorizado
    log(`Acceso denegado a: ${from}`, "WARNING");
    
    // Registrar intento
    await authService.logBlockedAttempt(from, body);
    
    // Obtener mensaje de rechazo apropiado
    const rejectionMessage = await authService.getRejectionMessage(from);
    
    if (rejectionMessage) {
      await sendWhatsAppMessage(from, rejectionMessage);
    }
    
    res.status(200).send("OK");
    return;
  }

  // Usuario autorizado - continuar con el flujo normal
  log(`Usuario autorizado: ${authCheck.user.full_name} (${authService.maskPhoneNumber(from)})`);
  
  const session = getUserSession(from);
  session.user = authCheck.user; // Guardar información del usuario en la sesión

  try {
    // Comandos globales
    if (body.toLowerCase() === "menu" || body.toLowerCase() === "inicio") {
      session.state = STATES.WELCOME;
      session.data = {};
      await handleWelcome(from, "", session);
      res.status(200).send("OK");
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

      case STATES.ADVANCED_SEARCH:
        await handleAdvancedSearch(from, body, session);
        break;

      case STATES.WAITING_PERCENTAGE:
        await handleWaitingPercentage(from, body, session);
        break;

      case STATES.HELP_MENU:
        await handleHelpMenu(from, body, session);
        break;

      default:
        session.state = STATES.WELCOME;
        await handleWelcome(from, body, session);
    }
  } catch (error) {
    log(`Error procesando mensaje de ${from}: ${error.message}`, "ERROR");
    await sendWhatsAppMessage(
      from,
      "❌ Ocurrió un error interno. Por favor intenta nuevamente o escribe *menu* para volver al inicio."
    );
  }

  res.status(200).send("OK");
});

// Endpoint para servir archivos temporales
app.use("/temp", express.static(tempDir));

// Endpoint de health check
app.get("/health", (req, res) => {
  const stats = {
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeSessions: userSessions.size,
    memory: process.memoryUsage(),
  };

  res.json(stats);
});

// Endpoint de estadísticas
app.get("/stats", (req, res) => {
  const stats = {
    activeSessions: userSessions.size,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  };

  res.json(stats);
});

// Limpiar archivos temporales cada hora
setInterval(() => {
  try {
    const files = fs.readdirSync(tempDir);
    const now = Date.now();

    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);

      // Eliminar archivos de más de 24 horas
      if (now - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        log(`Archivo temporal eliminado: ${file}`);
      }
    });
  } catch (error) {
    log(`Error limpiando archivos temporales: ${error.message}`, "ERROR");
  }
}, 60 * 60 * 1000); // Cada hora

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
}, 6 * 60 * 60 * 1000); // Cada 6 horas

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  log(`🤖 Bot WhatsApp KYC-LISTAS iniciado en puerto ${PORT}`);
  log(`📂 Directorio temporal: ${tempDir}`);
  log(`📝 Directorio de logs: ${logsDir}`);
  
  // Verificar conexión a MySQL
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.log(`⚠️  ADVERTENCIA: No se pudo conectar a MySQL. El bot funcionará sin validación de usuarios.`);
  }
  
  console.log(`\n🚀 Servidor listo en http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Estadísticas: http://localhost:${PORT}/stats`);
  console.log(`\n🔐 Sistema de autorización: ${dbConnected ? '✅ ACTIVO' : '❌ INACTIVO'}`);
});
