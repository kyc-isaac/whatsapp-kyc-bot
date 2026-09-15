const express = require('express');
const session = require('express-session');
const path = require('path');
const twilio = require('twilio');
const { createCrypto } = require('./lib/crypto');
const { Repository } = require('./lib/repository');
const { createReports } = require('./lib/reports');
const { MySQLSessionStore, createAdminSecurity } = require('./lib/admin-security');
const { createProviders } = require('./lib/providers');
const { createWorker } = require('./lib/worker');
const { createMonitor } = require('./lib/monitor');
const { createAuthService } = require('./authService');
const { createAdminRoutes } = require('./admin-routes');

function createApp({ pool, env = process.env, providers, log = (message, level = 'INFO') => console.log(`[${new Date().toISOString()}] ${level}: ${message}`), reportDirectory } = {}) {
  for (const key of ['SESSION_SECRET','SERVER_URL','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_WHATSAPP_NUMBER','KYC_API_URL','KYC_API_KEY']) {
    if (!env[key]) throw new Error(`Falta configurar ${key}`);
  }
  const crypto = createCrypto(env.DATA_ENCRYPTION_KEY || env.SESSION_SECRET);
  const repository = new Repository(pool, crypto);
  const api = providers || createProviders(env, log);
  const auth = createAuthService(pool);
  const reports = createReports({ pool, crypto, directory: reportDirectory || path.join(__dirname, 'private/reports'), secret: env.REPORT_SIGNING_KEY || env.SESSION_SECRET, publicUrl: env.SERVER_URL });
  const security = createAdminSecurity({ pool, secret: env.SESSION_SECRET, publicUrl: env.SERVER_URL });
  const worker = createWorker({ repository, reports, twilioClient: api.client, publicUrl: env.SERVER_URL, log,
    services: { search: api.search, readIne: api.readIne, download: api.download, senderNumber: env.TWILIO_WHATSAPP_NUMBER,
      authorize: auth.isAuthorized, shouldIgnore: auth.shouldIgnoreUser,
      rejectionMessage: async from => { await auth.logBlockedAttempt(from, ''); return auth.getRejectionMessage(from); } } });
  const monitor = createMonitor({ repository, client: api.client, axios: api.axios, env, log,
    ...(providers?.resolve ? { resolve: providers.resolve } : {}), ...(providers?.checkCertificate ? { checkCertificate: providers.checkCertificate } : {}) });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use(session({ secret: env.SESSION_SECRET, store: new MySQLSessionStore(pool, crypto), resave: false, saveUninitialized: false,
    cookie: { secure: env.NODE_ENV === 'production', httpOnly: true, sameSite: 'strict', maxAge: 86400000 } }));
  function validateTwilio(req, res, next) {
    if (!req.is('application/x-www-form-urlencoded')) return res.sendStatus(415);
    const url = env.SERVER_URL.replace(/\/$/, '') + req.originalUrl;
    if (!twilio.validateRequest(env.TWILIO_AUTH_TOKEN, req.get('X-Twilio-Signature') || '', url, req.body || {})) return res.sendStatus(403);
    next();
  }
  app.post('/webhook', validateTwilio, async (req, res) => {
    if (!/^whatsapp:\+\d{7,15}$/.test(req.body.From || '') || !/^[A-Z]{2}[a-f0-9]{32}$/i.test(req.body.MessageSid || '')) return res.sendStatus(400);
    // El acuse se envía solo después de guardar el trabajo y su SID único en MySQL.
    await repository.enqueue(req.body);
    res.type('text/xml').send('<Response/>');
  });
  app.post('/webhook/status', validateTwilio, async (req, res) => {
    const { MessageSid, MessageStatus, ErrorCode } = req.body;
    if (!/^[A-Z]{2}[a-f0-9]{32}$/i.test(MessageSid || '')) return res.sendStatus(400);
    await repository.delivery(req.query.outbox, MessageSid, MessageStatus, ErrorCode);
    log(`Estado Twilio ${MessageSid}: ${MessageStatus}; código=${ErrorCode || '-'}`, ErrorCode ? 'ERROR' : 'INFO');
    res.type('text/xml').send('<Response/>');
  });
  app.get('/reports/:id', (req, res, next) => reports.serve(req, res).catch(next));
  // Nunca exponer archivos heredados por una ruta estática sin vencimiento verificable.
  app.use(['/temp','/pdfs'], (req, res) => res.sendStatus(410));
  app.get('/live', (req, res) => res.json({ service: 'kyc-whatsapp-bot', status: 'alive' }));
  app.get('/health', (req, res) => {
    const health = monitor.snapshot();
    res.set('Cache-Control', 'no-store').status(health.status === 'ok' ? 200 : 503).json({ status: health.status, checkedAt: health.checkedAt });
  });
  app.get('/admin/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
  app.get('/admin/admin-client.js', (req, res) => res.sendFile(path.join(__dirname, 'public/admin-client.js')));
  app.get(['/admin','/admin/'], security.requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
  app.use('/admin', security.requireAdmin, express.static(path.join(__dirname, 'public')));
  app.use('/api/admin', createAdminRoutes({ pool, repository, security, monitor, reports }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.parse.failed' ? 400 : error.status || 503;
    log(`HTTP ${req.method} ${req.path}: ${status} ${error.code || error.type || error.name}`, 'ERROR');
    res.status(status).json({ success: false, message: status === 400 ? 'Solicitud inválida' : 'No se pudo procesar la solicitud' });
  });
  let maintenance;
  async function cleanup() {
    await reports.cleanup();
    await pool.query('DELETE FROM bot_conversations WHERE expires_at<=UTC_TIMESTAMP(3)');
    await pool.query('DELETE FROM bot_admin_sessions WHERE expires_at<=UTC_TIMESTAMP(3)');
    await pool.query('DELETE FROM bot_login_limits WHERE window_start<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)');
    const days = Math.max(1, Math.min(3650, Math.floor(Number(env.HISTORY_RETENTION_DAYS) || 90)));
    await pool.query(`DELETE s FROM bot_searches s JOIN bot_jobs j ON j.message_sid=s.message_sid WHERE s.created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) AND j.status IN ('done','cancelled') AND s.status IN ('succeeded','failed')`);
    await pool.query(`DELETE e FROM bot_effects e JOIN bot_jobs j ON j.message_sid=e.message_sid WHERE e.created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) AND j.status IN ('done','cancelled') AND e.status IN ('succeeded','failed')`);
    await pool.query(`DELETE FROM bot_delivery_events WHERE created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY)`);
    await pool.query(`DELETE FROM bot_outbox WHERE updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) AND status IN ('delivered','read','failed','undelivered')`);
    await pool.query(`DELETE FROM bot_reports WHERE expires_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) AND revoked=1`);
    await pool.query(`DELETE FROM bot_jobs WHERE created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) AND status IN ('done','cancelled')`);
    await pool.query(`DELETE FROM bot_audit WHERE created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY)`);
    await pool.query(`DELETE FROM blocked_attempts WHERE attempt_time<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY)`);
    await pool.query(`DELETE FROM bot_alerts WHERE active=0 AND resolved_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY)`);
  }
  return { app, repository, worker, monitor, reports, security, cleanup,
    start() { worker.start(); monitor.start(); maintenance = setInterval(() => void cleanup().catch(error => log(`Limpieza: ${error.code || error.name}`, 'ERROR')), 3600000); },
    async stop() { clearInterval(maintenance); await worker.stop(); await monitor.stop(); } };
}
if (require.main === module) {
  const { pool } = require('./database');
  const runtime = createApp({ pool });
  const server = runtime.app.listen(process.env.PORT || 3001, () => { runtime.start(); console.log('Bot iniciado; consulta /health para estado de dependencias.'); });
  async function stop() {
    const closed = new Promise(resolve => server.close(resolve));
    await Promise.all([closed, runtime.stop()]);
    await pool.end();
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
module.exports = { createApp };
