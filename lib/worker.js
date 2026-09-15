const { createBot } = require('../bot-flow');
function createWorker({ repository, services, twilioClient, reports, publicUrl, log, intervalMs = 500 }) {
  let stopped = true, timer, active;
  async function incoming() {
    await repository.withLock(':incoming', async () => {
      const job = await repository.nextJob();
      if (!job) return;
      if (Date.now() - new Date(job.created_at).getTime() > 23 * 3600000) {
        await repository.pool.execute("UPDATE bot_jobs SET status='cancelled',last_error='WINDOW_EXPIRED' WHERE id=?", [job.id]);
        await repository.alert(`job:${job.id}`, 'warning', `Mensaje ${job.message_sid} vencido; no se ejecutaron consultas pendientes.`);
        return;
      }
      const outputs = [], summaries = [];
      const bot = createBot({ ...services, durable: true,
        send: async (to, body, mediaUrl) => { outputs.push({ to, body, mediaUrl: mediaUrl || null }); },
        loadSession: phone => repository.loadSession(phone),
        getHistory: phone => repository.history(phone),
        recordHistory: async entry => { summaries.push(entry); },
        canSearch: async phone => {
          const quota = await repository.quota(phone);
          // Recuperar una reserva existente no consume otra consulta del límite.
          const [[reserved]] = await repository.pool.execute('SELECT id FROM bot_searches WHERE message_sid=?', [job.message_sid]);
          return { ...quota, canSearch: quota.canSearch || Boolean(reserved) };
        }, countSearch: async () => {}, syncLimit: () => {},
        search: (query, meta) => repository.executeSearch(query, meta, services.search),
        readIne: (front, back) => repository.executeEffect('ocr', job.message_sid, () => services.readIne(front, back)),
        savePdf: (base64, meta) => reports.save(base64, meta),
        // La respuesta de rechazo también debe formar parte de la transacción del trabajo.
        reject: async from => {
          const body = await services.rejectionMessage(from);
          if (body) outputs.push({ to: from, body, mediaUrl: null });
        }, log
      });
      try {
        job.body = repository.crypto.decrypt(job.payload);
        await bot.handleMessage(job.body);
        await repository.finishJob(job, bot.sessions.get(job.body.From), outputs, summaries);
      } catch (error) { await repository.failJob(job, error); log(`Trabajo ${job.message_sid}: ${error.code || error.name}`, 'ERROR'); }
    });
  }
  async function outgoing() {
    await repository.withLock(':outgoing', async () => {
      // `sending` bajo un lock nuevo solo puede ser un envío interrumpido antes de guardar el SID.
      const [interrupted] = await repository.pool.query("SELECT id FROM bot_outbox WHERE status='sending'");
      for (const row of interrupted) {
        await repository.pool.execute("UPDATE bot_outbox SET status='uncertain',updated_at=UTC_TIMESTAMP(3) WHERE id=?", [row.id]);
        await repository.alert(`outbox:${row.id}`, 'warning', `Envío ${row.id} interrumpido; se espera confirmación de Twilio. No se reenvió automáticamente.`);
      }
      const [[row]] = await repository.pool.query("SELECT o.* FROM bot_outbox o JOIN bot_jobs j ON j.message_sid=o.message_sid WHERE o.status='pending' AND o.available_at<=UTC_TIMESTAMP(3) AND NOT EXISTS (SELECT 1 FROM bot_outbox earlier JOIN bot_jobs previous ON previous.message_sid=earlier.message_sid WHERE earlier.phone=o.phone AND (previous.id<j.id OR (previous.id=j.id AND earlier.position<o.position)) AND earlier.status IN ('pending','sending')) ORDER BY j.id,o.position LIMIT 1");
      if (!row) return;
      if (Date.now() - new Date(row.created_at).getTime() > 23 * 3600000) {
        await repository.pool.execute("UPDATE bot_outbox SET status='failed',error_code='WINDOW_EXPIRED' WHERE id=?", [row.id]);
        await repository.alert(`outbox:${row.id}`, 'warning', 'No se envió una respuesta pendiente porque venció la ventana de atención.');
        return;
      }
      await repository.pool.execute("UPDATE bot_outbox SET status='sending',attempts=attempts+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [row.id]);
      let response;
      try {
        const data = repository.crypto.decrypt(row.payload);
        response = await twilioClient.messages.create({ from: services.senderNumber, to: data.to, body: data.body,
          ...(data.mediaUrl ? { mediaUrl: [data.mediaUrl] } : {}),
          statusCallback: `${publicUrl.replace(/\/$/, '')}/webhook/status?outbox=${row.id}` });
      } catch (error) {
        // HTTP 4xx confirma rechazo. Errores de red/5xx pueden haber creado el mensaje.
        const rejected = error.status >= 400 && error.status < 500;
        const retry = error.status === 429 && row.attempts < 4;
        const status = retry ? 'pending' : rejected ? 'failed' : 'uncertain';
        await repository.pool.execute('UPDATE bot_outbox SET status=?,error_code=?,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status=\'sending\'',
          [status, String(error.code || error.status || 'TRANSPORT').slice(0, 80), row.id]);
        if (!retry) await repository.alert(`outbox:${row.id}`, 'critical', `Envío ${row.id}: ${status}, código ${error.code || error.status || 'TRANSPORT'}.`);
        return;
      }
      // Un callback puede haber llegado antes de guardar la respuesta de creación.
      await repository.pool.execute("UPDATE bot_outbox SET remote_sid=COALESCE(remote_sid,?),status=IF(status='sending','accepted',status),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [response.sid, row.id]);
      log(`Respuesta aceptada por Twilio: ${response.sid}`);
    });
  }
  async function tick() {
    if (active) return active;
    active = (async () => {
      // Las respuestas anteriores no esperan a que termine el siguiente OCR.
      const results = await Promise.allSettled([incoming(), outgoing()]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      await repository.runtime('worker', { status: 'ok', checkedAt: new Date().toISOString() });
    })().catch(error => { log(`Worker: ${error.code || error.name}`, 'ERROR'); }).finally(() => { active = null; });
    return active;
  }
  return {
    tick,
    start() {
      stopped = false;
      const loop = async () => { if (stopped) return; await tick(); if (!stopped) timer = setTimeout(loop, intervalMs); };
      void loop();
    },
    async stop() { stopped = true; clearTimeout(timer); if (active) await active; }
  };
}
module.exports = { createWorker };
