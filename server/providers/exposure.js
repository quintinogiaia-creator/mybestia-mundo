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

// ── Fuentes públicas extra (todas gratis y sin clave, solo del objetivo) ──

/** Registros DNS (correo, servidores, textos) con DNS over HTTPS de Google. */
async function registrosDns(host, opts) {
  const tipo = async (t) => {
    try {
      const { body } = await pedirJson(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${t}`, { ...opts, timeout: 6000 });
      return (body?.Answer || []).map((a) => String(a.data));
    } catch { return []; }
  };
  const [mx, ns, txt, aaaa] = await Promise.all([tipo('MX'), tipo('NS'), tipo('TXT'), tipo('AAAA')]);
  return {
    mx: mx.map((x) => x.replace(/^\d+\s+/, '').replace(/\.$/, '')).slice(0, 6),
    ns: ns.map((x) => x.replace(/\.$/, '')).slice(0, 6),
    txt: txt.map((x) => x.replace(/^"|"$/g, '')).slice(0, 8),
    ipv6: aaaa.slice(0, 3),
  };
}

/** Subdominios y emisor del certificado, desde Certificate Transparency (crt.sh). */
async function certificados(host, opts) {
  try {
    const { status, body } = await pedirJson(`https://crt.sh/?q=${encodeURIComponent('%.' + host)}&output=json`, { ...opts, timeout: 15000 });
    if (status !== 200 || !Array.isArray(body)) return null;
    const subs = new Set();
    let emisor = null;
    for (const fila of body) {
      String(fila.name_value || '').split(/\n/).forEach((n) => {
        n = n.trim().toLowerCase();
        if (n && !n.startsWith('*') && n.endsWith(host)) subs.add(n);
      });
      if (!emisor && fila.issuer_name) {
        const m = /O=([^,]+)/.exec(fila.issuer_name);
        emisor = m ? m[1].replace(/"/g, '') : null;
      }
    }
    subs.delete(host);
    return { total: subs.size, muestra: [...subs].sort().slice(0, 12), emisor };
  } catch { return null; }
}

/** Quién registró el dominio y su red/ASN, con RDAP (rdap.org, gratis). */
async function rdapDominio(host, opts) {
  try {
    const { status, body } = await pedirJson(`https://rdap.org/domain/${encodeURIComponent(host)}`, { ...opts, timeout: 7000 });
    if (status !== 200 || !body) return null;
    const ev = (accion) => (body.events || []).find((e) => e.eventAction === accion)?.eventDate || null;
    const registrador = (body.entities || []).find((e) => (e.roles || []).includes('registrar'));
    let nombreReg = null;
    const vc = registrador?.vcardArray?.[1] || [];
    for (const campo of vc) if (campo[0] === 'fn') nombreReg = campo[3];
    return {
      registrador: nombreReg,
      creado: ev('registration'),
      expira: ev('expiration'),
      estado: (body.status || []).slice(0, 4),
    };
  } catch { return null; }
}

/** ASN y organización de la red de la IP (RDAP de IP, gratis). */
async function rdapIp(ip, opts) {
  try {
    const { status, body } = await pedirJson(`https://rdap.org/ip/${encodeURIComponent(ip)}`, { ...opts, timeout: 7000 });
    if (status !== 200 || !body) return null;
    return { red: body.name || null, rango: body.handle || null, pais: body.country || null };
  } catch { return null; }
}

const CAB_SEG = [
  ['strict-transport-security', 'HSTS (fuerza HTTPS)'],
  ['content-security-policy', 'CSP (anti-inyección)'],
  ['x-frame-options', 'Anti-clickjacking'],
  ['x-content-type-options', 'Anti-sniffing'],
  ['referrer-policy', 'Política de referrer'],
  ['permissions-policy', 'Permisos del navegador'],
];

/** Cabeceras del sitio web: qué software corre y qué protecciones le faltan. */
async function cabecerasWeb(host, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://${host}`, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (mybestia-mundo auditoria)' },
    });
    const h = r.headers;
    const presentes = [];
    const faltan = [];
    for (const [clave, etq] of CAB_SEG) (h.get(clave) ? presentes : faltan).push(etq);
    const cuerpo = await r.text().catch(() => '');
    const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(cuerpo);
    return {
      servidor: h.get('server') || null,
      tecnologia: h.get('x-powered-by') || (gen ? gen[1] : null),
      https: true,
      seguridad_ok: presentes,
      seguridad_falta: faltan,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** ¿Tiene el sitio security.txt (canal para avisar de fallos) y robots.txt? */
async function ficheros(host, opts) {
  const probar = async (ruta) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`https://${host}${ruta}`, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'mybestia-mundo/1.0' } });
      return r.ok;
    } catch { return false; } finally { clearTimeout(t); }
  };
  const [sec, sec2, robots] = await Promise.all([
    probar('/.well-known/security.txt'), probar('/security.txt'), probar('/robots.txt'),
  ]);
  return { security_txt: sec || sec2, robots_txt: robots };
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

        const esDominio = !!host;
        const [db, geo, dns, cert, rdapDom, rdapNet, web, files] = await Promise.all([
          pedirJson(`${INTERNETDB}/${ip}`, { signal: req.signal }),
          pedirJson(`${GEO}/${ip}?fields=status,country,regionName,city,lat,lon,isp,org&lang=es`, { signal: req.signal }),
          esDominio ? registrosDns(host, { signal: req.signal }) : Promise.resolve(null),
          esDominio ? certificados(host, { signal: req.signal }) : Promise.resolve(null),
          esDominio ? rdapDominio(host, { signal: req.signal }) : Promise.resolve(null),
          rdapIp(ip, { signal: req.signal }),
          esDominio ? cabecerasWeb(host, { signal: req.signal }) : Promise.resolve(null),
          esDominio ? ficheros(host, { signal: req.signal }) : Promise.resolve(null),
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
          dns: dns || null,
          certificados: cert || null,
          dominio: rdapDom || null,
          red: rdapNet || null,
          web: web || null,
          ficheros: files || null,
          ...resumen(d),
          fuente: 'Shodan InternetDB + CVEDB · ip-api · DNS Google · crt.sh · RDAP (rdap.org) — todo gratis',
          nota: db.status === 200 ? '' : 'Shodan no tiene puertos indexados de esta IP (normal en webs pequeñas).',
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
