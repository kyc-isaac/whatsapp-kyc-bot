// Menús Mejorados con Formato y Emojis para WhatsApp
// Opción A - Implementación inmediata sin necesidad de API especial

/**
 * Menú Principal Mejorado
 */
function getEnhancedMainMenu(userName, companyName) {
  return `🔐 *KYC SYSTEMS*
━━━━━━━━━━━━━━━━━━

¡Hola *${userName}*! 👋

Bienvenido al Sistema *KYC LISTAS*
🏢 _${companyName}_

¿Qué deseas hacer hoy?

1️⃣ 🔎 *Buscar en Listas*
      _Consulta múltiples listas oficiales_

2️⃣ 📋 *Búsquedas Recientes*
      _Últimas 10 consultas_

3️⃣ ℹ️ *Ayuda y Soporte*
      _Guías y contacto_

━━━━━━━━━━━━━━━━━━
_Responde con el número de tu elección_`;
}

/**
 * Menú de Tipo de Búsqueda
 */
function getSearchTypeMenu() {
  return `🔍 *Tipo de Búsqueda KYC*
━━━━━━━━━━━━━━━━━━

Selecciona el tipo de búsqueda:

*TIPO DE ENTIDAD*
1️⃣ 👤 *Persona Física*
      _Búsqueda por nombre completo_

2️⃣ 🏢 *Empresa / Razón Social*
      _Búsqueda por nombre comercial_

*BÚSQUEDAS ESPECIALES*
3️⃣ 📊 *Búsqueda Masiva*
      _Hasta 10 registros simultáneos_

4️⃣ ⚙️ *Búsqueda Avanzada*
      _Con parámetros específicos_

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver al menú principal`;
}

/**
 * Información de Listas Disponibles
 */
function getListsInfo() {
  return `📚 *Listas de Compliance Disponibles*
━━━━━━━━━━━━━━━━━━

Tu búsqueda incluirá automáticamente:

👔 *PEP's*
_Personas Expuestas Políticamente_
Funcionarios y familiares

🇲🇽 *SAT 69-B*
_Servicio de Administración Tributaria_
Operaciones inexistentes

🚫 *LPB*
_Lista de Personas Bloqueadas_
Lavado de dinero y terrorismo

🇺🇸 *OFAC*
_Office of Foreign Assets Control_
Sanciones económicas y comerciales

🌐 *ONU*
_Organización de las Naciones Unidas_
Lista de sanciones internacionales

🔍 *INTERPOL*
_Organización Internacional de Policía Criminal_
Base de datos internacional

🕵️ *FBI*
_Federal Bureau of Investigation_
Más buscados y criminales

_Y más listas de compliance..._

━━━━━━━━━━━━━━━━━━
✅ Búsqueda en *múltiples listas simultáneas*
⚡ Resultados en *segundos*`;
}

/**
 * Confirmación de Datos con Formato Visual
 */
function getConfirmationMessage(searchData) {
  const tipo = searchData.tipo === 'persona' ? '👤 Persona Física' : '🏢 Empresa';
  
  let datosStr = '';
  if (searchData.tipo === 'persona') {
    datosStr = `*Nombre:* ${searchData.nombre}
*Apellido Paterno:* ${searchData.apellidoPaterno}
*Apellido Materno:* ${searchData.apellidoMaterno || 'N/A'}`;
  } else {
    datosStr = `*Razón Social:* ${searchData.nombre}`;
  }

  const porcentaje = searchData.porcentaje_min || 98;
  const esRecomendado = porcentaje === 98 ? ' _(recomendado)_' : '';

  return `✅ *Confirmar Datos de Búsqueda*
━━━━━━━━━━━━━━━━━━

*Tipo:* ${tipo}

${datosStr}

*Configuración:*
• 📊 Porcentaje coincidencia: *${porcentaje}%*${esRecomendado}
• 📋 Listas a consultar: *Todas las disponibles*
• ⏱️ Tiempo estimado: *Pocos segundos*

━━━━━━━━━━━━━━━━━━
¿Los datos son correctos?

1️⃣ ✅ *Sí, buscar ahora*
2️⃣ ✏️ *Modificar datos*
3️⃣ ❌ *Cancelar búsqueda*`;
}

/**
 * Estado de Procesamiento Animado
 */
