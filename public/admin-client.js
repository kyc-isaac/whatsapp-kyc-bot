(() => {
  const original = window.fetch.bind(window);
  let csrf, pending;
  async function token() {
    if (csrf) return csrf;
    if (!pending) pending = original('/api/admin/session').then(async response => {
      if (response.status === 401) { window.location.href = '/admin/login.html'; throw new Error('Inicia sesión'); }
      if (!response.ok) throw new Error('No se pudo verificar la sesión');
      csrf = (await response.json()).csrfToken;
      return csrf;
    }).finally(() => { pending = null; });
    return pending;
  }
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    const method = (options.method || 'GET').toUpperCase();
    if (url.origin === location.origin && url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/login' && !['GET','HEAD','OPTIONS'].includes(method)) {
      const headers = new Headers(options.headers);
      headers.set('X-CSRF-Token', await token());
      options = { ...options, headers };
    }
    const response = await original(input, options);
    if (response.status === 401 && url.pathname !== '/api/admin/login') { csrf = null; location.href = '/admin/login.html'; }
    return response;
  };
})();
