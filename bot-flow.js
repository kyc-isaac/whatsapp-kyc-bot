const menus = require('./enhanced-menus');

const STATES = Object.freeze({
  MAIN: 'main', TYPE: 'type', NAME: 'name', PATERNAL: 'paternal', MATERNAL: 'maternal',
  CONFIRM: 'confirm', RESULTS: 'results', HISTORY: 'history', HELP: 'help',
  HELP_DETAIL: 'help_detail', SETTINGS: 'settings', LIMIT: 'limit', ERROR: 'error',
  INE_FRONT: 'ine_front', INE_BACK: 'ine_back', INE_ERROR: 'ine_error', PROCESSING: 'processing'
});
const SESSION_TTL = 6 * 60 * 60 * 1000;
const MESSAGE_TTL = 24 * 60 * 60 * 1000;
const normalize = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const validName = value => typeof value === 'string' && value.length >= 2 && value.length <= 150 && /\p{L}/u.test(value) && !/[\r\n\x00-\x1f]/.test(value);
const hasOcr = user => user?.ine_ocr_enabled === true || Number(user?.ine_ocr_enabled) === 1;

// Las dependencias permiten probar todos los recorridos sin enviar mensajes reales.
function createBot({ send, authorize, shouldIgnore, reject, search, readIne, download,
  savePdf, canSearch, countSearch, syncLimit, sessions = new Map(), now = Date.now,
  log = () => {}, durable = false, loadSession = async () => null,
  getHistory = async () => [], recordHistory = async () => {} }) {
  const busy = new Set();
  const processed = new Map();

  function cleanup() {
    const time = now();
    for (const [phone, s] of sessions) {
      if (!busy.has(phone) && time - s.lastActivity.getTime() >= SESSION_TTL) sessions.delete(phone);
    }
    for (const [id, timeSeen] of processed) {
      if (time - timeSeen >= MESSAGE_TTL) processed.delete(id);
    }
  }

  function reset(s, state = STATES.MAIN) {
    s.state = state;
    s.data = {};
  }

  async function show(from, s) {
    const messages = {
      [STATES.MAIN]: () => menus.getEnhancedMainMenu(s.user.full_name, s.user.company),
      [STATES.TYPE]: () => menus.getSearchTypeMenu(hasOcr(s.user), s.percentage),
      [STATES.NAME]: () => `📝 *${s.data.kind === 'company' ? 'Razón social' : s.data.kind === 'separate' ? 'Nombre(s)' : 'Nombre completo'}*\n\n${s.data.kind === 'separate' ? 'Escribe solo el nombre o los nombres. Después pediré los apellidos.' : 'Escribe el nombre completo que deseas consultar.'}\n\n*0* · Tipo de consulta    *menu* · Inicio`,
      [STATES.PATERNAL]: () => '📝 *Apellido paterno*\n\nEscribe el apellido o *omitir* si no tiene.\n\n*0* · Corregir nombre    *menu* · Inicio',
      [STATES.MATERNAL]: () => '📝 *Apellido materno*\n\nEscribe el apellido o *omitir* si no tiene.\n\n*0* · Corregir apellido paterno    *menu* · Inicio',
      [STATES.CONFIRM]: () => menus.getConfirmationMessage({ ...s.data, porcentaje_min: s.percentage }),
      [STATES.RESULTS]: () => menus.getResultsMessage(s.result),
      [STATES.HISTORY]: () => menus.getRecentSearches(s.history),
      [STATES.HELP]: () => menus.getHelpMenu(),
      [STATES.HELP_DETAIL]: () => menus.getHelpDetail(s.helpOption),
      [STATES.SETTINGS]: async () => menus.getUserStats({ userName: s.user.full_name,
        ...await canSearch(from), percentage: s.percentage, ocr: hasOcr(s.user) }),
      [STATES.LIMIT]: async () => { const status = await canSearch(from); return menus.getSearchLimitMessage(status.current, status.max); },
      [STATES.ERROR]: () => menus.getErrorMessage(),
      [STATES.INE_FRONT]: () => menus.getIneStep1Message(),
      [STATES.INE_BACK]: () => menus.getIneStep2Message(),
      [STATES.INE_ERROR]: () => menus.getIneErrorMessage()
    };
    await send(from, await (messages[s.state] || messages[STATES.MAIN])());
  }

  async function checkLimit(from, s) {
    if ((await canSearch(from)).canSearch) return true;
    reset(s, STATES.LIMIT);
    await show(from, s);
    return false;
  }

  async function chooseType(from, s, option) {
    const kind = { '1': 'separate', '2': 'full', '3': 'company', '4': 'ine' }[option];
    if (!kind || (kind === 'ine' && !hasOcr(s.user))) {
      await send(from, 'Selecciona uno de los tipos de consulta disponibles.');
      return show(from, s);
    }
    if (!(await checkLimit(from, s))) return;
    reset(s, kind === 'ine' ? STATES.INE_FRONT : STATES.NAME);
    s.data.kind = kind;
    await show(from, s);
  }

  async function back(from, s) {
    const previous = {
      [STATES.PATERNAL]: STATES.NAME, [STATES.MATERNAL]: STATES.PATERNAL,
      [STATES.CONFIRM]: STATES.NAME, [STATES.INE_BACK]: STATES.INE_FRONT,
      [STATES.NAME]: STATES.TYPE, [STATES.INE_FRONT]: STATES.TYPE,
      [STATES.HELP_DETAIL]: STATES.HELP
    };
    const state = previous[s.state] || STATES.MAIN;
    if ([STATES.MAIN, STATES.TYPE].includes(state)) reset(s, state);
    else {
      s.state = state;
      if (state === STATES.INE_FRONT) s.data = { kind: 'ine' };
      if (state === STATES.NAME) {
        s.data = { kind: s.data.kind === 'ine' ? 'full' : s.data.kind };
      }
    }
    await show(from, s);
  }

  async function runSearch(from, s) {
    if (!(await checkLimit(from, s))) return;
    s.state = STATES.PROCESSING;
    await send(from, menus.getProcessingStatus());
    // El proveedor permite nombre completo para persona física sin apellidos separados.
    const query = { persona: s.data.kind === 'company' ? '2' : '1',
      nombre: s.data.nombre, porcentaje_min: s.percentage };
    if (s.data.kind === 'separate') {
      if (s.data.apaterno) query.apaterno = s.data.apaterno;
      if (s.data.amaterno) query.amaterno = s.data.amaterno;
    }
    const start = now();
    let result;
    try { result = await search(query, { from, messageId: s.messageId }); }
    catch (error) { if (durable) throw error; log(`Consulta fallida: ${error.code || error.name}`, 'ERROR'); }
    if (!result || result.err || !Number.isInteger(result.coincidences) || result.coincidences < 0) {
      s.state = result?.quota ? STATES.LIMIT : STATES.ERROR;
      if (result?.uncertain) await send(from, '⚠️ No se pudo confirmar el resultado del proveedor. No repetimos la consulta automáticamente. Reintentar puede generar una consulta adicional.');
      return show(from, s);
    }
    const entry = {
      name: [query.nombre, query.apaterno, query.amaterno].filter(Boolean).join(' '),
      coincidences: Number(result.coincidences), percentage: s.percentage,
      date: now(), elapsedMs: now() - start,
      matches: Array.isArray(result.person) ? result.person.slice(0, 3).map(m => ({
        lista: m.tipo, porcentaje: m.porcentaje_coincidencia
      })) : [], pdfUrl: null
    };
    // Guardar el resultado antes de enviarlo permite recuperarlo si falla Twilio.
    try { await countSearch(from); }
    catch (error) { log(`Contador histórico: ${error.code || error.name}`, 'ERROR'); }
    if (result.pdf?.base64) {
      try { entry.pdfUrl = await savePdf(result.pdf.base64, { from, messageId: s.messageId }); }
      catch (error) { if (durable) throw error; log(`PDF no disponible: ${error.code || error.name}`, 'ERROR'); }
    }
    await recordHistory(entry);
    s.history.unshift(entry);
    s.history = s.history.slice(0, 10);
    s.result = entry;
    reset(s, STATES.RESULTS);
    await show(from, s);
    if (entry.pdfUrl) await send(from, '📄 Tu reporte PDF. También puedes recuperarlo con la opción *1*.', entry.pdfUrl);
  }

  async function handleImage(from, s, payload) {
    if (!hasOcr(s.user)) {
      reset(s, STATES.TYPE);
      await send(from, 'La lectura de INE no está habilitada para tu usuario.');
      return show(from, s);
    }
    if (!(await checkLimit(from, s))) return;
    if (!payload.MediaUrl0 || !['image/jpeg', 'image/png'].includes(payload.MediaContentType0)) {
      await send(from, 'Envía una foto JPG o PNG, no un PDF, audio o documento.');
      return show(from, s);
    }
    let image;
    try { image = await download(payload.MediaUrl0); }
    catch (error) {
      reset(s, STATES.INE_ERROR);
      return show(from, s);
    }
    if (s.state === STATES.INE_FRONT) {
      s.data.front = image;
      s.state = STATES.INE_BACK;
      return show(from, s);
    }
    s.state = STATES.PROCESSING;
    let data;
    try {
      await send(from, menus.getIneProcessingMessage());
      data = await readIne(s.data.front, image);
    } catch (error) {
      if (durable) throw error;
      log(`Lectura INE fallida: ${error.code || error.name}`, 'ERROR');
    } finally {
      delete s.data.front;
      image = null;
    }
    const parts = [data?.nombres, data?.primerApellido, data?.segundoApellido]
      .filter(v => typeof v === 'string' && v.trim()).join(' ').replace(/\s+/g, ' ').trim();
    // La documentación del proveedor también admite nombre completo en `nombre`.
    const name = validName(data?.nombres?.trim()) ? parts : (typeof data?.nombre === 'string' ? data.nombre.trim() : '');
    if (data?.err || !validName(name)) {
      if (data?.uncertain) await send(from, '⚠️ No se pudo confirmar la lectura de INE. No la repetimos automáticamente; revisa el proveedor antes de enviar las fotos otra vez.');
      reset(s, STATES.INE_ERROR);
    } else {
      s.data = { kind: 'ine', nombre: name.toUpperCase() };
      s.state = STATES.CONFIRM;
    }
    await show(from, s);
  }

  async function dispatch(from, s, payload) {
    const body = typeof payload.Body === 'string' ? payload.Body.trim() : '';
    const option = normalize(body);
    if (['menu', 'inicio', 'hola', 'cancelar'].includes(option)) {
      reset(s);
      return show(from, s);
    }
    if (['atras', '0'].includes(option)) return back(from, s);
    if (option === 'buscar') {
      reset(s, STATES.TYPE);
      return show(from, s);
    }
    if (option === 'ayuda') {
      reset(s, STATES.HELP);
      return show(from, s);
    }
    if (['info', 'listas', 'soporte'].includes(option)) {
      reset(s, STATES.HELP_DETAIL);
      s.helpOption = option === 'soporte' ? '4' : '1';
      return show(from, s);
    }
    if (/^p(?:\d|\s|$)/i.test(body)) {
      if (!/^p(?:[7-9]\d|100)$/i.test(body)) {
        return send(from, 'Escribe un porcentaje entero de 70 a 100: *P85*, por ejemplo.');
      }
      s.percentage = Number(body.slice(1));
      await send(from, menus.getPercentageUpdateMessage(s.percentage));
      return show(from, s);
    }
    switch (s.state) {
      case STATES.MAIN: {
        const state = { '1': STATES.TYPE, '2': STATES.HISTORY, '3': STATES.HELP, '4': STATES.SETTINGS }[option];
        if (state) reset(s, state);
        return show(from, s);
      }
      case STATES.TYPE: return chooseType(from, s, option);
      case STATES.NAME:
      case STATES.PATERNAL:
      case STATES.MATERNAL: {
        const omit = ['skip', 'omitir'].includes(option) && s.state !== STATES.NAME;
        if (!omit && !validName(body)) {
          await send(from, 'Escribe entre 2 y 150 caracteres e incluye letras.');
          return show(from, s);
        }
        if (s.state === STATES.NAME) {
          s.data.nombre = body.toUpperCase();
          delete s.data.apaterno;
          delete s.data.amaterno;
          s.state = s.data.kind === 'separate' ? STATES.PATERNAL : STATES.CONFIRM;
        } else if (s.state === STATES.PATERNAL) {
          s.data.apaterno = omit ? '' : body.toUpperCase();
          delete s.data.amaterno;
          s.state = STATES.MATERNAL;
        } else {
          s.data.amaterno = omit ? '' : body.toUpperCase();
          s.state = STATES.CONFIRM;
        }
        return show(from, s);
      }
      case STATES.CONFIRM:
        if (option === '1') return runSearch(from, s);
        if (option === '2') return back(from, s);
        if (option === '3') reset(s);
        return show(from, s);
      case STATES.RESULTS:
        if (option === '1' || option === '2') {
          if (!s.result.pdfUrl || now() - s.result.date >= MESSAGE_TTL) {
            return send(from, 'No hay un PDF vigente para este resultado. Puedes iniciar una consulta nueva con *3*.');
          }
          return option === '1'
            ? send(from, '📄 Reporte de la consulta seleccionada.', s.result.pdfUrl)
            : send(from, 'Para compartirlo, descarga el PDF con *1* y usa la función Reenviar de WhatsApp. Elige tú el destinatario.');
        }
        if (option === '3') reset(s, STATES.TYPE);
        if (option === '4') reset(s);
        return show(from, s);
      case STATES.HISTORY: {
        const entry = /^(?:[1-9]|10)$/.test(option) ? s.history[Number(option) - 1] : null;
        if (entry) { s.result = entry; s.state = STATES.RESULTS; }
        return show(from, s);
      }
      case STATES.HELP:
      case STATES.HELP_DETAIL:
        if (menus.getHelpDetail(option)) { s.helpOption = option; s.state = STATES.HELP_DETAIL; }
        else s.state = STATES.HELP;
        return show(from, s);
      case STATES.ERROR:
        if (option === '1') return runSearch(from, s);
        if (option === '2') reset(s);
        if (option === '3') { reset(s, STATES.HELP_DETAIL); s.helpOption = '4'; }
        return show(from, s);
      case STATES.LIMIT:
        if (option === '1') { reset(s, STATES.HELP_DETAIL); s.helpOption = '4'; }
        if (option === '2') reset(s);
        return show(from, s);
      case STATES.INE_FRONT:
      case STATES.INE_BACK: return handleImage(from, s, payload);
      case STATES.INE_ERROR:
        if (option === '1') return chooseType(from, s, '4');
        if (option === '2') return chooseType(from, s, '2');
        if (option === '3') reset(s);
        return show(from, s);
      default: return show(from, s);
    }
  }

  async function handleMessage(payload) {
    const from = typeof payload.From === 'string' ? payload.From.replace(/\s/g, '') : '';
    if (!/^whatsapp:\+\d{7,15}$/.test(from)) return;
    const id = typeof payload.MessageSid === 'string' ? payload.MessageSid : '';
    cleanup();
    if (!durable && id && processed.has(id)) return;
    if (!durable && id) {
      processed.set(id, now());
      if (processed.size > 10000) processed.delete(processed.keys().next().value);
    }
    if (busy.has(from)) {
      // No interpretar números concurrentes como opciones de la pantalla siguiente.
      try { await send(from, '⏳ Estoy atendiendo tu mensaje anterior. Espera la respuesta y vuelve a elegir una opción.'); }
      catch (error) { log(`Error de envío: ${error.code || error.name}`, 'ERROR'); }
      return;
    }
    busy.add(from);
    let s;
    try {
      const auth = await authorize(from);
      if (auth.unavailable) {
        if (durable) throw Object.assign(new Error('MySQL no disponible'), { code: 'DB_UNAVAILABLE' });
        return await send(from, '⚠️ No se pudo verificar tu acceso. Intenta más tarde o contacta al administrador.');
      }
      if (!auth.authorized) {
        sessions.delete(from);
        if (!(await shouldIgnore(from))) await reject(from);
        return;
      }
      syncLimit(from, auth.user.search_limit);
      s = durable ? await loadSession(from) : sessions.get(from);
      if (!s) {
        s = { state: STATES.MAIN, data: {}, history: [], percentage: 98, lastActivity: new Date(now()) };
        sessions.set(from, s);
      }
      if (durable) s.history = await getHistory(from);
      sessions.set(from, s);
      s.messageId = id;
      s.user = auth.user;
      s.lastActivity = new Date(now());
      await dispatch(from, s, payload);
    } catch (error) {
      log(`Mensaje ${id || '(sin SID)'}: ${error.code || error.name} ${error.message}`, 'ERROR');
      if (durable) throw error;
      if (s?.state === STATES.PROCESSING) reset(s);
      // Un fallo de envío no debe provocar otro intento de envío recursivo.
    } finally {
      if (s) s.lastActivity = new Date(now());
      busy.delete(from);
    }
  }

  return { handleMessage, sessions, cleanup };
}
module.exports = { createBot, STATES };
