const dns = require('dns').promises;
const tls = require('tls');
function certificate(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ expiresAt: cert.valid_to });
    });
    socket.setTimeout(8000, () => socket.destroy(new Error('TLS timeout')));
    socket.on('error', reject);
  });
}
function createMonitor({ repository, client, axios, env, log, resolve = host => dns.resolve4(host), checkCertificate = certificate, now = Date.now }) {
  let active, timer, snapshot = { status: 'starting', checkedAt: null, checks: {} };
  async function tick() {
    if (active) return active;
    active = (async () => {
      const checks = {};
      async function check(name, fn) {
        let timeout;
        try {
          const details = await Promise.race([fn(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('CHECK_TIMEOUT')), 12000);
          })]);
          checks[name] = { status: 'ok', ...details };
        }
        catch (error) { checks[name] = { status: 'error', code: String(error.code || error.message || 'unavailable').slice(0, 120) }; }
        finally { clearTimeout(timeout); }
      }
      const origin = new URL(env.SERVER_URL);
      const apiBase = env.KYC_API_URL.replace(/\/$/, '').replace(/\/search$/, '');
      await Promise.all([
        check('database', async () => { await repository.pool.query({ sql: 'SELECT 1', timeout: 5000 }); }),
        check('dns', async () => { const ips = await resolve(origin.hostname); if (!ips.length) throw new Error('DNS_EMPTY'); return { addresses: ips }; }),
        check('tls', async () => { const cert = await checkCertificate(origin.hostname); const days = Math.floor((Date.parse(cert.expiresAt) - now()) / 86400000); if (!Number.isFinite(days) || days < 14) throw new Error(`TLS_EXPIRES_${days}_DAYS`); return { daysRemaining: days }; }),
        check('twilio', async () => { const account = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch(); if (account.status !== 'active') throw new Error(`ACCOUNT_${account.status}`); return { status: 'ok' }; }),
        check('kyc', async () => {
          const response = await axios.get(env.KYC_HEALTH_URL || `${apiBase}/search-multiple/stats`, { timeout: 8000, maxRedirects: 0, headers: { 'X-API-Key': env.KYC_API_KEY } });
          if (!response.data || typeof response.data !== 'object' || response.data.err === true || response.data.status === 'error') throw new Error('KYC_UNHEALTHY');
        }),
        check('public_http', async () => { const response = await axios.get(`${origin.origin}/live`, { timeout: 8000, maxRedirects: 0 }); if (response.data?.service !== 'kyc-whatsapp-bot') throw new Error('PUBLIC_ROUTE_INVALID'); }),
        check('worker', async () => {
          const [[row]] = await repository.pool.query("SELECT updated_at FROM bot_runtime WHERE name='worker'");
          if (!row || now() - new Date(row.updated_at).getTime() > 120000) throw new Error('WORKER_STALE');
          const [[queue]] = await repository.pool.query("SELECT COUNT(*) AS pending,MIN(created_at) AS oldest FROM bot_jobs WHERE status IN ('pending','processing')");
          if (queue.oldest && now() - new Date(queue.oldest).getTime() > 300000) throw new Error('QUEUE_DELAY');
          return { pending: queue.pending };
        })
      ]);
      snapshot = { status: Object.values(checks).some(c => c.status !== 'ok') ? 'degraded' : 'ok', checkedAt: new Date(now()).toISOString(), checks };
      // Alertas locales: ni correos ni webhooks externos.
      for (const [name, result] of Object.entries(checks)) {
        const key = `health:${name}`;
        try {
          if (result.status === 'ok') {
            if (await repository.resolveAlert(key)) log(`RECUPERADO ${name}`);
          }
          else await repository.alert(key, 'critical', `${name}: ${result.code}`);
        } catch { log(`MONITOR ${name}: ${result.status} ${result.code || ''}`, result.status === 'ok' ? 'INFO' : 'ERROR'); }
      }
      try {
        await repository.runtime('health', snapshot);
        const [alerts] = await repository.pool.query('SELECT * FROM bot_alerts WHERE active=1 AND (notified_at IS NULL OR notified_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))');
        for (const alert of alerts) {
          log(`ALERTA [${alert.severity}] ${alert.alert_key}: ${alert.message}`, 'ERROR');
          await repository.pool.execute('UPDATE bot_alerts SET notified_at=UTC_TIMESTAMP(3) WHERE alert_key=?', [alert.alert_key]);
        }
      } catch (error) { log(`No se pudo persistir monitoreo: ${error.code || error.name}`, 'ERROR'); }
      return snapshot;
    })().finally(() => { active = null; });
    return active;
  }
  return {
    tick,
    snapshot() {
      if (!snapshot.checkedAt || now() - Date.parse(snapshot.checkedAt) > 360000) return { ...snapshot, status: 'stale' };
      return snapshot;
    },
    start() { void tick().catch(e => log(`Monitor: ${e.message}`, 'ERROR')); timer = setInterval(() => void tick().catch(e => log(`Monitor: ${e.message}`, 'ERROR')), 60000); },
    async stop() { clearInterval(timer); if (active) await active; }
  };
}
module.exports = { createMonitor, certificate };
