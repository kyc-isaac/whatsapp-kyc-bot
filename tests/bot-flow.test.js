const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot, STATES } = require('../bot-flow');

function fixture(overrides = {}) {
  let time = Date.UTC(2026, 8, 15, 18);
  const sent = [], queries = [], reads = [], downloads = [];
  let count = 0, sequence = 0;
  const user = { full_name: 'Usuario de prueba', company: 'Empresa de prueba', search_limit: 100, ine_ocr_enabled: 1 };
  const phone = 'whatsapp:+5215500000001';
  const dependencies = {
    send: async (to, body, media) => sent.push({ to, body, media }),
    authorize: async () => ({ authorized: true, user }),
    shouldIgnore: async () => false, reject: async () => {},
    search: async query => { queries.push(query); return { err: false, coincidences: 0, pdf: { base64: 'fixture' } }; },
    readIne: async (...args) => { reads.push(args); return { nombres: 'ANA', primerApellido: 'PEREZ', segundoApellido: 'LOPEZ' }; },
    download: async url => { downloads.push(url); return 'image-base64'; },
    savePdf: async () => 'https://bot.example/temp/report.pdf',
    canSearch: () => ({ canSearch: user.search_limit === -1 || count < user.search_limit, current: count, max: user.search_limit }),
    countSearch: () => { count++; }, syncLimit: () => {}, now: () => time,
    ...overrides
  };
  const bot = createBot(dependencies);
  const message = (body, extra = {}) => bot.handleMessage({ From: phone, Body: body, MessageSid: `SM${++sequence}`, ...extra });
  const flow = async (...bodies) => { for (const body of bodies) await message(body); };
  return { bot, user, sent, queries, reads, downloads, message, flow, phone,
    state: () => bot.sessions.get(phone), count: () => count,
    advance: ms => { time += ms; }, last: () => sent.at(-1)?.body };
}

for (const [type, bodies, expected] of [
  ['1', ['ANA', 'PEREZ', 'omitir'], { persona: '1', nombre: 'ANA', apaterno: 'PEREZ', porcentaje_min: 85 }],
  ['2', ['ANA PEREZ'], { persona: '1', nombre: 'ANA PEREZ', porcentaje_min: 85 }],
  ['3', ['EMPRESA SA DE CV'], { persona: '2', nombre: 'EMPRESA SA DE CV', porcentaje_min: 85 }]
]) {
  test(`tipo ${type}: no consulta hasta confirmar y conserva porcentaje`, async () => {
    const f = fixture();
    await f.flow('hola', '1', 'P85', type, ...bodies);
    assert.equal(f.state().state, STATES.CONFIRM);
    assert.equal(f.queries.length, 0);
    assert.match(f.last(), /Confirmar y buscar/);
    await f.message('1');
    assert.deepEqual(f.queries, [expected]);
    assert.equal(f.count(), 1);
    assert.equal(f.state().state, STATES.RESULTS);
    await f.flow('menu', '1');
    assert.match(f.last(), /85%/);
  });
}

test('corregir, omitir y cambiar tipo no conserva apellidos anteriores', async () => {
  const f = fixture();
  await f.flow('buscar', '1', 'ANA', 'PEREZ', 'LOPEZ', '2', 'MARIA', 'omitir', 'skip');
  assert.equal(f.state().state, STATES.CONFIRM);
  assert.equal(f.state().data.apaterno, '');
  await f.flow('3', 'buscar', '3', 'EMPRESA', '1');
  assert.deepEqual(f.queries[0], { persona: '2', nombre: 'EMPRESA', porcentaje_min: 98 });
});

test('las cuatro acciones del resultado tienen destinos propios', async () => {
  const f = fixture();
  await f.flow('buscar', '2', 'ANA PEREZ', '1');
  const count = f.queries.length;
  await f.message('1');
  assert.equal(f.sent.at(-1).media, 'https://bot.example/temp/report.pdf');
  await f.message('2');
  assert.match(f.last(), /Reenviar/);
  assert.equal(f.queries.length, count);
  await f.message('3');
  assert.equal(f.state().state, STATES.TYPE);
  await f.flow('menu', '2', '1', '4');
  assert.equal(f.state().state, STATES.MAIN);
});

test('historial contiene resultados reales, separados por usuario y sin repetir consultas', async () => {
  const f = fixture();
  await f.flow('buscar', '3', 'EMPRESA', '1', 'menu', '2');
  assert.match(f.last(), /EMPRESA/);
  await f.message('1');
  assert.equal(f.state().state, STATES.RESULTS);
  assert.equal(f.count(), 1);
  await f.message('2', { From: 'whatsapp:+5215500000002' });
  assert.match(f.last(), /Todavía no/);
});

