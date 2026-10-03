/**
 * WiFi de la comunidad (WiGLE) — Francis 2026-10-03.
 *
 * Proxy de la API pública de WiGLE (https://wigle.net), la base de datos
 * comunitaria de redes WiFi más grande del mundo (350M+ redes mapeadas por la
 * gente con "wardriving"). Dado el RECTÁNGULO QUE SE VE en el globo, devuelve
 * las redes que la comunidad ya ha publicado ahí: nombre (SSID), posición y
 * tipo de cifrado. Es exactamente lo que WiGLE enseña en su propio mapa, traído
 * al globo como una capa de contexto más (igual que vuelos, barcos o cámaras).
 *
 * Línea de diseño (como exposure.js): SOLO lee lo que ya es público y SOLO del
 * trozo de mapa que el usuario está mirando (acotado). No ataca ni se conecta a
 * ninguna red: solo muestra datos abiertos de la comunidad. Honesto sobre el
 * cifrado para que se entienda el riesgo, no para explotarlo.
 *
 * Clave: WiGLE da una cuenta y un token GRATIS. En "Account → Show my token"
 * aparece "Encoded for use"; se pega tal cual en WIGLE_TOKEN y se usa como
 * `Authorization: Basic <token>`. Sin clave, la capa avisa y no llama a WiGLE.
 */

const WIGLE = 'https://api.wigle.net/api/v2/network/search';
const TTL = 10 * 60_000; // WiGLE limita consultas/día: la caché es clave.
// Tamaño máximo de ventana que aceptamos consultar (en grados). Si el usuario
// está muy alejado, pedimos que se acerque en vez de barrer medio planeta.
const MAX_SPAN = 0.6;

const token = () => String(process.env.WIGLE_TOKEN || '').trim();

function clave(n, s, e, w) {
  const r = (x) => Number(x).toFixed(3);
  return `${r(s)},${r(w)},${r(n)},${r(e)}`;
}

/** Normaliza el cifrado de WiGLE a una categoría simple + nivel de riesgo. */
function cifrado(raw) {
  const v = String(raw || '').toLowerCase();
  if (!v || v === 'unknown') return { tipo: 'desconocido', riesgo: 1 };
  if (v.includes('wpa3')) return { tipo: 'WPA3', riesgo: 0 };
  if (v.includes('wpa2')) return { tipo: 'WPA2', riesgo: 0 };
  if (v.includes('wpa')) return { tipo: 'WPA', riesgo: 1 };
  if (v.includes('wep')) return { tipo: 'WEP', riesgo: 2 };
  if (v === 'none' || v.includes('open') || v.includes('abier')) {
    return { tipo: 'abierta', riesgo: 3 };
  }
  return { tipo: raw, riesgo: 1 };
}

export function wifiProxy() {
  const cache = new Map(); // bbox -> { at, data }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/wifi', async (req, res) => {
      const responder = (status, obj) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };

      try {
        const ruta = req.url?.split('?')[0] || '/';
        if (req.method === 'GET' && ruta === '/status') {
          return responder(200, {
            configured: Boolean(token()),
            source: 'wigle',
            keyless: false,
          });
        }

        if (!token()) {
          return responder(503, {
            error: 'no_key',
            mensaje:
              'La capa WiFi necesita una clave GRATIS de WiGLE (wigle.net → ' +
              'Account → token "Encoded for use"). Pégala en los ajustes.',
          });
        }

        const url = new URL(req.url, 'http://x');
        const num = (k) => {
          const x = Number(url.searchParams.get(k));
          return Number.isFinite(x) ? x : null;
        };
        const n = num('n');
        const s = num('s');
        const e = num('e');
        const w = num('w');
        if ([n, s, e, w].some((x) => x === null)) {
          return responder(400, { error: 'Falta el rectángulo del mapa (n,s,e,w)' });
        }
        if (n - s > MAX_SPAN || Math.abs(e - w) > MAX_SPAN) {
          return responder(200, {
            redes: [],
            total: 0,
            acercate: true,
            mensaje: 'Acércate un poco para ver las redes WiFi de la comunidad.',
          });
        }

        const k = clave(n, s, e, w);
        const now = Date.now();
        const hit = cache.get(k);
        if (hit && now - hit.at < TTL) return responder(200, hit.data);

        const q = new URLSearchParams({
          latrange1: String(s),
          latrange2: String(n),
          longrange1: String(w),
          longrange2: String(e),
          onlymine: 'false',
          resultsPerPage: '100',
        });
        const r = await fetch(`${WIGLE}?${q}`, {
          signal: req.signal,
          headers: {
            Authorization: `Basic ${token()}`,
            Accept: 'application/json',
            'User-Agent': 'mybestia-mundo/1.0',
          },
        });

        if (r.status === 401) {
          return responder(502, { error: 'La clave de WiGLE no es válida.' });
        }
        if (r.status === 429) {
          // Se agotó la cuota diaria gratis: servir lo cacheado si lo hay.
          if (hit) return responder(200, hit.data);
          return responder(200, {
            redes: [],
            total: 0,
            limite: true,
            mensaje: 'Se agotó la cuota diaria gratis de WiGLE. Vuelve mañana.',
          });
        }
        const body = await r.json().catch(() => null);
        if (!body?.success) {
          return responder(502, {
            error: 'WiGLE no devolvió resultados',
            detalle: String(body?.message || r.status).slice(0, 160),
          });
        }

        const redes = (body.results || [])
          .map((x) => {
            const lat = Number(x.trilat);
            const lon = Number(x.trilong);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            const c = cifrado(x.encryption);
            return {
              lat,
              lon,
              ssid: String(x.ssid || '').slice(0, 64) || '(sin nombre)',
              cifrado: c.tipo,
              riesgo: c.riesgo,
              canal: x.channel ?? null,
              visto: x.lastupdt || null,
            };
          })
          .filter(Boolean);

        const data = {
          redes,
          total: Number(body.totalResults) || redes.length,
          fuente: 'WiGLE · base comunitaria de redes WiFi (gratis)',
        };
        cache.set(k, { at: now, data });
        if (cache.size > 300) cache.delete(cache.keys().next().value);
        return responder(200, data);
      } catch (err) {
        responder(502, {
          error: 'No he podido consultar WiGLE',
          detalle: String(err?.message || err).slice(0, 160),
        });
      }
    });
  };

  return {
    name: 'wifi-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
