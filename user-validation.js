const { cleanPhoneNumber } = require('./authService');

function parseUserInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Datos de usuario inválidos.' };
  const phone = cleanPhoneNumber(input.phone_number);
  const name = typeof input.full_name === 'string' ? input.full_name.trim() : '';
  const company = typeof input.company === 'string' ? input.company.trim() : '';
  const rawLimit = input.search_limit ?? 100;
  const limit = rawLimit === 'unlimited' ? -1 : Number(rawLimit);
  const validFlag = value => value === undefined || [true, false, 0, 1].includes(value);
  if (!/^\+\d{7,15}$/.test(phone) || !name || name.length > 150 || company.length > 200) {
    return { error: 'Verifica el teléfono internacional, nombre (máximo 150 caracteres) y empresa (máximo 200).' };
  }
  if (!['number', 'string'].includes(typeof rawLimit) || String(rawLimit).trim() === '' || !Number.isInteger(limit) || limit < -1 || limit > 2147483647) {
    return { error: 'El límite debe ser un entero desde 0, o -1 para ilimitado.' };
  }
  if (!validFlag(input.is_active) || !validFlag(input.ine_ocr_enabled)) {
    return { error: 'Los permisos deben ser valores booleanos.' };
  }
  return { phone, name, company: company || null, limit,
    active: input.is_active === undefined ? true : Boolean(input.is_active),
    ocr: Boolean(input.ine_ocr_enabled) };
}
module.exports = { parseUserInput };
