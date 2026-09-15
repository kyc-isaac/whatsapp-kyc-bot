const { randomUUID, createHash } = require('crypto');
const phoneKey = phone => String(phone).replace(/^whatsapp:/, '');
const quotaDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(date);
const RETAINED_STATUSES = "('running', 'succeeded', 'uncertain')";
class Repository {
  constructor(pool, crypto) { this.pool = pool; this.crypto = crypto; }
  async transaction(fn) {
    const db = await this.pool.getConnection();
    try { await db.beginTransaction(); const result = await fn(db); await db.commit(); return result; }
    catch (error) { await db.rollback(); throw error; }
    finally { db.release(); }
  }
  async withLock(name, fn) {
    const db = await this.pool.getConnection();
    let acquired = false;
    try {
      const [[row]] = await db.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ?), 256), 0) AS acquired", [name]);
      acquired = row.acquired === 1;
      if (acquired) return await fn();
    } finally {
      try { if (acquired) await db.query('SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ?), 256))', [name]); }
      finally { db.release(); }
    }
  }
  async enqueue(payload) {
    const [result] = await this.pool.execute('INSERT IGNORE INTO bot_jobs (message_sid, phone, payload) VALUES (?, ?, ?)',
      [payload.MessageSid, phoneKey(payload.From), this.crypto.encrypt(payload)]);
    return result.affectedRows > 0;
  }
  async nextJob() {
    const [rows] = await this.pool.query("SELECT j.* FROM bot_jobs j WHERE j.status IN ('pending','processing') AND j.available_at <= UTC_TIMESTAMP(3) AND NOT EXISTS (SELECT 1 FROM bot_jobs earlier WHERE earlier.phone=j.phone AND earlier.id<j.id AND earlier.status IN ('pending','processing','failed')) ORDER BY j.id LIMIT 1");
    if (!rows.length) return null;
    await this.pool.execute("UPDATE bot_jobs SET status='processing', attempts=attempts+1, updated_at=UTC_TIMESTAMP(3) WHERE id=?", [rows[0].id]);
    return rows[0];
  }
  async failJob(job, error) {
    const attempts = job.attempts + 1;
    const status = attempts >= 5 ? 'failed' : 'pending';
    await this.pool.execute('UPDATE bot_jobs SET status=?, available_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), last_error=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [status, Math.min(300, 2 ** attempts), String(error.code || error.name || 'worker_error').slice(0, 200), job.id]);
    if (status === 'failed') await this.alert(`job:${job.id}`, 'critical', `No se pudo procesar el mensaje ${job.message_sid}. Requiere revisión.`);
  }
  async loadSession(phone) {
    const [rows] = await this.pool.execute('SELECT data FROM bot_conversations WHERE phone=? AND expires_at > UTC_TIMESTAMP(3)', [phoneKey(phone)]);
    if (!rows.length) return null;
    const s = this.crypto.decrypt(rows[0].data);
    s.lastActivity = new Date(s.lastActivity);
    if (s.result?.pdfUrl) {
      let id;
      try { id = new URL(s.result.pdfUrl).pathname.split('/').pop(); } catch { id = ''; }
      const [[report]] = await this.pool.execute('SELECT id FROM bot_reports WHERE id=? AND phone=? AND revoked=0 AND expires_at>UTC_TIMESTAMP(3)', [id, phoneKey(phone)]);
      if (!report) s.result.pdfUrl = null;
    }
    return s;
  }
  async history(phone) {
    const [rows] = await this.pool.execute("SELECT s.summary,r.id AS report_id,r.revoked,r.expires_at FROM bot_searches s LEFT JOIN bot_reports r ON r.message_sid=s.message_sid WHERE s.phone=? AND s.status='succeeded' AND s.summary IS NOT NULL ORDER BY s.completed_at DESC,s.id DESC LIMIT 10", [phoneKey(phone)]);
    return rows.map(row => {
      const entry = this.crypto.decrypt(row.summary);
      if (!row.report_id || row.revoked || new Date(row.expires_at).getTime() <= Date.now()) entry.pdfUrl = null;
      return entry;
    });
  }
  async finishJob(job, session, outputs, summaries) {
    await this.transaction(async db => {
      if (session) {
        const { user, history, messageId, ...saved } = session;
        await db.execute('INSERT INTO bot_conversations (phone,data,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 6 HOUR)) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at),updated_at=UTC_TIMESTAMP(3)',
          [job.phone, this.crypto.encrypt(saved)]);
      } else await db.execute('DELETE FROM bot_conversations WHERE phone=?', [job.phone]);
      for (const [i, output] of outputs.entries()) {
        await db.execute('INSERT IGNORE INTO bot_outbox (id,message_sid,position,phone,payload) VALUES (?,?,?,?,?)',
          [randomUUID(), job.message_sid, i, job.phone, this.crypto.encrypt(output)]);
      }
      for (const summary of summaries) {
        await db.execute('UPDATE bot_searches SET summary=? WHERE message_sid=?', [this.crypto.encrypt(summary), job.message_sid]);
      }
      await db.execute("UPDATE bot_jobs SET status='done',payload=?,last_error=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [this.crypto.encrypt({}), job.id]);
      // Ya no se necesita guardar la respuesta completa ni su PDF en base64 para repetir el trabajo.
      await db.execute("UPDATE bot_searches SET result=NULL WHERE message_sid=? AND status='succeeded'", [job.message_sid]);
      await db.execute('UPDATE bot_effects SET result=NULL WHERE message_sid=?', [job.message_sid]);
    });
  }
  async quota(phone) {
    const key = phoneKey(phone);
    const [[user]] = await this.pool.execute('SELECT search_limit FROM authorized_users WHERE phone_number=? AND is_active=1', [key]);
    if (!user) return { canSearch: false, current: 0, max: 0 };
    const [[row]] = await this.pool.execute(`SELECT COUNT(*) AS used FROM bot_searches WHERE phone=? AND quota_day=? AND status IN ${RETAINED_STATUSES}`, [key, quotaDay()]);
    return { canSearch: user.search_limit === -1 || row.used < user.search_limit, current: row.used, max: user.search_limit };
  }
  async executeSearch(query, { from, messageId }, perform) {
    const reserved = await this.transaction(async db => {
      const [[user]] = await db.execute('SELECT id,search_limit FROM authorized_users WHERE phone_number=? AND is_active=1 FOR UPDATE', [phoneKey(from)]);
      if (!user) return { denied: true };
      const [[existing]] = await db.execute('SELECT status,result FROM bot_searches WHERE message_sid=? FOR UPDATE', [messageId]);
      if (existing) return { existing };
      const [[count]] = await db.execute(`SELECT COUNT(*) AS used FROM bot_searches WHERE phone=? AND quota_day=? AND status IN ${RETAINED_STATUSES}`, [phoneKey(from), quotaDay()]);
      if (user.search_limit !== -1 && count.used >= user.search_limit) return { denied: true };
      await db.execute("INSERT INTO bot_searches (id,message_sid,phone,quota_day,status,query) VALUES (?,?,?,?,'running',?)",
        [randomUUID(), messageId, phoneKey(from), quotaDay(), this.crypto.encrypt(query)]);
      return { userId: user.id };
    });
    if (reserved.denied) return { err: true, quota: true };
    if (reserved.existing) {
      if (reserved.existing.status === 'succeeded' && reserved.existing.result) return this.crypto.decrypt(reserved.existing.result);
      if (reserved.existing.status === 'failed') return { err: true };
      await this.pool.execute("UPDATE bot_searches SET status='uncertain' WHERE message_sid=? AND status='running'", [messageId]);
      await this.alert(`search:${messageId}`, 'warning', `Resultado incierto de la consulta ${messageId}. No se repitió automáticamente.`);
      return { err: true, uncertain: true };
    }
    let result;
    try { result = await perform(query); }
    catch (error) { result = { err: true, uncertain: true, code: error.code || 'transport' }; }
    const ok = result && !result.err && Number.isInteger(result.coincidences) && result.coincidences >= 0;
    const status = ok ? 'succeeded' : result?.uncertain ? 'uncertain' : 'failed';
    await this.transaction(async db => {
      await db.execute('UPDATE bot_searches SET status=?,result=?,error_code=?,completed_at=UTC_TIMESTAMP(3) WHERE message_sid=?',
        [status, ok ? this.crypto.encrypt(result) : null, String(result?.code || '').slice(0, 80), messageId]);
      if (ok) await db.execute('UPDATE authorized_users SET total_queries=total_queries+1 WHERE id=?', [reserved.userId]);
    });
    if (status === 'uncertain') await this.alert(`search:${messageId}`, 'warning', `Resultado incierto de la consulta ${messageId}; revisa el proveedor antes de repetirla.`);
    return ok ? result : { err: true, uncertain: status === 'uncertain' };
  }
  async executeEffect(kind, messageId, perform) {
    const [[existing]] = await this.pool.execute('SELECT status,result FROM bot_effects WHERE message_sid=? AND kind=?', [messageId, kind]);
    if (existing?.result) return this.crypto.decrypt(existing.result);
    if (existing) {
      await this.pool.execute("UPDATE bot_effects SET status='uncertain' WHERE message_sid=? AND kind=?", [messageId, kind]);
      await this.alert(`effect:${messageId}`, 'warning', `Operación ${kind} interrumpida: ${messageId}. No se repitió automáticamente.`);
      return { err: true, uncertain: true };
    }
    await this.pool.execute("INSERT INTO bot_effects (message_sid,kind,status) VALUES (?,?,'running')", [messageId, kind]);
    let result;
    try { result = await perform(); }
    catch { result = { err: true, uncertain: true }; }
    result ||= { err: true };
    await this.pool.execute('UPDATE bot_effects SET status=?,result=? WHERE message_sid=? AND kind=?',
      [result.uncertain ? 'uncertain' : result.err ? 'failed' : 'succeeded', this.crypto.encrypt(result), messageId, kind]);
    if (result.uncertain) await this.alert(`effect:${messageId}`, 'warning', `Resultado incierto de ${kind}: ${messageId}. Revisa el proveedor antes de repetir.`);
    return result;
  }
  async alert(key, severity, message) {
    await this.pool.execute('INSERT INTO bot_alerts (alert_key,severity,message) VALUES (?,?,?) ON DUPLICATE KEY UPDATE severity=VALUES(severity),message=VALUES(message),notified_at=IF(active=0,NULL,notified_at),active=1,resolved_at=NULL,last_seen=UTC_TIMESTAMP(3)', [key, severity, message]);
  }
  async resolveAlert(key) {
    const [result] = await this.pool.execute('UPDATE bot_alerts SET active=0,resolved_at=UTC_TIMESTAMP(3) WHERE alert_key=? AND active=1', [key]);
    return result.affectedRows > 0;
  }
  async runtime(name, data) {
    await this.pool.execute('INSERT INTO bot_runtime (name,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=UTC_TIMESTAMP(3)', [name, JSON.stringify(data)]);
  }
  async delivery(outboxId, sid, status, errorCode) {
    const rank = { pending: 0, sending: 1, uncertain: 1, accepted: 2, queued: 3, sending_remote: 4, sent: 5, failed: 6, undelivered: 6, delivered: 7, read: 8 };
    if (!['accepted','queued','sending','sent','failed','undelivered','delivered','read'].includes(status)) return;
    const hash = createHash('sha256').update(`${sid}:${status}:${errorCode || ''}`).digest('hex');
    await this.transaction(async db => {
      const [[row]] = await db.execute('SELECT * FROM bot_outbox WHERE id=? OR remote_sid=? LIMIT 1 FOR UPDATE', [outboxId || '', sid]);
      if (!row || (row.remote_sid && row.remote_sid !== sid)) return;
      await db.execute('INSERT IGNORE INTO bot_delivery_events (event_hash,outbox_id,remote_sid,status,error_code) VALUES (?,?,?,?,?)', [hash, row.id, sid, status, errorCode || null]);
      const newStatus = status === 'sending' ? 'sending_remote' : status;
      if ((rank[newStatus] || 0) >= (rank[row.status] || 0)) {
        await db.execute('UPDATE bot_outbox SET status=?,remote_sid=?,error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [newStatus, sid, errorCode || null, row.id]);
      }
    });
    if (errorCode || ['failed','undelivered'].includes(status)) await this.alert(`delivery:${sid}`, 'warning', `Mensaje ${sid}: ${status}, código ${errorCode || 'no informado'}.`);
    else if (['delivered','read'].includes(status)) {
      await this.resolveAlert(`delivery:${sid}`);
      if (outboxId) await this.resolveAlert(`outbox:${outboxId}`);
    }
  }
}
module.exports = { Repository, phoneKey, quotaDay };
