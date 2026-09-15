const test = require('node:test');
const assert = require('node:assert/strict');
const { createCrypto, sign, verify } = require('../lib/crypto');
const { pagination } = require('../lib/pagination');
const { validPassword } = require('../lib/admin-security');
const { parseUserInput } = require('../user-validation');

test('datos persistidos están cifrados y una alteración se rechaza', () => {
  const crypto = createCrypto('a-secret-with-enough-length');
  const raw = crypto.encrypt({ name:'DATO SENSIBLE', front:'image', history:[1,2] });
  assert.equal(raw.includes(Buffer.from('DATO SENSIBLE')),false);
  assert.deepEqual(crypto.decrypt(raw),{ name:'DATO SENSIBLE', front:'image', history:[1,2] });
  raw[raw.length-1] ^= 1;assert.throws(()=>crypto.decrypt(raw));
});
test('firma de reportes depende del identificador y vencimiento', () => {
  const signature = sign('secret','report:1800000000');
  assert.equal(verify('secret','report:1800000000',signature),true);
  assert.equal(verify('secret','other:1800000000',signature),false);
  assert.equal(verify('secret','report:1800000001',signature),false);
  assert.equal(verify('secret','report:1800000000','bad'),false);
});
test('paginación rechaza inyección y tamaños no válidos', () => {
  assert.deepEqual(pagination({page:'3',pageSize:'25'}),{page:3,pageSize:25,offset:50});
  for(const query of [{page:'1; DROP TABLE users'},{page:0},{pageSize:101},{pageSize:-1},{page:1.5}])assert.throws(()=>pagination(query));
});
test('contraseñas no se truncan silenciosamente en bcrypt', () => {
  assert.equal(validPassword('short'),false);
  assert.equal(validPassword('a-long-password-123'),true);
  assert.equal(validPassword('é'.repeat(37)),false);
  assert.equal(validPassword('a'.repeat(72)),true);
});
test('validación de usuario normaliza teléfono y respeta permisos', () => {
  const user=parseUserInput({phone_number:'whatsapp:+5215500000001',full_name:'Nombre',search_limit:0,is_active:0,ine_ocr_enabled:1});
  assert.equal(user.phone,'+5215500000001');assert.equal(user.limit,0);assert.equal(user.active,false);assert.equal(user.ocr,true);
  assert.ok(parseUserInput({phone_number:'+5215500000001',full_name:'Nombre',search_limit:'10abc'}).error);
});