function getProcessingStatus(step = 1) {
  const steps = [
    {
      text: '🔄 *Procesando búsqueda...*\n\n⏳ Iniciando consulta en bases de datos...',
      details: `
⬜ PEP's - Pendiente
⬜ SAT 69-B - Pendiente
⬜ LPB - Pendiente
⬜ OFAC - Pendiente
⬜ ONU - Pendiente
⬜ INTERPOL - Pendiente
⬜ FBI - Pendiente`
    },
    {
      text: '🔄 *Procesando búsqueda...*\n\n⚡ Consultando listas nacionales...',
      details: `
✅ PEP's - Completado
✅ SAT 69-B - Completado
⏳ LPB - En proceso...
⬜ OFAC - Pendiente
⬜ ONU - Pendiente
⬜ INTERPOL - Pendiente
⬜ FBI - Pendiente`
    },
    {
      text: '🔄 *Procesando búsqueda...*\n\n🌐 Consultando listas internacionales...',
      details: `
✅ PEP's - Completado
✅ SAT 69-B - Completado
✅ LPB - Completado
✅ OFAC - Completado
⏳ ONU - En proceso...
⏳ INTERPOL - En proceso...
⬜ FBI - Pendiente`
    },
    {
      text: '🔄 *Finalizando búsqueda...*\n\n📄 Generando reporte...',
      details: `
✅ PEP's - Completado
✅ SAT 69-B - Completado
✅ LPB - Completado
✅ OFAC - Completado
✅ ONU - Completado
✅ INTERPOL - Completado
✅ FBI - Completado
_Y más listas..._`
    }
  ];

  const current = steps[Math.min(step - 1, steps.length - 1)];
  
  return `${current.text}
━━━━━━━━━━━━━━━━━━
*Estado de Listas:*${current.details}

━━━━━━━━━━━━━━━━━━
_Por favor espera, no envíes mensajes..._`;
}

/**
 * Resultados con Formato Visual
 */
function getResultsMessage(results) {
  const hasMatches = results.coincidences > 0;
  const statusEmoji = hasMatches ? '⚠️' : '✅';
  const statusText = hasMatches ? 'COINCIDENCIAS ENCONTRADAS' : 'SIN COINCIDENCIAS';
  
  let matchDetails = '';
  if (hasMatches) {
    matchDetails = `
*📊 Detalle de Coincidencias:*
${results.matches ? results.matches.map(m => 
  `• ${m.lista}: ${m.porcentaje}% coincidencia`
).join('\n') : '• Ver PDF para detalles completos'}`;
  }

  return `${statusEmoji} *Resultados de Búsqueda KYC*
━━━━━━━━━━━━━━━━━━

*Estado:* ${statusText}
*Coincidencias:* ${results.coincidences || 0}
*Listas consultadas:* Todas las disponibles
*Tiempo de búsqueda:* ${results.searchTime || '3.2'}s

${matchDetails}

*📄 Reporte Generado*
• Formato: PDF
• Páginas: ${results.pages || 1}
• Validez: 24 horas
• ID: ${results.reportId || 'KYC-' + Date.now()}

━━━━━━━━━━━━━━━━━━
¿Qué deseas hacer?

1️⃣ 📥 *Descargar PDF*
2️⃣ 📤 *Compartir Reporte*
3️⃣ 🔎 *Nueva Búsqueda*
4️⃣ 🏠 *Menú Principal*`;
}

/**
 * Menú de Ayuda Mejorado
 */
function getHelpMenu() {
  return `ℹ️ *Centro de Ayuda*
━━━━━━━━━━━━━━━━━━

*PREGUNTAS FRECUENTES*

1️⃣ 📋 *Sobre las Listas*
      _Qué incluye cada lista_

2️⃣ 🔍 *Cómo Buscar*
      _Guía paso a paso_

3️⃣ 📊 *Interpretar Resultados*
      _Entender porcentajes_

*SOPORTE TÉCNICO*

4️⃣ 💬 *Chat con Soporte*
      _Agente en línea_

5️⃣ 📧 *Enviar Email*
      _soporte@kyc-listas.com_

6️⃣ 📞 *Llamar*
      _+52 55 1234 5678_

*INFORMACIÓN*

7️⃣ 📖 *Manual de Usuario*
8️⃣ 🔐 *Política de Privacidad*
9️⃣ ℹ️ *Versión del Sistema*

━━━━━━━━━━━━━━━━━━
↩️ Escribe *0* para volver`;
}

/**
 * Mensaje de Error Amigable
 */