test('historial limitado a diez y sesión eliminada tras seis horas', async () => {
  const f = fixture();
  for (let i = 0; i < 11; i++) await f.flow('buscar', '3', `EMPRESA ${i}`, '1');
  assert.equal(f.state().history.length, 10);
  assert.equal(f.state().history[0].name, 'EMPRESA 10');
  f.advance(6 * 60 * 60 * 1000);
  f.bot.cleanup();
  assert.equal(f.bot.sessions.size, 0);
});

test('INE: requiere permiso, dos fotos y confirmación; libera imágenes', async () => {
  const f = fixture();
  await f.flow('buscar', '4');
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'image/jpeg' });
  assert.equal(f.state().state, STATES.INE_BACK);
  await f.message('', { MediaUrl0: 'back', MediaContentType0: 'image/png' });
  assert.equal(f.state().state, STATES.CONFIRM);
  assert.equal(f.queries.length, 0);
  assert.equal(f.reads.length, 1);
  assert.equal(f.state().data.front, undefined);
  assert.match(f.last(), /ANA PEREZ LOPEZ/);
  await f.message('1');
  assert.equal(f.queries[0].nombre, 'ANA PEREZ LOPEZ');
  assert.equal(f.count(), 1);
});

test('INE sin nombre válido permite repetir, capturar manualmente o cancelar', async () => {
  const f = fixture({ readIne: async () => ({ nombres: '', primerApellido: 'PEREZ' }) });
  await f.flow('buscar', '4');
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'image/jpeg' });
  await f.message('', { MediaUrl0: 'back', MediaContentType0: 'image/jpeg' });
  assert.equal(f.state().state, STATES.INE_ERROR);
  assert.deepEqual(f.state().data, {});
  await f.message('1');
  assert.equal(f.state().state, STATES.INE_FRONT);
  f.state().state = STATES.INE_ERROR;
  await f.message('2');
  assert.equal(f.state().state, STATES.NAME);
  assert.equal(f.state().data.kind, 'full');
  assert.equal(f.queries.length, 0);
});

test('permiso INE revocado y contenido no admitido no descargan imágenes', async () => {
  const f = fixture();
  await f.flow('buscar', '4');
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'application/pdf' });
  assert.equal(f.downloads.length, 0);
  f.user.ine_ocr_enabled = 0;
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'image/jpeg' });
  assert.equal(f.downloads.length, 0);
  assert.equal(f.state().state, STATES.TYPE);
  assert.doesNotMatch(f.last(), /4️⃣/);
});

test('INE cancelar y volver liberan la foto frontal', async () => {
  const f = fixture();
  await f.flow('buscar', '4');
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'image/jpeg' });
  await f.message('0');
  assert.equal(f.state().data.front, undefined);
  await f.message('cancelar');
  assert.equal(f.state().state, STATES.MAIN);
});

test('límites se aplican antes de descargar INE y antes de confirmar', async () => {
  const f = fixture();
  f.user.search_limit = 0;
  await f.flow('buscar', '4');
  assert.equal(f.state().state, STATES.LIMIT);
  assert.equal(f.downloads.length, 0);
  await f.message('1');
  assert.equal(f.state().state, STATES.HELP_DETAIL);
  f.user.search_limit = 1;
  await f.flow('buscar', '2', 'ANA PEREZ');
  f.user.search_limit = 0;
  await f.message('1');
  assert.equal(f.state().state, STATES.LIMIT);
  assert.equal(f.queries.length, 0);
});

test('errores KYC permiten reintentar sin contar intentos fallidos', async () => {
  let calls = 0;
  const f = fixture({ search: async () => ++calls === 1 ? { err: true } : { err: false, coincidences: 0 } });
  await f.flow('buscar', '2', 'ANA PEREZ', '1');
  assert.equal(f.state().state, STATES.ERROR);
  assert.equal(f.count(), 0);
  await f.message('1');
  assert.equal(f.state().state, STATES.RESULTS);
  assert.equal(f.count(), 1);
  await f.message('1');
  assert.match(f.last(), /No hay un PDF/);
});

test('una respuesta KYC inválida no se presenta como cero coincidencias', async () => {
  const f = fixture({ search: async () => ({ message: 'Not found' }) });
  await f.flow('buscar', '3', 'EMPRESA', '1');
  assert.equal(f.state().state, STATES.ERROR);
  assert.equal(f.count(), 0);
});

