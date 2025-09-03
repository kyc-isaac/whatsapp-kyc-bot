const { pool } = require('./database');
const fs = require('fs');
const path = require('path');

// Función para limpiar número de teléfono (quitar 'whatsapp:' y espacios)
function cleanPhoneNumber(phoneNumber) {
  // Quitar "whatsapp:" y espacios, luego asegurar que tenga +
  let cleaned = phoneNumber.replace('whatsapp:', '').replace(/\s/g, '').trim();
  // Si no empieza con +, agregarlo
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Verificar si un número está autorizado
async function isAuthorized(phoneNumber) {
  try {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    
    const [rows] = await pool.execute(
      'SELECT * FROM authorized_users WHERE phone_number = ? AND is_active = TRUE',
      [cleanNumber]
    );

    if (rows.length > 0) {
      // Actualizar último acceso y contador
      await pool.execute(
        'UPDATE authorized_users SET last_access = NOW(), total_queries = total_queries + 1 WHERE id = ?',
        [rows[0].id]
      );
      
      return {
        authorized: true,
        user: rows[0]
      };
    }

    return {
      authorized: false,
      user: null
    };
  } catch (error) {
    console.error('Error verificando autorización:', error);
    // En caso de error de DB, permitir acceso temporalmente (failover)
    return {
      authorized: true,
      user: {
        full_name: 'Usuario',
        company: 'Empresa'
      }
    };
  }
}

// Registrar intento bloqueado
async function logBlockedAttempt(phoneNumber, messageContent) {
  try {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    
    await pool.execute(
      'INSERT INTO blocked_attempts (phone_number, message_content) VALUES (?, ?)',
      [cleanNumber, messageContent || '']
    );
    
    // Log adicional en archivo
    const logMessage = `[${new Date().toISOString()}] Intento bloqueado de ${maskPhoneNumber(cleanNumber)}\n`;
    const logFile = path.join(__dirname, 'logs', `blocked-${new Date().toISOString().split('T')[0]}.log`);
    
    if (!fs.existsSync(path.dirname(logFile))) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
    }
    
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error('Error registrando intento bloqueado:', error);
  }
}

// Contar intentos recientes de un número
async function getRecentAttempts(phoneNumber) {
  try {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as attempts 
       FROM blocked_attempts 
       WHERE phone_number = ? 
       AND attempt_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [cleanNumber]
    );

    return rows[0].attempts || 0;
  } catch (error) {
    console.error('Error contando intentos:', error);
    return 0;
  }
}

// Enmascarar número de teléfono para logs
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || phoneNumber.length < 6) return phoneNumber;
  return phoneNumber.substring(0, 3) + '***' + phoneNumber.substring(phoneNumber.length - 3);
}

// Obtener mensaje de bienvenida personalizado
function getWelcomeMessage(user) {
  return `¡Hola ${user.full_name}! 👋

*Bienvenido al Sistema KYC-LISTAS*
${user.company ? `🏢 ${user.company}` : ''}

Selecciona una opción:
*1* - 🔎 Búsqueda en listas
*2* - ℹ️ Información del sistema  
*3* - 📞 Contacto soporte

Tu número está autorizado para realizar consultas.`;
}

// Obtener mensaje de rechazo según intentos
async function getRejectionMessage(phoneNumber) {
  const attempts = await getRecentAttempts(phoneNumber);
  
  if (attempts === 0) {
    // Primer intento
    return `❌ *Acceso Restringido*

Su número no está autorizado para usar este servicio.

📞 *Para solicitar acceso contacte:*
• Email: acceso@kyc-listas.com  
• WhatsApp: +52 55 1234-5678
• Web: www.kyc-listas.com/acceso

⏰ *Horario:* Lunes a Viernes 9:00-18:00

_Este es un sistema privado de consultas KYC._`;
  } else if (attempts < 3) {
    // Segundo y tercer intento
    return `🚫 *Servicio No Disponible*

Su número no tiene autorización.
No insista con mensajes adicionales.

Para acceso legítimo contacte:
📧 acceso@kyc-listas.com

_Intentos repetidos serán registrados._`;
  } else if (attempts < 5) {
    // Cuarto y quinto intento
    return `⛔ *ACCESO DENEGADO*

Sus intentos están siendo registrados.
Detenga el envío de mensajes.

_Sistema de seguridad activo._`;
  } else {
    // Más de 5 intentos - mensaje mínimo o ninguno
    return null; // No responder
  }
}

// Verificar si debemos ignorar al usuario (spam)
async function shouldIgnoreUser(phoneNumber) {
  const attempts = await getRecentAttempts(phoneNumber);
  return attempts >= 5; // Ignorar después de 5 intentos en una hora
}

// Agregar usuario a la base de datos (función administrativa)
async function addAuthorizedUser(phoneNumber, fullName, company = null) {
  try {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    
    const [result] = await pool.execute(
      'INSERT INTO authorized_users (phone_number, full_name, company) VALUES (?, ?, ?)',
      [cleanNumber, fullName, company]
    );
    
    return {
      success: true,
      userId: result.insertId
    };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return {
        success: false,
        error: 'El número ya existe en la base de datos'
      };
    }
    console.error('Error agregando usuario:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Desactivar usuario
async function deactivateUser(phoneNumber) {
  try {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    
    const [result] = await pool.execute(
      'UPDATE authorized_users SET is_active = FALSE WHERE phone_number = ?',
      [cleanNumber]
    );
    
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Error desactivando usuario:', error);
    return false;
  }
}

module.exports = {
  isAuthorized,
  logBlockedAttempt,
  getRecentAttempts,
  getRejectionMessage,
  shouldIgnoreUser,
  getWelcomeMessage,
  addAuthorizedUser,
  deactivateUser,
  cleanPhoneNumber,
  maskPhoneNumber
};