function getErrorMessage(errorType = 'generic') {
  const errorMessages = {
    'timeout': {
      emoji: '⏱️',
      title: 'Tiempo de Espera Agotado',
      message: 'La búsqueda tardó más de lo esperado.',
      suggestion: 'Por favor intenta nuevamente en unos momentos.'
    },
    'api_error': {
      emoji: '⚠️',
      title: 'Servicio Temporalmente No Disponible',
      message: 'Estamos experimentando problemas técnicos.',
      suggestion: 'Intenta de nuevo en 5 minutos.'
    },
    'invalid_input': {
      emoji: '❌',
      title: 'Datos Inválidos',
      message: 'Los datos ingresados no son válidos.',
      suggestion: 'Verifica la información e intenta nuevamente.'
    },
    'no_authorization': {
      emoji: '🔒',
      title: 'Acceso No Autorizado',
      message: 'No tienes permisos para esta acción.',
      suggestion: 'Contacta al administrador.'
    },
    'generic': {
      emoji: '😔',
      title: 'Algo Salió Mal',
      message: 'Ocurrió un error inesperado.',
      suggestion: 'Nuestro equipo ha sido notificado.'
    }
  };

  const error = errorMessages[errorType] || errorMessages.generic;

  return `${error.emoji} *${error.title}*
━━━━━━━━━━━━━━━━━━

${error.message}

💡 *Sugerencia:*
_${error.suggestion}_

━━━━━━━━━━━━━━━━━━
¿Qué deseas hacer?

1️⃣ 🔄 *Reintentar*
2️⃣ 🏠 *Menú Principal*
3️⃣ 💬 *Contactar Soporte*`;
}

/**
 * Mensaje de Bienvenida Inicial
 */
function getWelcomeMessage(userName, companyName, isFirstTime = false) {
  if (isFirstTime) {
    return `🎉 *¡Bienvenido al Sistema KYC!*
━━━━━━━━━━━━━━━━━━

Hola *${userName}* 👋

Es tu primera vez usando el sistema.
Te guiaré paso a paso.

*Tu empresa:* ${companyName}
*Acceso:* ✅ Autorizado
*Búsquedas disponibles:* Ilimitadas

━━━━━━━━━━━━━━━━━━
💡 *Tips Rápidos:*

• Responde con números (1️⃣, 2️⃣, 3️⃣)
• Escribe *menu* en cualquier momento
• Escribe *ayuda* si necesitas soporte
• Las sesiones duran 6 horas

━━━━━━━━━━━━━━━━━━
_Escribe *1* para continuar al menú principal_`;
  } else {
    return getEnhancedMainMenu(userName, companyName);
  }
}

/**
 * Notificación de Sesión Expirada
 */
function getSessionExpiredMessage() {
  return `⏰ *Sesión Expirada*
━━━━━━━━━━━━━━━━━━

Tu sesión ha expirado por inactividad.

*Duración máxima:* 6 horas
*Última actividad:* Hace más de 6 horas

Para continuar, escribe *"Hola"* o cualquier mensaje para iniciar una nueva sesión.

━━━━━━━━━━━━━━━━━━
💡 _Tip: Guarda tus reportes importantes antes de que expire la sesión._`;
}

/**
 * Búsquedas Recientes
 */
function getRecentSearches(searches) {
  if (!searches || searches.length === 0) {
    return `📋 *Búsquedas Recientes*
━━━━━━━━━━━━━━━━━━

No tienes búsquedas recientes.

━━━━━━━━━━━━━━━━━━
1️⃣ 🔎 *Nueva Búsqueda*
2️⃣ 🏠 *Menú Principal*`;
  }

  const searchList = searches.slice(0, 10).map((search, index) => {
    const icon = search.coincidences > 0 ? '⚠️' : '✅';
    const date = new Date(search.date).toLocaleDateString();
    return `${index + 1}. ${icon} *${search.name}*
   _${date} - ${search.coincidences} coincidencias_`;
  }).join('\n\n');

  return `📋 *Búsquedas Recientes*
━━━━━━━━━━━━━━━━━━
_Últimas 10 consultas_

${searchList}

━━━━━━━━━━━━━━━━━━
Selecciona un número para ver detalles
↩️ Escribe *0* para volver`;
}

/**
 * Estadísticas del Usuario
 */
function getUserStats(stats) {
  return `📊 *Tus Estadísticas*
━━━━━━━━━━━━━━━━━━

*Usuario:* ${stats.userName}
*Empresa:* ${stats.company}
*Miembro desde:* ${stats.memberSince}

*📈 Resumen de Actividad:*
• Total búsquedas: *${stats.totalSearches}*
• Este mes: *${stats.monthlySearches}*
• Hoy: *${stats.todaySearches}*

*🎯 Tipos de Búsqueda:*
• Personas: *${stats.personSearches}*
• Empresas: *${stats.companySearches}*

*⚠️ Coincidencias Encontradas:*
• Total: *${stats.totalMatches}*
• Promedio: *${stats.avgMatches}%*

━━━━━━━━━━━━━━━━━━
1️⃣ 📥 *Descargar Reporte*
2️⃣ 🏠 *Menú Principal*`;
}

module.exports = {
  getEnhancedMainMenu,
  getSearchTypeMenu,
  getListsInfo,
  getConfirmationMessage,
  getProcessingStatus,
  getResultsMessage,
  getHelpMenu,
  getErrorMessage,
  getWelcomeMessage,
  getSessionExpiredMessage,
  getRecentSearches,
  getUserStats
};