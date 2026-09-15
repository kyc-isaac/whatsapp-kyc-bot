const { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } = require('crypto');
function createCrypto(secret) {
  if (!secret || secret.length < 16) throw new Error('Configura una clave de almacenamiento de al menos 16 caracteres');
  const key = createHash('sha256').update('kyc-storage-v1\0' + secret).digest();
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]);
    },
    decrypt(buffer) {
      buffer = Buffer.from(buffer);
      if (buffer[0] !== 1 || buffer.length < 30) throw new Error('Datos cifrados inválidos');
      const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(1, 13));
      cipher.setAuthTag(buffer.subarray(13, 29));
      return JSON.parse(Buffer.concat([cipher.update(buffer.subarray(29)), cipher.final()]).toString('utf8'));
    }
  };
}
function sign(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function verify(secret, value, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return false;
  return timingSafeEqual(Buffer.from(sign(secret, value), 'hex'), Buffer.from(signature, 'hex'));
}
module.exports = { createCrypto, sign, verify };
