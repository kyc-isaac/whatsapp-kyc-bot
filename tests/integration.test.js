const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('../server');
let pool, adminHash;
const phone = 'whatsapp:+5215500000001';
const sid = () => 'SM' + randomUUID().replaceAll('-', '');
const tables = ['bot_jobs','bot_conversations','bot_searches','bot_effects','bot_reports','bot_outbox','bot_delivery_events','bot_admins','bot_admin_sessions','bot_login_limits','bot_alerts','bot_runtime','bot_audit','authorized_users','blocked_attempts'];
test.before(async () => {
  if (!/^kyc_bot_test_[a-f0-9]{12}$/.test(process.env.KYC_TEST_DB || '')) throw new Error('Usa npm run test:integration para una base aislada');
  pool = mysql.createPool({ host:process.env.TEST_DB_HOST,port:Number(process.env.TEST_DB_PORT),user:process.env.TEST_DB_USER,password:process.env.TEST_DB_PASSWORD,database:process.env.KYC_TEST_DB,connectionLimit:10,timezone:'Z' });
  pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
  await migrate(pool); adminHash = await bcrypt.hash('test-password-long',12);
});
test.beforeEach(async () => {
  for (const table of tables) await pool.query(`DELETE FROM ${table}`);
  await pool.execute('INSERT INTO authorized_users (phone_number,full_name,search_limit,ine_ocr_enabled) VALUES (?,?,?,?)',[phone.replace('whatsapp:',''),'Prueba',100,1]);
  await pool.execute("INSERT INTO bot_admins (username,password_hash,role) VALUES (?,?,'owner')",['test-admin',adminHash]);
});
test.after(async () => { if(pool)await pool.end(); });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'kyc-integration-'));
  const state = { searches:0, ocr:0, sends:[], logs:[], response:{err:false,coincidences:0,pdf:{base64:Buffer.from('%PDF-1.4\nfixture').toString('base64')}} };
  const env = { SESSION_SECRET:'a-test-session-secret-long-enough',SERVER_URL:'https://bot.example',TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'test-token',TWILIO_WHATSAPP_NUMBER:'whatsapp:+5215500000000',KYC_API_URL:'https://api.example/listas',KYC_API_KEY:'test-key' };
  const providers = {
    client:{messages:{create:async message=>{if(state.sendError)throw state.sendError;state.sends.push(message);return {sid:sid()};}},api:{accounts:()=>({fetch:async()=>{if(state.twilioError)throw state.twilioError;return{status:'active'};}})}},
    axios:{get:async url=>({data:url.endsWith('/live')?{service:'kyc-whatsapp-bot'}:{err:false}})},
    search:async query=>{state.searches++;state.query=query;if(state.searchError)throw state.searchError;return state.response;},
    readIne:async()=>{state.ocr++;return{nombres:'ANA',primerApellido:'PEREZ'};},download:async()=>Buffer.from('fixture').toString('base64'),
    resolve:async()=>['127.0.0.1'],checkCertificate:async()=>({expiresAt:new Date(Date.now()+90*86400000).toISOString()})
  };
  const make = () => createApp({pool,env,providers,reportDirectory:directory,log:(...args)=>state.logs.push(args)});
  let runtime=make();
  const listener = await new Promise((resolve,reject)=>{const server=runtime.app.listen(0,'127.0.0.1',error=>error?reject(error):resolve(server));});
  const base=`http://127.0.0.1:${listener.address().port}`;
  t.after(async()=>{await runtime.stop();listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const request=(url,options)=>fetch(base+url,options);
  const enqueue=async(body,extra={})=>{const payload={From:phone,Body:body,MessageSid:sid(),...extra};await runtime.repository.enqueue(payload);await runtime.worker.tick();return payload;};
  const flow=async(...messages)=>{for(const body of messages)await enqueue(body);};
  const login=async(username='test-admin',password='test-password-long')=>{
    const response=await request('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
    if(!response.ok)return{response};
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const session=await request('/api/admin/session',{headers:{cookie}});const data=await session.json();
    return{response,cookie,headers:{cookie,'X-CSRF-Token':data.csrfToken,'content-type':'application/json'}};
  };
  return{get runtime(){return runtime;},state,env,providers,request,enqueue,flow,login,
    restart:()=>{runtime=make();},
    signed:(route,body)=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','X-Twilio-Signature':twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,env.SERVER_URL+route,body)},body:new URLSearchParams(body)})};
}

test('migración repetible sin borrar usuarios ni restablecer contraseñas',async()=>{
  await migrate(pool,{ADMIN_USER:'ignored',ADMIN_PASS:'ignored'});
  const [[row]]=await pool.query('SELECT COUNT(*) AS count FROM bot_admins');assert.equal(row.count,1);
});
test('webhook guarda antes de responder; SID duplicado crea un solo trabajo',async t=>{
  const f=await fixture(t);const body={From:phone,Body:'hola',MessageSid:sid()};
  assert.equal((await f.request('/webhook',{method:'POST'})).status,415);
  const bad=await f.request('/webhook',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(bad.status,403);
  for(let i=0;i<2;i++){const r=await f.request('/webhook',f.signed('/webhook',body));assert.equal(r.status,200);assert.equal(await r.text(),'<Response/>');}
  const [[row]]=await pool.query('SELECT COUNT(*) AS count FROM bot_jobs');assert.equal(row.count,1);assert.equal(f.state.sends.length,0);
});
test('sesión, historial y cuota sobreviven reiniciar; personas usan tipo 1',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ');f.restart();await f.enqueue('1');
  assert.equal(f.state.searches,1);assert.equal(f.state.query.persona,'1');
  f.restart();await f.flow('menu','2');const history=await f.runtime.repository.history(phone);assert.equal(history.length,1);assert.equal(history[0].name,'ANA PEREZ');
  assert.equal((await f.runtime.repository.quota(phone)).current,1);
});
test('empresa utiliza tipo 2 y completar consulta incrementa una sola vez',async t=>{
  const f=await fixture(t);await f.flow('buscar','3','EMPRESA');const job=await f.enqueue('1');
  await f.runtime.repository.enqueue(job);await f.runtime.worker.tick();
  assert.equal(f.state.query.persona,'2');assert.equal(f.state.searches,1);
  const [[row]]=await pool.query('SELECT total_queries FROM authorized_users');assert.equal(row.total_queries,1);
});
test('reserva transaccional respeta cuota con llamadas concurrentes',async t=>{
  const f=await fixture(t);await pool.query('UPDATE authorized_users SET search_limit=1');
  let calls=0;const perform=async()=>{calls++;return{err:false,coincidences:0};};
  const result=await Promise.all([1,2].map(()=>f.runtime.repository.executeSearch({persona:'1',nombre:'ANA'},{from:phone,messageId:sid()},perform)));
  assert.equal(calls,1);assert.equal(result.filter(r=>r.quota).length,1);
});
test('resultado KYC guardado se reutiliza si se interrumpe el trabajo antes de guardar sesión',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ');const id=sid();
  await pool.query('UPDATE authorized_users SET search_limit=1');
  await f.runtime.repository.enqueue({From:phone,Body:'1',MessageSid:id});
  const job=await f.runtime.repository.nextJob();
  await f.runtime.repository.executeSearch({persona:'1',nombre:'ANA PEREZ'},{from:phone,messageId:id},f.providers.search);
  assert.equal(job.message_sid,id);f.restart();await f.runtime.worker.tick();
  assert.equal(f.state.searches,1);assert.equal((await f.runtime.repository.history(phone)).length,1);
});
test('consulta interrumpida sin respuesta pasa a incierta y no se repite',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ');const id=sid();
  await f.runtime.repository.enqueue({From:phone,Body:'1',MessageSid:id});
  await pool.execute("INSERT INTO bot_searches (id,message_sid,phone,quota_day,status,query) VALUES (?,?,?,?,'running',?)",[randomUUID(),id,phone.replace('whatsapp:',''),require('../lib/repository').quotaDay(),f.runtime.repository.crypto.encrypt({})]);
  f.restart();await f.runtime.worker.tick();assert.equal(f.state.searches,0);
  const [[row]]=await pool.execute('SELECT status FROM bot_searches WHERE message_sid=?',[id]);assert.equal(row.status,'uncertain');
  const [[alert]]=await pool.query('SELECT COUNT(*) AS count FROM bot_alerts WHERE active=1');assert.equal(alert.count,1);
});
test('fallo antes de finalizar se recupera sin doble consulta',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ');
  const original=f.runtime.repository.finishJob.bind(f.runtime.repository);f.runtime.repository.finishJob=async()=>{throw Object.assign(new Error('interruption'),{code:'TEST_FAILURE'});};
  const job=await f.enqueue('1');assert.equal(f.state.searches,1);
  f.runtime.repository.finishJob=original;await pool.execute('UPDATE bot_jobs SET available_at=UTC_TIMESTAMP(3) WHERE message_sid=?',[job.MessageSid]);
  await f.runtime.worker.tick();assert.equal(f.state.searches,1);assert.equal((await f.runtime.repository.history(phone)).length,1);
});
test('outbox sobrevive reinicio y registra SID y statusCallback por respuesta',async t=>{
  const f=await fixture(t);await f.enqueue('hola');f.restart();await f.runtime.worker.tick();
  assert.equal(f.state.sends.length,1);assert.match(f.state.sends[0].statusCallback,/\/webhook\/status\?outbox=/);
  const [[row]]=await pool.query('SELECT * FROM bot_outbox');assert.equal(row.status,'accepted');assert.ok(row.remote_sid);
});
test('envío incierto no se repite; callback tardío recupera su estado sin retroceder',async t=>{
  const f=await fixture(t);await f.enqueue('hola');await pool.query("UPDATE bot_outbox SET status='sending'");f.restart();await f.runtime.worker.tick();
  assert.equal(f.state.sends.length,0);const [[row]]=await pool.query('SELECT * FROM bot_outbox');assert.equal(row.status,'uncertain');
  const remote=sid();await f.runtime.repository.delivery(row.id,remote,'delivered');await f.runtime.repository.delivery(row.id,remote,'sent');await f.runtime.repository.delivery(row.id,remote,'delivered');
  const [[after]]=await pool.query('SELECT * FROM bot_outbox');assert.equal(after.status,'delivered');
  const [[events]]=await pool.query('SELECT COUNT(*) AS count FROM bot_delivery_events');assert.equal(events.count,2);
});
test('PDF firmado vence, no admite alteraciones y puede revocarse',async t=>{
  const f=await fixture(t);const url=await f.runtime.reports.save(Buffer.from('%PDF-1.4\nfixture').toString('base64'),{from:phone,messageId:sid()});
  const parsed=new URL(url);const pathname=parsed.pathname+parsed.search;
  const r=await f.request(pathname);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.equal((await f.request(parsed.pathname)).status,403);
  assert.equal((await f.request(pathname.replace('signature=','signature=x'))).status,403);
  await pool.query('UPDATE bot_reports SET revoked=1');assert.equal((await f.request(pathname)).status,410);
  assert.equal((await f.request('/temp/old.pdf')).status,410);
});
test('login individual, CSRF, hash y revocación de sesión al desactivar administrador',async t=>{
  const f=await fixture(t);const session=await f.login();assert.equal(session.response.status,200);
  assert.equal((await f.request('/api/admin/set-user-limit',{method:'POST',headers:{cookie:session.cookie,'content-type':'application/json'},body:'{}'})).status,403);
  const create=await f.request('/api/admin/admins',{method:'POST',headers:session.headers,body:JSON.stringify({username:'second-admin',password:'a-long-password-123',role:'admin'})});assert.equal(create.status,200);
  const [[user]]=await pool.query("SELECT * FROM bot_admins WHERE username='second-admin'");assert.notEqual(user.password_hash,'a-long-password-123');assert.ok(await bcrypt.compare('a-long-password-123',user.password_hash));
  const second=await f.login('second-admin','a-long-password-123');await pool.execute('UPDATE bot_admins SET active=0 WHERE id=?',[user.id]);assert.equal((await f.request('/api/admin/session',{headers:{cookie:second.cookie}})).status,401);
});
test('límite de login persistente y propietario final protegido',async t=>{
  const f=await fixture(t);const session=await f.login();const [[owner]]=await pool.query('SELECT id FROM bot_admins');
  const r=await f.request(`/api/admin/admins/${owner.id}`,{method:'PATCH',headers:session.headers,body:JSON.stringify({active:false})});assert.equal(r.status,409);
  for(let i=0;i<5;i++)assert.equal((await f.login('unknown-admin','wrong-password')).response.status,401);
  f.restart();assert.equal((await f.login('unknown-admin','wrong-password')).response.status,429);
});
test('paginación muestra más de 50 usuarios y filtra en la base completa',async t=>{
  const f=await fixture(t);for(let i=0;i<65;i++)await pool.execute('INSERT INTO authorized_users (phone_number,full_name) VALUES (?,?)',[`+52155${String(i).padStart(7,'0')}`,`User ${i}`]);
  const session=await f.login();
  const second=await f.request('/api/admin/users?page=3&pageSize=25',{headers:session.headers});const data=await second.json();assert.equal(data.total,66);assert.equal(data.users.length,16);
  const search=await f.request('/api/admin/users?q=User%200',{headers:session.headers});assert.equal((await search.json()).total,1);
});
test('monitor detecta Twilio caído y escribe alerta local; recuperación resuelve incidente',async t=>{
  const f=await fixture(t);await f.runtime.repository.runtime('worker',{status:'ok'});f.state.twilioError=Object.assign(new Error('Authenticate'),{code:20003});
  const health=await f.runtime.monitor.tick();assert.equal(health.status,'degraded');assert.ok(f.state.logs.some(([line])=>line.includes('ALERTA')));
  assert.equal((await f.request('/health')).status,503);
  delete f.state.twilioError;await f.runtime.monitor.tick();assert.equal(f.runtime.monitor.snapshot().status,'ok',JSON.stringify(f.runtime.monitor.snapshot()));assert.equal((await f.request('/health')).status,200);
  const [[alert]]=await pool.query("SELECT active FROM bot_alerts WHERE alert_key='health:twilio'");assert.equal(alert.active,0);
});
test('OCR guardado se recupera tras interrupción sin repetir lectura ni buscar sin confirmar',async t=>{
  const f=await fixture(t);await f.flow('buscar','4');
  const media={NumMedia:'1',MediaUrl0:'https://api.twilio.com/test',MediaContentType0:'image/jpeg'};
  await f.enqueue('',media);
  const original=f.runtime.repository.finishJob.bind(f.runtime.repository);
  f.runtime.repository.finishJob=async()=>{throw new Error('interruption');};
  const job=await f.enqueue('',media);assert.equal(f.state.ocr,1);
  f.runtime.repository.finishJob=original;
  await pool.execute('UPDATE bot_jobs SET available_at=UTC_TIMESTAMP(3) WHERE message_sid=?',[job.MessageSid]);
  f.restart();await f.runtime.worker.tick();assert.equal(f.state.ocr,1);assert.equal(f.state.searches,0);
  await f.enqueue('1');assert.equal(f.state.query.persona,'1');assert.equal(f.state.searches,1);
});
test('OCR interrumpido sin resultado se marca incierto sin llamar nuevamente al proveedor',async t=>{
  const f=await fixture(t);const id=sid();
  await pool.execute("INSERT INTO bot_effects (message_sid,kind,status) VALUES (?,'ocr','running')",[id]);
  const result=await f.runtime.repository.executeEffect('ocr',id,f.providers.readIne);
  assert.equal(result.uncertain,true);assert.equal(f.state.ocr,0);
});
test('mensajes de un usuario conservan orden durante backoff y otro usuario puede continuar',async t=>{
  const f=await fixture(t);const first=sid(),second=sid(),other=sid();
  for(const [id,from] of [[first,phone],[second,phone],[other,'whatsapp:+5215500000099']])await f.runtime.repository.enqueue({From:from,Body:'hola',MessageSid:id});
  await pool.execute('UPDATE bot_jobs SET available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND) WHERE message_sid=?',[first]);
  const job=await f.runtime.repository.nextJob();assert.equal(job.message_sid,other);
});
test('trabajo vencido no ejecuta una consulta de pago',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ');const id=sid();
  await f.runtime.repository.enqueue({From:phone,Body:'1',MessageSid:id});
  await pool.execute('UPDATE bot_jobs SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE message_sid=?',[id]);
  await f.runtime.worker.tick();assert.equal(f.state.searches,0);
  const [[row]]=await pool.execute('SELECT status FROM bot_jobs WHERE message_sid=?',[id]);assert.equal(row.status,'cancelled');
});
test('fallo de persistencia del webhook devuelve error en lugar de confirmar recepción',async t=>{
  const f=await fixture(t);f.runtime.repository.enqueue=async()=>{throw Object.assign(new Error('db'),{code:'ECONNREFUSED'});};
  const body={From:phone,Body:'hola',MessageSid:sid()};
  assert.equal((await f.request('/webhook',f.signed('/webhook',body))).status,503);
});
test('callback firmado actualiza entrega y un callback sin firma no puede alterarla',async t=>{
  const f=await fixture(t);await f.enqueue('hola');await f.runtime.worker.tick();
  const [[row]]=await pool.query('SELECT * FROM bot_outbox');
  const route=`/webhook/status?outbox=${row.id}`,body={MessageSid:row.remote_sid,MessageStatus:'read'};
  assert.equal((await f.request(route,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)})).status,403);
  assert.equal((await f.request(route,f.signed(route,body))).status,200);
  const [[after]]=await pool.query('SELECT status FROM bot_outbox');assert.equal(after.status,'read');
});
test('rechazo Twilio permite reintento manual; timeout incierto no permite duplicarlo',async t=>{
  const f=await fixture(t);await f.enqueue('hola');f.state.sendError={status:401,code:20003};await f.runtime.worker.tick();
  const [[row]]=await pool.query('SELECT * FROM bot_outbox');assert.equal(row.status,'failed');
  const session=await f.login();
  assert.equal((await f.request(`/api/admin/messages/${row.id}/retry`,{method:'POST',headers:session.headers})).status,200);
  f.state.sendError={code:'ETIMEDOUT'};await f.runtime.worker.tick();
  assert.equal((await f.request(`/api/admin/messages/${row.id}/retry`,{method:'POST',headers:session.headers})).status,409);
  const [[after]]=await pool.query('SELECT status FROM bot_outbox');assert.equal(after.status,'uncertain');
});
test('caducidad de reportes se valida en MySQL y la limpieza revoca archivos vencidos',async t=>{
  const f=await fixture(t);const url=new URL(await f.runtime.reports.save(Buffer.from('%PDF-1.4\nfixture').toString('base64'),{from:phone,messageId:sid()}));
  await pool.query('UPDATE bot_reports SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)');
  assert.equal((await f.request(url.pathname+url.search)).status,410);
  await f.runtime.cleanup();const [[row]]=await pool.query('SELECT revoked FROM bot_reports');assert.equal(row.revoked,1);
});
test('revocar PDF retira el enlace tanto de la sesión como del historial del bot',async t=>{
  const f=await fixture(t);await f.flow('buscar','2','ANA PEREZ','1');
  assert.ok((await f.runtime.repository.history(phone))[0].pdfUrl);
  await pool.query('UPDATE bot_reports SET revoked=1');
  assert.equal((await f.runtime.repository.history(phone))[0].pdfUrl,null);
  assert.equal((await f.runtime.repository.loadSession(phone)).result.pdfUrl,null);
});
test('transacción fallida después de insertar sesión y outbox revierte ambos cambios',async t=>{
  const f=await fixture(t);await f.runtime.repository.enqueue({From:phone,Body:'hola',MessageSid:sid()});
  const job=await f.runtime.repository.nextJob();const broken={};broken.circular=broken;
  await assert.rejects(f.runtime.repository.finishJob(job,{state:'MAIN'},[{to:phone,body:'hola'}],[broken]));
  for(const name of ['bot_outbox','bot_conversations']){
    const [[row]]=await pool.query(`SELECT COUNT(*) AS count FROM ${name}`);assert.equal(row.count,0);
  }
  const [[row]]=await pool.query('SELECT status FROM bot_jobs');assert.equal(row.status,'processing');
});
