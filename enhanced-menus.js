const { version } = require('./package.json');
const SUPPORT = '📧 hola@kyc-systems.com\n📞 +52 55 4762 6178';
const NAV = '\n\n*menu* · Inicio    *ayuda* · Ayuda';

function getEnhancedMainMenu(userName, companyName) {
  return `🔎 *KYC SYSTEMS*\n\nHola, *${userName || 'Usuario'}*.${companyName ? `\n${companyName}` : ''}\n\n1️⃣ Buscar en listas\n2️⃣ Consultas recientes\n3️⃣ Ayuda y contacto\n4️⃣ Mi cuenta y porcentaje\n\nResponde con el número de una opción.${NAV}`;
}
function getSearchTypeMenu(hasIneOcrPermission = false, percentage = 98) {
  return `🔍 *Nueva consulta*\n\n1️⃣ Persona · nombre y apellidos por separado\n2️⃣ Persona · nombre completo\n3️⃣ Empresa · razón social${hasIneOcrPermission ? '\n4️⃣ Persona · leer una INE' : ''}\n\nSimilitud mínima: *${percentage}%*\nPara cambiarla, escribe *P85*, por ejemplo (70–100).\n\n*0* · Volver al inicio${NAV}`;
}
function getListsInfo() {
  return '📋 *Listas consultadas*\n\nLa consulta se envía al servicio KYC LISTAS. La cobertura depende de las fuentes disponibles en ese servicio.\n\nRevisa en el resultado y en el PDF la fuente de cada coincidencia. Una coincidencia por nombre necesita revisión para determinar si corresponde a la persona consultada.';
}
function getConfirmationMessage(data) {
  const name = [data.nombre, data.apaterno, data.amaterno].filter(Boolean).join(' ');
  return `📝 *Revisa tu consulta*\n\n*Tipo:* ${data.kind === 'company' ? 'Empresa' : 'Persona física'}\n*${data.kind === 'company' ? 'Razón social' : 'Nombre'}:* ${name}\n*Similitud mínima:* ${data.porcentaje_min}%\n\n1️⃣ Confirmar y buscar\n2️⃣ Corregir datos\n3️⃣ Cancelar\n\nLa búsqueda comienza cuando confirmes.${NAV}`;
}
function getProcessingStatus() {
  return '🔎 *Consultando KYC LISTAS…*\n\nTe enviaré el resultado al terminar. La consulta puede tardar unos segundos.';
}
function getResultsMessage(result) {
  const details = (result.matches || []).map(m => `• ${m.lista || 'Fuente sin especificar'}${m.porcentaje != null ? ` · ${m.porcentaje}%` : ''}`).join('\n');
  return `${result.coincidences > 0 ? '⚠️' : '✅'} *Resultado de consulta*\n\n*Nombre:* ${result.name}\n*Coincidencias:* ${result.coincidences}\n*Similitud mínima:* ${result.percentage}%${Number.isFinite(result.elapsedMs) ? `\n*Tiempo:* ${(result.elapsedMs / 1000).toFixed(1)} s` : ''}\n${details ? `\n${details}\n` : ''}\n${result.coincidences > 0 ? 'Revisa las coincidencias y sus fuentes antes de tomar una decisión.' : 'No se encontraron coincidencias con los datos y el porcentaje utilizados. Esto no constituye una certificación.'}\n\n${result.pdfUrl ? '📄 PDF disponible mediante el enlace durante 24 horas.' : '📄 No hay PDF disponible para esta consulta.'}\n\n1️⃣ Obtener PDF\n2️⃣ Cómo compartir el reporte\n3️⃣ Nueva consulta\n4️⃣ Menú principal`;
}
function getHelpMenu() {
  return 'ℹ️ *Ayuda y contacto*\n\n1️⃣ Listas y cobertura\n2️⃣ Cómo hacer una consulta\n3️⃣ Cómo interpretar el resultado\n4️⃣ Contactar a soporte\n5️⃣ Reportar un problema por correo\n6️⃣ Teléfono de contacto\n7️⃣ Guía de comandos\n8️⃣ Uso de datos y reportes\n9️⃣ Acerca del bot\n\n*0* · Menú principal';
}
function getHelpDetail(option) {
  const details = {
    '1': getListsInfo(),
    '2': '🔍 *Cómo consultar*\n\n1. Escribe *buscar*.\n2. Elige persona o empresa.\n3. Captura los datos o envía ambas caras de una INE si tienes permiso.\n4. Revisa el nombre y el porcentaje.\n5. Responde *1* para confirmar.\n6. Revisa el resultado y descarga el PDF si está disponible.',
    '3': '📊 *Interpretar resultados*\n\nEl porcentaje mide similitud del nombre, no probabilidad de riesgo ni certeza de identidad. Un umbral menor puede mostrar más registros. Revisa nombres, fuentes y otros identificadores. Cero coincidencias solo describe esta consulta y su cobertura.',
    '4': `💬 *Contacto con soporte*\n\n${SUPPORT}\n\nEste bot muestra los datos de contacto; no transfiere la conversación a un agente.`,
    '5': '📧 *Reportar un problema*\n\nEscribe a hola@kyc-systems.com con la hora aproximada, la opción utilizada y una descripción del problema. No incluyas contraseñas ni credenciales de acceso.',
    '6': '📞 *Contacto telefónico*\n\n+52 55 4762 6178',
    '7': '⌨️ *Comandos*\n\n*menu* o *inicio*: volver al inicio.\n*buscar*: iniciar una consulta.\n*ayuda*: abrir la ayuda.\n*atras* o *0*: volver al paso anterior.\n*cancelar*: descartar la captura.\n*P85*: cambiar la similitud mínima (70–100).\n*omitir* o *skip*: dejar vacío un apellido.\n\nDurante una consulta en curso espera el resultado antes de cambiar de opción.',
    '8': '🔐 *Datos y reportes*\n\nLos datos de consulta se envían a los proveedores KYC y los mensajes pasan por WhatsApp/Twilio. Las fotos de INE se usan para leer el nombre y se liberan de la sesión al terminar esa lectura.\n\nEl historial y las sesiones se guardan cifrados en el servidor; puedes recuperar tus últimas 10 consultas aunque el bot se reinicie. El administrador establece el plazo de conservación. Los PDF se almacenan cifrados y sus enlaces vencen a las 24 horas o al revocarlos. Quien tenga un enlace vigente puede descargar el archivo.\n\nPara conocer las políticas de los proveedores, contacta al administrador.',
    '9': `ℹ️ *KYC SYSTEMS · Bot ${version}*\n\nConsultas por nombre, empresas, lectura de INE según permisos y reportes PDF cuando el servicio los incluye.`
  };
  return details[option] ? `${details[option]}\n\n*0* · Volver a ayuda${NAV}` : null;
}
function getErrorMessage() {
  return `⚠️ *No se pudo completar la consulta*\n\n1️⃣ Reintentar con los mismos datos\n2️⃣ Menú principal\n3️⃣ Contactar a soporte${NAV}`;
}
function getWelcomeMessage(userName, companyName) {
  return getEnhancedMainMenu(userName, companyName);
}
function getSessionExpiredMessage() {
  return '⏰ La sesión anterior venció después de 6 horas de inactividad. Inicia una nueva consulta desde el menú.';
}
function getRecentSearches(searches = []) {
  const list = searches.map((s, i) => `${i + 1}. *${s.name.length > 64 ? s.name.slice(0, 61) + '…' : s.name}*\n   ${new Date(s.date).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} · ${s.coincidences} coincidencias`).join('\n\n');
  return `📋 *Consultas recientes*\n\n${list || 'Todavía no has completado consultas recientes.'}\n\n${list ? 'Responde con el número para abrir el resultado.\n' : ''}*buscar* · Nueva consulta\n*0* · Menú principal\n\nAquí se muestran tus últimas 10 consultas guardadas.`;
}
function getUserStats(stats) {
  return `⚙️ *Mi cuenta y porcentaje*\n\n*Usuario:* ${stats.userName}\n*Límite diario:* ${stats.max === -1 ? 'Sin límite' : stats.max}\n*Consultas usadas o reservadas hoy:* ${stats.current}\n*Lectura de INE:* ${stats.ocr ? 'Habilitada' : 'No habilitada'}\n*Similitud mínima:* ${stats.percentage}%\n\nEscribe *P85* para usar 85% (admite 70–100).\nEl contador usa el día de CDMX y conserva el consumo después de reiniciar el servicio.\n\n*0* · Menú principal${NAV}`;
}
function getSearchLimitMessage(current, max) {
  return `⏸️ *Límite diario alcanzado*\n\nConsultas: *${current}/${max}*. El día de consulta cambia a medianoche de CDMX.\n\n1️⃣ Contactar a soporte\n2️⃣ Menú principal${NAV}`;
}
function getIneStep1Message() {
  return `📷 *INE · Frente (1/2)*\n\nEnvía una foto completa y legible del frente de la INE, sin reflejos. Después pediré el reverso y podrás revisar el nombre antes de buscar.\n\n*0* · Tipo de consulta${NAV}`;
}
function getIneStep2Message() {
  return `📷 *INE · Reverso (2/2)*\n\nFrente recibido. Envía una foto completa y legible del reverso.\n\n*0* · Repetir foto frontal${NAV}`;
}
function getIneProcessingMessage() {
  return '📷 *Leyendo la INE…*\n\nAl terminar te mostraré el nombre para que lo confirmes.';
}
function getIneErrorMessage() {
  return `⚠️ *No se pudo leer un nombre válido de la INE*\n\n1️⃣ Repetir las fotos\n2️⃣ Capturar el nombre manualmente\n3️⃣ Menú principal${NAV}`;
}
function getPercentageUpdateMessage(percentage) {
  return `✅ Similitud mínima: *${percentage}%*. Se conservará para tus próximas consultas de esta sesión.`;
}
module.exports = {
  getEnhancedMainMenu, getSearchTypeMenu, getListsInfo, getConfirmationMessage,
  getProcessingStatus, getResultsMessage, getHelpMenu, getHelpDetail,
  getErrorMessage, getWelcomeMessage, getSessionExpiredMessage,
  getRecentSearches, getUserStats, getSearchLimitMessage, getIneStep1Message,
  getIneStep2Message, getIneProcessingMessage, getIneErrorMessage,
  getPercentageUpdateMessage
};
