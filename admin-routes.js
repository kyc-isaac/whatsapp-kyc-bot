const express = require('express');
const bcrypt = require('bcryptjs');
const { parseUserInput } = require('./user-validation');
const { pagination } = require('./lib/pagination');
const { quotaDay, phoneKey } = require('./lib/repository');
function createAdminRoutes({ pool, repository, security, monitor }) {
  const router = express.Router();
  router.post('/login', security.login);
  router.use(security.requireAdmin);
  router.get('/session', (req, res) => res.json({ success: true, authenticated: true, username: req.admin.username, role: req.admin.role, csrfToken: req.session.csrf, loginTime: req.session.loginTime }));
  router.post('/logout', (req, res, next) => req.session.destroy(error => { if (error) return next(error); res.clearCookie('connect.sid'); res.json({ success: true }); }));
  router.get('/users', async (req, res) => {
    const { page, pageSize, offset } = pagination(req.query);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 150) : '';
    const pattern = '%' + q.replace(/[!%_]/g, '!$&') + '%';
    const where = q ? "WHERE full_name LIKE ? ESCAPE '!' OR phone_number LIKE ? ESCAPE '!' OR company LIKE ? ESCAPE '!'" : '';
    const params = q ? [pattern, pattern, pattern] : [];
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM authorized_users ${where}`, params);
    const [users] = await pool.query(`SELECT id,phone_number,full_name,company,is_active,search_limit,total_queries,last_access,ine_ocr_enabled,created_at,updated_at FROM authorized_users ${where} ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
    res.json({ users, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  });
  router.post('/users', async (req, res) => {
    const user = parseUserInput(req.body);
    if (user.error) return res.status(400).json({ error: user.error });
    const [row] = await pool.execute('INSERT INTO authorized_users (phone_number,full_name,company,is_active,search_limit,ine_ocr_enabled) VALUES (?,?,?,?,?,?)', [user.phone,user.name,user.company,user.active,user.limit,user.ocr]);
    await security.audit(req.admin.id, 'user_create', row.insertId);
    res.json({ id: row.insertId, message: 'Usuario creado' });
  });
  router.put('/users/:id', async (req, res) => {
    const user = parseUserInput(req.body);
    if (user.error || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: user.error || 'ID inválido' });
    const [row] = await pool.execute('UPDATE authorized_users SET phone_number=?,full_name=?,company=?,is_active=?,search_limit=?,ine_ocr_enabled=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [user.phone,user.name,user.company,user.active,user.limit,user.ocr,req.params.id]);
    if (!row.affectedRows) return res.sendStatus(404);
    await security.audit(req.admin.id, 'user_update', req.params.id);
    res.json({ message: 'Usuario actualizado' });
  });
  router.delete('/users/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(400);
    const [row] = await pool.execute('DELETE FROM authorized_users WHERE id=?', [req.params.id]);
    if (!row.affectedRows) return res.sendStatus(404);
    await security.audit(req.admin.id, 'user_delete', req.params.id);
    res.json({ message: 'Usuario eliminado' });
  });
  router.get('/stats', async (req, res) => {
    const [[users]] = await pool.query('SELECT COUNT(*) AS totalUsers,COALESCE(SUM(last_access>=UTC_DATE()),0) AS activeToday FROM authorized_users');
    const [[searches]] = await pool.query("SELECT COUNT(*) AS totalQueries FROM bot_searches WHERE status='succeeded'");
    const [[blocked]] = await pool.query('SELECT COUNT(*) AS blockedToday FROM blocked_attempts WHERE attempt_time>=UTC_DATE()');
    res.json({ ...users, ...searches, ...blocked });
  });
  router.get('/user-limits', async (req, res) => {
    const [rows] = await pool.execute("SELECT u.phone_number,u.search_limit,c.updated_at AS lastActivity,(c.expires_at>UTC_TIMESTAMP(3)) AS isActive,COALESCE(s.used,0) AS todaySearches FROM authorized_users u LEFT JOIN bot_conversations c ON c.phone=u.phone_number LEFT JOIN (SELECT phone,COUNT(*) AS used FROM bot_searches WHERE quota_day=? AND status IN ('running','succeeded','uncertain') GROUP BY phone) s ON s.phone=u.phone_number ORDER BY u.id DESC", [quotaDay()]);
    res.json({ success: true, users: rows.map(row => ({ phoneNumber: row.phone_number, dailyLimit: row.search_limit === -1 ? 'Ilimitado' : row.search_limit, todaySearches: row.todaySearches, isActive: Boolean(row.isActive), lastActivity: row.lastActivity })) });
  });
  router.post('/set-user-limit', async (req, res) => {
    const limit = req.body.limit === 'unlimited' ? -1 : Number(req.body.limit);
    const phone = phoneKey(req.body.phoneNumber || '');
    if (!/^\+\d{7,15}$/.test(phone) || !['string','number'].includes(typeof req.body.limit) || String(req.body.limit).trim() === '' || !Number.isSafeInteger(limit) || limit < -1 || limit > 2147483647) return res.status(400).json({ error: 'Teléfono o límite inválido' });
    const [row] = await pool.execute('UPDATE authorized_users SET search_limit=? WHERE phone_number=?', [limit,phone]);
    if (!row.affectedRows) return res.sendStatus(404);
    await security.audit(req.admin.id, 'limit_update', phone);
    res.json({ success: true, message: 'Límite actualizado' });
  });
  router.get('/search-stats', async (req, res) => {
    const [rows] = await pool.execute("SELECT s.phone AS user,COUNT(*) AS searches,u.search_limit AS dailyLimit FROM bot_searches s LEFT JOIN authorized_users u ON u.phone_number=s.phone WHERE s.quota_day=? AND s.status IN ('running','succeeded','uncertain') GROUP BY s.phone,u.search_limit", [quotaDay()]);
    const [[active]] = await pool.query('SELECT COUNT(*) AS count FROM bot_conversations WHERE expires_at>UTC_TIMESTAMP(3)');
    const breakdown = rows.map(r => ({ ...r, limit: r.dailyLimit === -1 ? 'Ilimitado' : r.dailyLimit, reachedLimit: r.dailyLimit !== -1 && r.searches >= r.dailyLimit }));
    res.json({ success: true, date: quotaDay(), stats: { totalUsersToday: rows.length, totalSearchesToday: rows.reduce((n,r) => n+r.searches,0), activeUsers: active.count, limitReachedUsers: breakdown.filter(r => r.reachedLimit).length, userBreakdown: breakdown } });
  });
  router.get('/operations', async (req, res) => {
    const [alerts] = await pool.query('SELECT * FROM bot_alerts ORDER BY active DESC,last_seen DESC LIMIT 100');
    const [jobs] = await pool.query("SELECT id,message_sid,status,attempts,last_error,created_at FROM bot_jobs WHERE status<>'done' ORDER BY id DESC LIMIT 100");
    const [messages] = await pool.query('SELECT id,message_sid,remote_sid,status,error_code,attempts,created_at FROM bot_outbox ORDER BY created_at DESC,position DESC LIMIT 100');
    const [searches] = await pool.query("SELECT message_sid,status,error_code,created_at FROM bot_searches WHERE status='uncertain' ORDER BY created_at DESC LIMIT 100");
    res.json({ health: monitor.snapshot(), alerts, jobs, messages, searches });
  });
  router.post('/operations/check', security.requireOwner, async (req,res) => res.json(await monitor.tick()));
  router.post('/jobs/:id/retry', security.requireOwner, async (req,res) => {
    const [row] = await pool.execute("UPDATE bot_jobs SET status='pending',attempts=0,available_at=UTC_TIMESTAMP(3) WHERE id=? AND status='failed'", [req.params.id]);
    if (!row.affectedRows) return res.status(409).json({ message: 'Solo se recuperan trabajos fallidos' });
    await repository.resolveAlert(`job:${req.params.id}`);
    await security.audit(req.admin.id, 'job_retry', req.params.id);
    res.json({ success: true });
  });
  router.post('/jobs/:id/discard', security.requireOwner, async (req,res) => {
    const [row] = await pool.execute("UPDATE bot_jobs SET status='cancelled',payload=?,last_error='DISCARDED' WHERE id=? AND status='failed'", [repository.crypto.encrypt({}), req.params.id]);
    if (!row.affectedRows) return res.status(409).json({ message: 'Solo se descartan trabajos fallidos' });
    await repository.resolveAlert(`job:${req.params.id}`);
    await security.audit(req.admin.id, 'job_discard', req.params.id);
    res.json({ success: true });
  });
  router.post('/messages/:id/retry', security.requireOwner, async (req,res) => {
    const [row] = await pool.execute("UPDATE bot_outbox SET status='pending',attempts=0,available_at=UTC_TIMESTAMP(3) WHERE id=? AND status='failed' AND remote_sid IS NULL AND error_code<>'WINDOW_EXPIRED' AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 23 HOUR)", [req.params.id]);
    if (!row.affectedRows) return res.status(409).json({ message: 'Solo se reintentan envíos rechazados sin SID; un envío incierto requiere revisar Twilio' });
    await repository.resolveAlert(`outbox:${req.params.id}`);
    await security.audit(req.admin.id, 'outbox_retry', req.params.id);
    res.json({ success: true });
  });
  router.post('/reports/:id/revoke', async (req,res) => {
    const [row] = await pool.execute('UPDATE bot_reports SET revoked=1 WHERE id=?', [req.params.id]);
    if (!row.affectedRows) return res.sendStatus(404);
    await security.audit(req.admin.id, 'report_revoke', req.params.id);
    res.json({ success: true });
  });
  router.get('/reports', async (req,res) => {
    const { page,pageSize,offset } = pagination(req.query);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM bot_reports');
    const [reports] = await pool.query(`SELECT id,phone,expires_at,revoked,created_at FROM bot_reports ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
    res.json({ reports,total,page,pageSize });
  });
  router.get('/admins', security.requireOwner, async (req,res) => {
    const [admins] = await pool.query('SELECT id,username,role,active,created_at FROM bot_admins ORDER BY id');
    res.json({ admins });
  });
  router.post('/admins', security.requireOwner, async (req,res) => {
    const { username,password,role = 'admin' } = req.body;
    if (typeof username !== 'string' || !/^[a-z0-9_.@-]{3,80}$/i.test(username) || !security.validPassword(password) || !['owner','admin'].includes(role)) return res.status(400).json({ message: 'Usuario inválido o contraseña menor a 12 caracteres / mayor a 72 bytes' });
    const hash = await bcrypt.hash(password,12);
    const [row] = await pool.execute('INSERT INTO bot_admins (username,password_hash,role) VALUES (?,?,?)', [username.toLowerCase(),hash,role]);
    await security.audit(req.admin.id,'admin_create',row.insertId);
    res.json({ id: row.insertId });
  });
  router.patch('/admins/:id', security.requireOwner, async (req,res) => {
    const { active,role,password } = req.body;
    if ((active !== undefined && typeof active !== 'boolean') || (role !== undefined && !['owner','admin'].includes(role)) || (password !== undefined && !security.validPassword(password))) return res.sendStatus(400);
    const hash = password ? await bcrypt.hash(password,12) : null;
    await repository.transaction(async db => {
      const [owners] = await db.query("SELECT id FROM bot_admins WHERE role='owner' AND active=1 ORDER BY id FOR UPDATE");
      const [[target]] = await db.execute('SELECT * FROM bot_admins WHERE id=? FOR UPDATE',[req.params.id]);
      if (!target) throw Object.assign(new Error('No encontrado'),{ status:404 });
      if (target.role==='owner' && target.active && owners.length===1 && (active===false || role==='admin')) throw Object.assign(new Error('Se requiere al menos un propietario activo'),{ status:409 });
      await db.execute('UPDATE bot_admins SET active=?,role=?,password_hash=?,session_version=session_version+1 WHERE id=?',[active ?? target.active,role || target.role,hash || target.password_hash,target.id]);
    });
    await security.audit(req.admin.id,'admin_update',req.params.id);
    res.json({ success:true });
  });
  router.post('/password', async (req,res) => {
    if (!security.validPassword(req.body.password) || typeof req.body.currentPassword !== 'string' || Buffer.byteLength(req.body.currentPassword)>72) return res.status(400).json({ message:'Contraseña inválida: usa al menos 12 caracteres y hasta 72 bytes' });
    const [[user]] = await pool.execute('SELECT password_hash FROM bot_admins WHERE id=?',[req.admin.id]);
    if (!await bcrypt.compare(req.body.currentPassword,user.password_hash)) return res.sendStatus(403);
    await pool.execute('UPDATE bot_admins SET password_hash=?,session_version=session_version+1 WHERE id=?',[await bcrypt.hash(req.body.password,12),req.admin.id]);
    await security.audit(req.admin.id,'password_change',req.admin.id);
    req.session.destroy(() => {});
    res.json({ success:true });
  });
  router.use((error,req,res,next) => {
    if (error.code==='ER_DUP_ENTRY') return res.status(409).json({ error:'El registro ya existe',message:'El registro ya existe' });
    next(error);
  });
  return router;
}
module.exports = { createAdminRoutes };
