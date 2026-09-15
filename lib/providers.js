const axios = require('axios');
const twilio = require('twilio');
function createProviders(env, log = () => {}) {
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, { timeout: 10000 });
  const api = env.KYC_API_URL.replace(/\/$/, '').replace(/\/search$/, '');
  return {
    client, axios,
    async search(query) {
      try {
        const response = await axios.post(`${api}/search`, { ...query, document: 1 }, { headers: { 'Content-Type': 'application/json', 'X-API-Key': env.KYC_API_KEY }, timeout: 30000, maxContentLength: 30 * 1024 * 1024 });
        return response.data;
      } catch (error) {
        if (error.response?.status === 404 && error.response.data?.err === false && error.response.data.coincidences === 0) return error.response.data;
        log(`KYC: ${error.code || error.response?.status || 'error'}`, 'ERROR');
        // Sin respuesta o con 5xx no sabemos si el proveedor ejecutó la consulta.
        return { err: true, uncertain: !error.response || error.response.status >= 500, code: error.code || error.response?.status };
      }
    },
    async download(mediaUrl) {
      const url = new URL(mediaUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' || url.username || url.password || (url.port && url.port !== '443') || !url.pathname.startsWith(`/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages/`)) throw new Error('URL de imagen no permitida');
      const response = await axios.get(url.href, { auth: { username: env.TWILIO_ACCOUNT_SID, password: env.TWILIO_AUTH_TOKEN }, responseType: 'arraybuffer', timeout: 15000, maxContentLength: 8 * 1024 * 1024, maxRedirects: 3 });
      return Buffer.from(response.data).toString('base64');
    },
    async readIne(front, back) {
      if (!env.KYC_VALIDATION_API_URL || !env.KYC_VALIDATION_API_KEY) return { err: true };
      try {
        const response = await axios.post(`${env.KYC_VALIDATION_API_URL.replace(/\/$/, '')}/obtener_datos_id`, { id: front, idReverso: back }, { headers: { 'X-API-KEY': env.KYC_VALIDATION_API_KEY }, timeout: 30000 });
        return response.data;
      } catch (error) { log(`OCR: ${error.code || error.response?.status || 'error'}`, 'ERROR'); return { err: true, uncertain: !error.response || error.response.status >= 500 }; }
    }
  };
}
module.exports = { createProviders };
