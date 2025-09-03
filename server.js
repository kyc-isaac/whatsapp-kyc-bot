require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Módulos de autorización
const { testConnection } = require("./database");
const authService = require("./authService");

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
  // Usar mensaje personalizado si hay información del usuario
  let welcomeMessage;
  
  if (session.user) {
    welcomeMessage = authService.getWelcomeMessage(session.user);
  } else {
    // Mensaje genérico (no debería llegar aquí si la autorización funciona)
    welcomeMessage = `¡Hola! 👋 *Bienvenido al Bot KYC-LISTAS*

🔍 *Sistema de Consulta de Listas Restrictivas*

Selecciona una opción:
*1* - 🔎 Búsqueda en listas
*2* - ℹ️ Información del sistema  
*3* - 📞 Contacto soporte

Escribe el número de la opción que deseas.`;
  }

  await sendWhatsAppMessage(from, welcomeMessage);

  const option = body.trim();

  if (option === "1") {
    session.state = STATES.WAITING_PERSON_TYPE;
    session.data = {};

    const personTypeMessage = `🔍 *Búsqueda en Listas Restrictivas*

Selecciona el tipo de persona:
*1* - 👤 Persona Física (Individual)
*2* - 🏢 Persona Moral (Empresa)

Escribe *1* o *2*:`;

    await sendWhatsAppMessage(from, personTypeMessage);
  } else if (option === "2") {
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
  } else if (option === "3") {
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

  if (option === "1" || option === "2") {
    session.data.persona = option;
    session.state = STATES.WAITING_NAME;

    const nameMessage =
      option === "1"
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
  } else if (body.toLowerCase() === "menu") {
    session.state = STATES.WELCOME;
    await handleWelcome(from, "", session);
  } else {
    await sendWhatsAppMessage(
      from,
      `❌ Opción inválida. Por favor escribe:

*1* - Para Persona Física
*2* - Para Persona Moral  
*menu* - Para volver al inicio`
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
      `❌ El nombre debe tener al menos 2 caracteres. 

Por favor intenta nuevamente:
Para cancelar, escribe *menu*.`
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
      `📝 Perfecto. Ahora escribe el *apellido paterno*:

*Ejemplo:* GARCIA

Si no tiene apellido paterno o deseas omitirlo, escribe *skip*.
Para cancelar, escribe *menu*.`
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
    `📝 Finalmente, escribe el *apellido materno*:

*Ejemplo:* LOPEZ

Si no tiene apellido materno o deseas omitirlo, escribe *skip*.
Para cancelar, escribe *menu*.`
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

async function processSearch(from, session) {
  session.state = STATES.PROCESSING;

  // Mostrar resumen de datos que se van a buscar
  let searchSummary = `🔍 *Iniciando búsqueda...*

*Datos a consultar:*
👤 Tipo: ${session.data.persona === "1" ? "Persona Física" : "Persona Moral"}
📝 Nombre: ${session.data.nombre}`;

  if (session.data.apaterno)
    searchSummary += `\n📝 Apellido Paterno: ${session.data.apaterno}`;
  if (session.data.amaterno)
    searchSummary += `\n📝 Apellido Materno: ${session.data.amaterno}`;

  searchSummary += `\n\n⏳ *Procesando...* 
Consultando listas OFAC, DEA, SAT, PEP, FBI...

Esto puede tomar unos segundos.`;

  await sendWhatsAppMessage(from, searchSummary);

  const searchData = {
    persona: session.data.persona,
    nombre: session.data.nombre,
    porcentaje_min: 85,
  };

  if (session.data.apaterno) searchData.apaterno = session.data.apaterno;
  if (session.data.amaterno) searchData.amaterno = session.data.amaterno;

  const result = await searchKYC(searchData);
  await handleSearchResult(from, session, result);
}

async function handleSearchResult(from, session, result) {
  if (result.err) {
    await sendWhatsAppMessage(
      from,
      `❌ *Error en la búsqueda:*

${result.message}

Para realizar una nueva búsqueda, escribe *1*.
Para volver al menú, escribe *menu*.`
    );

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
      responseMessage += `\n   📍 Estado: ${match.status || "Activo"}`;
      if (match.observaciones) {
        responseMessage += `\n   📝 ${match.observaciones}`;
      }
      responseMessage += `\n`;
    });

    if (result.coincidences > 3) {
      responseMessage += `\n... y ${
        result.coincidences - 3
      } coincidencias más.`;
    }
  } else {
    responseMessage += `\n✅ *SIN COINCIDENCIAS*

🎉 La persona consultada *NO aparece* en las listas restrictivas.

📋 *Listas consultadas:* OFAC, DEA, SAT, PEP, FBI, LPB`;
  }

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
          `📄 *Reporte PDF disponible:*

${pdfUrl}

*Contenido del reporte:*
• Datos consultados
• Resultados de búsqueda
• Detalles de coincidencias
• Fecha y hora de consulta

El archivo estará disponible por 24 horas.`,
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

  setTimeout(async () => {
    const finalMessage = `🔄 *¿Qué deseas hacer ahora?*

*1* - 🔎 Nueva búsqueda
*2* - ℹ️ Información del sistema  
*3* - 📞 Contacto soporte

_Sistema KYC-LISTAS v1.0_`;

    await sendWhatsAppMessage(from, finalMessage);
  }, 3000);
}

// Endpoint principal para webhook de WhatsApp
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
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
