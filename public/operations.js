const api = '/api/admin';
let owner = false, reportPage = 1, reportPages = 1;
const feedback = text => { document.getElementById('feedback').textContent = text; };
async function request(path, method = 'GET', body) {
  const response = await fetch(api + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Error ${response.status}`);
  return data;
}
function table(id, columns, rows, action) {
  const host = document.getElementById(id); host.replaceChildren();
  if (!rows.length) { host.textContent = 'Sin registros.'; return; }
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const [title] of columns) { const th = document.createElement('th'); th.textContent = title; head.append(th); }
  if (action) { const th = document.createElement('th'); th.textContent = 'Acciones'; head.append(th); }
  table.append(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [,field] of columns) { const td = document.createElement('td'); td.textContent = String(typeof field === 'function' ? field(row) : row[field] ?? '—'); tr.append(td); }
    if (action) { const td = document.createElement('td'); action(row,td); tr.append(td); }
    table.append(tr);
  }
  host.append(table);
}
function button(cell, label, fn) {
  const b = document.createElement('button'); b.textContent = label;
  b.onclick = async () => { b.disabled = true; try { await fn(); feedback('Operación completada.'); await refresh(); } catch (e) { feedback(e.message); } finally { b.disabled = false; } };
  cell.append(b);
}
async function refresh() {
  try {
    const [data,reports] = await Promise.all([request('/operations'),request(`/reports?page=${reportPage}&pageSize=10`)]);
    const checks = document.getElementById('checks'); checks.replaceChildren();
    document.getElementById('checkedAt').textContent = `Estado: ${data.health.status} · Última revisión: ${data.health.checkedAt || 'pendiente'}`;
    for (const [name,value] of Object.entries(data.health.checks)) { const div = document.createElement('div'); div.className = `check ${value.status}`; div.textContent = `${name}: ${value.status}${value.code ? ' · ' + value.code : ''}`; checks.append(div); }
    table('alerts',[['Estado',r=>r.active?'Activo':'Resuelto'],['Severidad','severity'],['Detalle','message'],['Última vez','last_seen']],data.alerts);
    table('jobs',[['ID','id'],['Mensaje','message_sid'],['Estado','status'],['Intentos','attempts'],['Error','last_error']],data.jobs,(r,c)=>{
      if(owner&&r.status==='failed') {
        button(c,'Recuperar',()=>request(`/jobs/${r.id}/retry`,'POST'));
        button(c,'Descartar',async()=>{if(confirm('¿Descartar este mensaje fallido y permitir que continúen los siguientes?'))await request(`/jobs/${r.id}/discard`,'POST');});
      }
    });
    table('messages',[['Mensaje Twilio','remote_sid'],['Estado','status'],['Error','error_code'],['Fecha','created_at']],data.messages,(r,c)=>{ if(owner&&r.status==='failed'&&!r.remote_sid&&r.error_code!=='WINDOW_EXPIRED')button(c,'Reintentar',()=>request(`/messages/${r.id}/retry`,'POST')); });
    table('searches',[['Mensaje','message_sid'],['Estado','status'],['Error','error_code'],['Fecha','created_at']],data.searches);
    table('reports',[['ID','id'],['Usuario','phone'],['Vencimiento','expires_at'],['Revocado',r=>r.revoked?'Sí':'No']],reports.reports,(r,c)=>{if(!r.revoked)button(c,'Revocar enlace',()=>request(`/reports/${r.id}/revoke`,'POST'));});
    reportPages=Math.max(1,Math.ceil(reports.total/reports.pageSize));
    document.getElementById('reportPage').textContent=`${reportPage} / ${reportPages}`;
    document.getElementById('previousReport').disabled=reportPage<=1;
    document.getElementById('nextReport').disabled=reportPage>=reportPages;
    if(owner){ const {admins}=await request('/admins');table('admins',[['ID','id'],['Usuario','username'],['Rol','role'],['Activo',r=>r.active?'Sí':'No']],admins,(r,c)=>button(c,r.active?'Desactivar':'Activar',()=>request(`/admins/${r.id}`,'PATCH',{active:!r.active}))); }
  }catch(e){feedback(e.message);}
}
document.getElementById('refresh').onclick=refresh;
document.getElementById('check').onclick=async()=>{try{await request('/operations/check','POST');await refresh();}catch(e){feedback(e.message);}};
document.getElementById('previousReport').onclick=()=>{reportPage--;void refresh();};
document.getElementById('nextReport').onclick=()=>{reportPage++;void refresh();};
for(const [id,path,method] of [['adminForm','/admins','POST'],['passwordForm','/password','POST'],['resetForm',null,'PATCH']]){
 document.getElementById(id).onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;const body=Object.fromEntries(new FormData(form));const target=path||`/admins/${body.id}`;delete body.id;
 try{await request(target,method,body);form.reset();if(id==='passwordForm'){location.href='/admin/login.html';return;}feedback('Cuenta actualizada.');await refresh();}catch(e){feedback(e.message);}};
}
(async()=>{try{const s=await request('/session');owner=s.role==='owner';document.getElementById('identity').textContent=`${s.username} · ${s.role}`;if(owner)document.querySelectorAll('.owner').forEach(e=>e.classList.remove('hidden'));feedback('Datos del servicio. Actualiza para consultar los últimos eventos.');await refresh();}catch(e){feedback(e.message);}})();
