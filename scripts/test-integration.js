const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
(async () => {
  const local = fs.existsSync(path.join(__dirname, '../.env')) ? dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env'))) : {};
  const testFile = path.join(__dirname, '../.env.test.local');
  const testEnv = fs.existsSync(testFile) ? dotenv.parse(fs.readFileSync(testFile)) : {};
  const env = { ...local, ...testEnv, ...process.env };
  const host = env.TEST_DB_HOST || env.DB_HOST || '127.0.0.1';
  if (!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('Las pruebas solo permiten MySQL local');
  const config = { host, port: Number(env.TEST_DB_PORT || env.DB_PORT || 3306), user: env.TEST_DB_USER || env.DB_USER || 'root', password: env.TEST_DB_PASSWORD ?? env.DB_PASSWORD ?? '', timezone: 'Z', connectTimeout: 3000 };
  const admin = await mysql.createConnection(config);
  const database = 'kyc_bot_test_' + randomBytes(6).toString('hex');
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const childEnv = { ...process.env, KYC_TEST_DB: database, TEST_DB_HOST: host, TEST_DB_PORT: String(config.port), TEST_DB_USER: config.user, TEST_DB_PASSWORD: config.password };
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', '--test-concurrency=1', path.join(__dirname, '../tests/integration.test.js')], { stdio: 'inherit', env: childEnv });
      child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
    });
    process.exitCode = status;
  } finally {
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
})().catch(error => { console.error('No se pudo ejecutar la integración local:', error.code || error.message); process.exitCode = 1; });
