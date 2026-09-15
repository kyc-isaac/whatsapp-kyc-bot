const session = require('express-session');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const { sign } = require('./crypto');
class MySQLSessionStore extends session.Store {
  constructor(pool, crypto) { super(); this.pool = pool; this.crypto = crypto; }
  get(sid, callback) {
    this.pool.execute('SELECT data FROM bot_admin_sessions WHERE sid=? AND expires_at>UTC_TIMESTAMP(3)', [sid])
      .then(([rows]) => callback(null, rows.length ? this.crypto.decrypt(rows[0].data) : null)).catch(callback);
  }
  set(sid, data, callback = () => {}) {
    const expires = data.cookie?.expires ? new Date(data.cookie.expires) : new Date(Date.now() + 86400000);
    this.pool.execute('INSERT INTO bot_admin_sessions (sid,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)', [sid, this.crypto.encrypt(data), expires])
      .then(() => callback()).catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.pool.execute('DELETE FROM bot_admin_sessions WHERE sid=?', [sid]).then(() => callback()).catch(callback);
  }
  touch(sid, data, callback = () => {}) {
    this.pool.execute('UPDATE bot_admin_sessions SET expires_at=? WHERE sid=?', [new Date(data.cookie.expires), sid]).then(() => callback()).catch(callback);
  }
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 72;
}
function createAdminSecurity({ pool, secret, publicUrl }) {
  // Hash válido para que una cuenta inexistente también ejecute la comparación bcrypt.
  const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
  async function audit(adminId, action, target) {
    await pool.execute('INSERT INTO bot_audit (admin_id,action,target) VALUES (?,?,?)', [adminId || null, action, String(target || '').slice(0, 100)]);
  }
  function sameOrigin(req) {
    if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
    return !req.get('Origin') || req.get('Origin') === new URL(publicUrl).origin;
  }
  async function login(req, res) {
    if (!sameOrigin(req)) return res.sendStatus(403);
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!/^[a-z0-9_.@-]{3,80}$/.test(username) || typeof password !== 'string' || Buffer.byteLength(password) > 72) return res.status(400).json({ message: 'Credenciales inválidas' });
    const buckets = [sign(secret, `login:user:${username}`), sign(secret, `login:ip:${req.ip}`)];
    // Incremento atómico antes de comparar: no permite saltar el límite con peticiones simultáneas.
    for (const bucket of buckets) {
      await pool.execute('INSERT INTO bot_login_limits (bucket,attempts,window_start) VALUES (?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE attempts=IF(window_start<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),1,attempts+1),window_start=IF(window_start<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),UTC_TIMESTAMP(3),window_start)', [bucket]);
    }
    const [limits] = await pool.query('SELECT bucket,attempts FROM bot_login_limits WHERE bucket IN (?,?)', buckets);
    if (limits.some(row => row.attempts > (row.bucket === buckets[0] ? 5 : 30))) {
      res.set('Retry-After', '900');
      return res.status(429).json({ message: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
    }
    const [[user]] = await pool.execute('SELECT * FROM bot_admins WHERE username=?', [username]);
    const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);
    if (!valid || !user?.active) {
      await audit(user?.id, 'login_failed', username);
      return res.status(401).json({ message: 'Usuario o contraseña incorrectos' });
    }
    await pool.execute('DELETE FROM bot_login_limits WHERE bucket=?', [buckets[0]]);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    Object.assign(req.session, { authenticated: true, adminId: user.id, version: user.session_version,
      username: user.username, role: user.role, loginTime: new Date().toISOString(), csrf: randomBytes(32).toString('hex') });
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    await audit(user.id, 'login', user.username);
    res.json({ success: true, user: user.username });
  }
  async function requireAdmin(req, res, next) {
    const [[user]] = req.session?.adminId ? await pool.execute('SELECT id,username,role,active,session_version FROM bot_admins WHERE id=?', [req.session.adminId]) : [[]];
    if (!user?.active || user.session_version !== req.session.version) {
      if (req.session) req.session.destroy(() => {});
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ success: false, message: 'Inicia sesión' });
      return res.redirect('/admin/login.html');
    }
    req.admin = user;
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (!sameOrigin(req) || req.get('X-CSRF-Token') !== req.session.csrf)) {
      return res.status(403).json({ message: 'Sesión de seguridad inválida. Recarga la página.' });
    }
    next();
  }
  function requireOwner(req, res, next) {
    if (req.admin?.role !== 'owner') return res.status(403).json({ message: 'Se requiere una cuenta propietaria' });
    next();
  }
  return { login, requireAdmin, requireOwner, audit, validPassword };
}
module.exports = { MySQLSessionStore, createAdminSecurity, validPassword };
