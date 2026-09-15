const fs = require('fs');
const path = require('path');

// Función para limpiar número de teléfono (quitar 'whatsapp:' y espacios)
function cleanPhoneNumber(phoneNumber) {
  // Quitar "whatsapp:" y espacios, luego asegurar que tenga +
  let cleaned = String(phoneNumber || '').replace(/^whatsapp:/, '').replace(/\s/g, '').trim();
  // Si no empieza con +, agregarlo
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Enmascarar número de teléfono para logs
function maskPhoneNumber(phoneNumber) {
  phoneNumber = cleanPhoneNumber(phoneNumber);
  if (!phoneNumber || phoneNumber.length < 6) return '***';
  return phoneNumber.substring(0, 3) + '***' + phoneNumber.substring(phoneNumber.length - 3);
}

function createAuthService(pool) {
  // Verificar si un número está autorizado
  async function isAuthorized(phoneNumber) {
    try {
      const cleanNumber = cleanPhoneNumber(phoneNumber);

      const [rows] = await pool.execute(
        'SELECT * FROM authorized_users WHERE phone_number = ? AND is_active = TRUE',
        [cleanNumber]
      );

      if (rows.length > 0) {
        // Los mensajes actualizan acceso; solo las consultas completadas incrementan el total.
        await pool.execute(
          'UPDATE authorized_users SET last_access = NOW() WHERE id = ?',
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
      console.error('Error verificando autorización:', error.code || error.name);
      return { authorized: false, unavailable: true, user: null };
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
      console.error('Error registrando intento bloqueado:', error.code || error.name);
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
      console.error('Error contando intentos:', error.code || error.name);
      return 0;
    }
  }

  // Mantener los textos alineados con las opciones del bot.
  function getWelcomeMessage(user) {
    return require('./enhanced-menus').getEnhancedMainMenu(user.full_name, user.company);
  }

  async function getRejectionMessage(phoneNumber) {
    if (await getRecentAttempts(phoneNumber) >= 5) return null;
    return '🔒 Tu número no tiene acceso a este servicio. Para solicitarlo, contacta al administrador: hola@kyc-systems.com.';
  }

  async function recordCompletedSearch(phoneNumber) {
    await pool.execute(
      'UPDATE authorized_users SET total_queries = total_queries + 1 WHERE phone_number = ?',
      [cleanPhoneNumber(phoneNumber)]
    );
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
      console.error('Error agregando usuario:', error.code || error.name);
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
      console.error('Error desactivando usuario:', error.code || error.name);
      return false;
    }
  }

  return {
    isAuthorized,
    recordCompletedSearch,
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
}

module.exports = { createAuthService, cleanPhoneNumber, maskPhoneNumber };
module.exports.isAuthorized = (...args) => createAuthService(require('./database').pool).isAuthorized(...args);
module.exports.recordCompletedSearch = (...args) => createAuthService(require('./database').pool).recordCompletedSearch(...args);
module.exports.logBlockedAttempt = (...args) => createAuthService(require('./database').pool).logBlockedAttempt(...args);
module.exports.getRecentAttempts = (...args) => createAuthService(require('./database').pool).getRecentAttempts(...args);
module.exports.getRejectionMessage = (...args) => createAuthService(require('./database').pool).getRejectionMessage(...args);
module.exports.shouldIgnoreUser = (...args) => createAuthService(require('./database').pool).shouldIgnoreUser(...args);
module.exports.getWelcomeMessage = (...args) => createAuthService(require('./database').pool).getWelcomeMessage(...args);
module.exports.addAuthorizedUser = (...args) => createAuthService(require('./database').pool).addAuthorizedUser(...args);
module.exports.deactivateUser = (...args) => createAuthService(require('./database').pool).deactivateUser(...args);
