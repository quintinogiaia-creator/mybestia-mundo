/**
 * Exposición (estilo Shodan, GRATIS y sin clave) — Francis 2026-10-03.
 *
 * Proxy de la API pública InternetDB de Shodan (https://internetdb.shodan.io),
 * que es gratuita y no necesita clave. Dado UNA IP o dominio que el usuario
 * elige, devuelve lo que YA está indexado y es público: puertos abiertos,
 * servicios (CPE), etiquetas y vulnerabilidades conocidas (CVE). Además
 * geolocaliza la IP (ip-api.com, gratis) para poder volar hasta ella.
 *
 * Límite de diseño (deliberado): es una consulta de UN objetivo elegido por el
 * usuario, como un nmap de datos públicos. NO barre rangos ni enumera ciudades
 * enteras: eso sería construir un mapa de dianas de terceros. El servidor lo
 * impide — solo acepta un target por petición.
 */

const INTERNETDB = 'https://internetdb.shodan.io';
const GEO = 'http://ip-api.com/json';
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;
const PRIVATE_RE = /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|22[4-9]\.|2[345]\d\.)/;

const PUERTO_NOMBRE = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'correo (SMTP)', 53: 'DNS',
  80: 'web (HTTP)', 110: 'correo (POP3)', 143: 'correo (IMAP)', 443: 'web segura (HTTPS)',
  445: 'red Windows (SMB)', 1433: 'base de datos SQL Server', 3306: 'base de datos MySQL',
  3389: 'escritorio remoto (RDP)', 5432: 'base de datos PostgreSQL', 5900: 'escritorio remoto (VNC)',
  6379: 'base de datos Redis', 8080: 'web (alternativo)', 9200: 'Elasticsearch', 27017: 'base de datos MongoDB',
};

async function pedirJson(url, { signal, timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const quitar = signal
    ? () => ctrl.abort()
    : null;
  if (signal) signal.addEventListener('abort', quitar, { once: true });
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'mybestia-mundo/1.0' } });
    return { status: r.status, body: await r.json().catch(() => null) };
  } finally {
    clearTimeout(t);
    if (signal && quitar) signal.removeEventListener('abort', quitar);
  }
}

/** Resuelve un dominio a su primera IPv4 pública, con la API DNS de Google (gratis). */
async function resolverDominio(host, opts) {
  const { body } = await pedirJson(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`, opts);
  const ip = (body?.Answer || []).map((a) => a.data).find((d) => IP_RE.test(d));
  return ip || null;
}

// Detalle de CVE desde CVEDB de Shodan (gratis, sin clave): gravedad (CVSS),
// si está explotada de verdad (KEV) y un resumen. Cacheado en memoria.
const _cveCache = new Map();
async function detalleCve(id, opts) {
  if (_cveCache.has(id)) return _cveCache.get(id);
  try {
    const { status, body } = await pedirJson(`https://cvedb.shodan.io/cve/${encodeURIComponent(id)}`, { ...opts, timeout: 7000 });
    const d = status === 200 && body ? { id, cvss: body.cvss ?? null, kev: !!body.kev, summary: String(body.summary || '').slice(0, 220) } : { id, cvss: null, kev: false, summary: '' };
    _cveCache.set(id, d);
    if (_cveCache.size > 4000) _cveCache.delete(_cveCache.keys().next().value);
    return d;
  } catch { return { id, cvss: null, kev: false, summary: '' }; }
}

function resumen({ ports = [], vulns = [], tags = [] }) {
  const servicios = ports.slice(0, 12).map((p) => PUERTO_NOMBRE[p] ? `${p} (${PUERTO_NOMBRE[p]})` : String(p));
  const partes = [];
  partes.push(ports.length ? `${ports.length} puerto(s) abiertos` : 'sin puertos abiertos visibles');
  if (vulns.length) partes.push(`${vulns.length} vulnerabilidad(es) conocidas`);
  if (tags.length) partes.push(tags.join(', '));
  return { titular: partes.join(' · '), servicios };
}

export function exposureProxy() {
  const cache = new Map(); // target -> { at, data }
  const TTL = 10 * 60_000;

  const installMiddleware = (server) => {
    server.middlewares.use('/api/exposure', async (req, res) => {
      const responder = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        if (req.method === 'GET' && req.url?.split('?')[0] === '/status') {
          return responder(200, { configured: true, source: 'shodan-internetdb', keyless: true });
        }
        const url = new URL(req.url, 'http://x');
        const target = String(url.searchParams.get('target') || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!target) return responder(400, { error: 'Falta el objetivo (una IP o un dominio)' });

        let ip = IP_RE.test(target) ? target : null;
        let host = ip ? null : target;
        if (!ip && !HOST_RE.test(target)) return responder(400, { error: 'Eso no parece una IP ni un dominio válido' });

        const now = Date.now();
        const hit = cache.get(target);
        if (hit && now - hit.at < TTL) return responder(200, hit.data);

        if (!ip) {
          ip = await resolverDominio(host, { signal: req.signal });
          if (!ip) return responder(404, { error: `No he podido resolver ${host}` });
        }
        if (PRIVATE_RE.test(ip)) return responder(400, { error: 'Esa IP es privada o reservada: no está en internet público' });

        const [db, geo] = await Promise.all([
          pedirJson(`${INTERNETDB}/${ip}`, { signal: req.signal }),
          pedirJson(`${GEO}/${ip}?fields=status,country,regionName,city,lat,lon,isp,org&lang=es`, { signal: req.signal }),
        ]);

        // InternetDB responde 404 cuando no tiene nada indexado de esa IP.
        const d = db.status === 200 ? db.body : { ip, ports: [], cpes: [], vulns: [], tags: [], hostnames: [] };
        const g = geo.body?.status === 'success' ? geo.body : null;
        // Enriquecer las 10 CVE más relevantes con su gravedad (el resto van en bruto).
        const detalle = (await Promise.all((d.vulns || []).slice(0, 10).map((id) => detalleCve(id, { signal: req.signal }))))
          .sort((a, b) => (Number(b.kev) - Number(a.kev)) || ((b.cvss || 0) - (a.cvss || 0)));
        const criticas = detalle.filter((c) => c.kev || (c.cvss || 0) >= 9).length;
        const data = {
          objetivo: target,
          ip,
          indexado: db.status === 200,
          hostnames: d.hostnames || [],
          puertos: d.ports || [],
          servicios_cpe: d.cpes || [],
          etiquetas: d.tags || [],
          vulnerabilidades: d.vulns || [],
          vulns_detalle: detalle,
          criticas,
          ubicacion: g ? { lat: g.lat, lon: g.lon, ciudad: g.city, region: g.regionName, pais: g.country, isp: g.isp, org: g.org } : null,
          ...resumen(d),
          fuente: 'Shodan InternetDB (gratis) + ip-api.com',
          nota: db.status === 200 ? '' : 'Shodan no tiene nada indexado de esta IP.',
        };
        cache.set(target, { at: now, data });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        return responder(200, data);
      } catch (err) {
        responder(502, { error: 'No he podido consultar la exposición', detalle: String(err?.message || err).slice(0, 160) });
      }
    });
  };

  return {
    name: 'exposure-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
