const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { sign, verify } = require('./crypto');
function createReports({ pool, crypto, directory, secret, publicUrl, now = Date.now }) {
  const urlFor = row => {
    const expires = Math.floor(new Date(row.expires_at).getTime() / 1000);
    return `${publicUrl.replace(/\/$/, '')}/reports/${row.id}?expires=${expires}&signature=${sign(secret, `${row.id}:${expires}`)}`;
  };
  return {
    async save(base64, { from, messageId }) {
      const [[existing]] = await pool.execute('SELECT * FROM bot_reports WHERE message_sid=?', [messageId]);
      if (existing) return existing.revoked || new Date(existing.expires_at).getTime() <= now() ? null : urlFor(existing);
      if (typeof base64 !== 'string' || base64.length > 28 * 1024 * 1024) return null;
      const pdf = Buffer.from(base64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length > 20 * 1024 * 1024) return null;
      const id = randomUUID();
      const filename = id + '.enc';
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, filename);
      await fs.writeFile(file, crypto.encrypt(pdf.toString('base64')), { flag: 'wx', mode: 0o600 });
      const expires_at = new Date(now() + 86400000);
      try { await pool.execute('INSERT INTO bot_reports (id,message_sid,phone,filename,expires_at) VALUES (?,?,?,?,?)', [id, messageId, from.replace(/^whatsapp:/, ''), filename, expires_at]); }
      catch (error) { await fs.unlink(file); throw error; }
      return urlFor({ id, expires_at });
    },
    async serve(req, res) {
      const { id } = req.params;
      const { expires, signature } = req.query;
      if (!/^[a-f0-9-]{36}$/.test(id) || !/^\d{10}$/.test(expires || '') || Number(expires) * 1000 <= now() || !verify(secret, `${id}:${expires}`, signature)) return res.sendStatus(403);
      const [[row]] = await pool.execute('SELECT * FROM bot_reports WHERE id=?', [id]);
      if (!row || row.revoked || new Date(row.expires_at).getTime() <= now() || Number(expires) !== Math.floor(new Date(row.expires_at).getTime() / 1000)) return res.sendStatus(410);
      try {
        const data = crypto.decrypt(await fs.readFile(path.join(directory, path.basename(row.filename))));
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="KYC_${id}.pdf"`, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
        res.send(Buffer.from(data, 'base64'));
      } catch (error) { if (error.code === 'ENOENT') return res.sendStatus(410); throw error; }
    },
    async cleanup() {
      const [rows] = await pool.query('SELECT id,filename FROM bot_reports WHERE expires_at<=UTC_TIMESTAMP(3) OR revoked=1');
      for (const row of rows) {
        await fs.unlink(path.join(directory, path.basename(row.filename))).catch(error => { if (error.code !== 'ENOENT') throw error; });
        // Conservar la fila impide que repetir un trabajo regenere un enlace revocado.
        await pool.execute('UPDATE bot_reports SET revoked=1 WHERE id=?', [row.id]);
      }
      const files = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const name of files) {
        if (!/^[a-f0-9-]{36}\.enc$/.test(name)) continue;
        const file = path.join(directory, name);
        const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat || now() - stat.mtimeMs < 86400000) continue;
        const [[row]] = await pool.execute('SELECT id FROM bot_reports WHERE filename=? AND revoked=0 AND expires_at>UTC_TIMESTAMP(3)', [name]);
        if (!row) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  };
}
module.exports = { createReports };