test('ayuda 1–9, detalle y regreso coinciden con lo anunciado', async () => {
  const f = fixture();
  for (let i = 1; i <= 9; i++) {
    await f.flow('ayuda', String(i));
    assert.equal(f.state().state, STATES.HELP_DETAIL);
    assert.match(f.last(), /Volver a ayuda/);
    await f.message('0');
    assert.equal(f.state().state, STATES.HELP);
  }
  await f.message('0');
  assert.equal(f.state().state, STATES.MAIN);
});

test('porcentajes estrictos, límites y nombres vacíos no avanzan', async () => {
  const f = fixture();
  await f.flow('buscar', 'P85foo', 'P69', 'P100.1');
  assert.equal(f.state().percentage, 98);
  await f.flow('P100', 'P70', '2', '', '1');
  assert.equal(f.state().percentage, 70);
  assert.equal(f.state().state, STATES.NAME);
  await f.message('PEDRO');
  assert.equal(f.state().state, STATES.CONFIRM);
});

test('MessageSid repetido no ejecuta dos consultas', async () => {
  const f = fixture();
  await f.flow('buscar', '3', 'EMPRESA');
  await f.message('1', { MessageSid: 'SMduplicate' });
  await f.message('1', { MessageSid: 'SMduplicate' });
  assert.equal(f.queries.length, 1);
  assert.equal(f.count(), 1);
});

test('mensajes concurrentes no pisan el estado ni duplican consultas', async () => {
  let resolveSearch;
  const started = new Promise(resolve => { resolveSearch = resolve; });
  let complete;
  const f = fixture({ search: async () => { resolveSearch(); return new Promise(resolve => { complete = resolve; }); } });
  await f.flow('buscar', '3', 'EMPRESA');
  const running = f.message('1');
  await started;
  await f.message('menu');
  assert.match(f.last(), /mensaje anterior/);
  assert.equal(f.state().state, STATES.PROCESSING);
  complete({ err: false, coincidences: 0 });
  await running;
  assert.equal(f.state().state, STATES.RESULTS);
});

test('Twilio rechazado no dispara envíos de error recursivos', async () => {
  let attempts = 0;
  const f = fixture({ send: async () => { attempts++; throw Object.assign(new Error('Authenticate'), { code: 20003 }); } });
  await f.message('hola');
  assert.equal(attempts, 1);
});

test('no autoriza cuando la base de datos falla', async () => {
  const f = fixture({ authorize: async () => ({ authorized: false, unavailable: true }) });
  await f.message('buscar');
  assert.match(f.last(), /verificar tu acceso/);
  assert.equal(f.bot.sessions.size, 0);
  assert.equal(f.queries.length, 0);
});

test('un usuario autorizado no queda bloqueado por intentos previos', async () => {
  const f = fixture({ shouldIgnore: async () => { throw new Error('No debe consultarse para autorizados'); } });
  await f.message('hola');
  assert.equal(f.state().state, STATES.MAIN);
});

test('OCR admite nombre completo documentado por el proveedor', async () => {
  const f = fixture({ readIne: async () => ({ nombre: 'ANA PEREZ LOPEZ' }) });
  await f.flow('buscar', '4');
  await f.message('', { MediaUrl0: 'front', MediaContentType0: 'image/jpeg' });
  await f.message('', { MediaUrl0: 'back', MediaContentType0: 'image/jpeg' });
  assert.equal(f.state().state, STATES.CONFIRM);
  assert.equal(f.state().data.nombre, 'ANA PEREZ LOPEZ');
  assert.equal(f.queries.length, 0);
});

test('historial con nombres largos cabe en un mensaje de WhatsApp', async () => {
  const menus = require('../enhanced-menus');
  const history = Array.from({ length: 10 }, () => ({ name: 'N'.repeat(150), date: Date.now(), coincidences: 100 }));
  assert.ok(menus.getRecentSearches(history).length < 1600);
});

test('PDF fallido conserva resultado e historial sin inventar un reporte', async () => {
  const f = fixture({ savePdf: async () => { throw new Error('disk full'); } });
  await f.flow('buscar', '3', 'EMPRESA', '1');
  assert.equal(f.state().state, STATES.RESULTS);
  assert.equal(f.state().history.length, 1);
  assert.equal(f.state().result.pdfUrl, null);
  assert.match(f.last(), /No hay PDF disponible/);
  assert.equal(f.count(), 1);
});
