/**
 * Capa "Exposición" de MyBestia (Francis 2026-10-03): un buscador donde metes
 * una IP o un dominio y el mundo vuela hasta ahí y enseña una tarjeta con sus
 * puertos, servicios y vulnerabilidades conocidas. Datos de Shodan InternetDB
 * (gratis, sin clave) vía /api/exposure. Mirar un objetivo elegido, nunca
 * barrer a terceros. Módulo autónomo: no toca el sistema de plantillas; crea
 * su propio DOM y usa window.__godsEyeView.viewer cuando ya existe.
 *
 * Panel "bipolar" (Francis 2026-10-03): un interruptor Atacar/Proteger. En cada
 * puerto y cada CVE, según el modo, propone la herramienta de Kali para
 * EXPLOTAR o la medida para PROTEGER. Los puertos y las CVE son enlaces
 * clicables (Shodan, Exploit-DB / NVD). Todo para pruebas propias y legales:
 * solo lectura de datos públicos de UN objetivo que tú eliges.
 */
import * as Cesium from 'cesium';

const ID = 'mb-exposure';

// ── Herramientas de Kali por servicio (atacar) y medidas (proteger) ──
// {ip}, {port} y {url} se sustituyen al vuelo. Herramientas estándar y
// conocidas; no exploits a medida. Para auditar lo tuyo o tu laboratorio.
const KALI = {
  21: { svc: 'FTP', atacar: ['nmap --script ftp-anon,ftp-vsftpd-backdoor -p21 {ip}', 'hydra -L users.txt -P rockyou.txt ftp://{ip}'], proteger: ['Desactiva el FTP anónimo; usa SFTP/FTPS', 'Limita el acceso por IP en el firewall'] },
  22: { svc: 'SSH', atacar: ['nmap --script ssh-auth-methods,ssh2-enum-algos -p22 {ip}', 'hydra -l root -P rockyou.txt ssh://{ip}'], proteger: ['Solo claves (desactiva login por contraseña)', 'Instala fail2ban', 'Allowlist de IP y, si puedes, otro puerto'] },
  23: { svc: 'Telnet', atacar: ['nmap --script telnet-encryption,telnet-ntlm-info -p23 {ip}', 'hydra -l admin -P rockyou.txt telnet://{ip}'], proteger: ['Apaga Telnet por completo y usa SSH'] },
  25: { svc: 'SMTP', atacar: ['nmap --script smtp-open-relay,smtp-commands -p25 {ip}', 'smtp-user-enum -M VRFY -U users.txt -t {ip}'], proteger: ['Cierra el relay abierto', 'SPF, DKIM y DMARC bien puestos'] },
  53: { svc: 'DNS', atacar: ['dig AXFR @{ip} dominio.com', 'dnsrecon -d dominio.com -n {ip}'], proteger: ['Desactiva la transferencia de zona (AXFR) a cualquiera'] },
  80: { svc: 'Web (HTTP)', atacar: ['whatweb {url}', 'nikto -h {url}', 'gobuster dir -u {url} -w /usr/share/wordlists/dirb/common.txt', 'sqlmap -u "{url}" --batch'], proteger: ['Pon HTTPS y redirige el 80', 'WAF (p. ej. Cloudflare)', 'Actualiza el CMS y los plugins'] },
  110: { svc: 'POP3', atacar: ['nmap --script pop3-capabilities,pop3-ntlm-info -p110 {ip}', 'hydra -l user -P rockyou.txt pop3://{ip}'], proteger: ['Usa POP3S (cifrado) y limita intentos'] },
  143: { svc: 'IMAP', atacar: ['nmap --script imap-capabilities,imap-ntlm-info -p143 {ip}', 'hydra -l user -P rockyou.txt imap://{ip}'], proteger: ['Usa IMAPS (cifrado) y limita intentos'] },
  443: { svc: 'Web segura (HTTPS)', atacar: ['whatweb {url}', 'nikto -h {url}', 'sslscan {ip}', 'gobuster dir -u {url} -w /usr/share/wordlists/dirb/common.txt'], proteger: ['TLS 1.2+ y buena nota en SSL Labs', 'Cabeceras de seguridad (HSTS, CSP…)', 'WAF y actualizaciones'] },
  445: { svc: 'SMB (Windows)', atacar: ['enum4linux -a {ip}', 'nmap --script "smb-vuln-*" -p445 {ip}', 'crackmapexec smb {ip}'], proteger: ['Desactiva SMBv1', 'Parchea MS17-010 (EternalBlue)', 'NO expongas el 445 a internet'] },
  1433: { svc: 'SQL Server', atacar: ['nmap --script ms-sql-info,ms-sql-empty-password -p1433 {ip}', 'hydra -l sa -P rockyou.txt mssql://{ip}'], proteger: ['No lo expongas a internet; solo red interna', 'Contraseña fuerte para sa y cifrado'] },
  3306: { svc: 'MySQL', atacar: ['nmap --script mysql-info,mysql-empty-password,mysql-brute -p3306 {ip}', 'hydra -l root -P rockyou.txt mysql://{ip}'], proteger: ['bind-address a localhost/red interna', 'Usuarios con contraseña fuerte, sin root remoto'] },
  3389: { svc: 'Escritorio remoto (RDP)', atacar: ['nmap --script rdp-ntlm-info,rdp-vuln-ms12-020 -p3389 {ip}', 'hydra -l administrator -P rockyou.txt rdp://{ip}'], proteger: ['Activa NLA', 'No expongas RDP: ponlo tras VPN', 'MFA y bloqueo por intentos'] },
  5432: { svc: 'PostgreSQL', atacar: ['nmap --script pgsql-brute -p5432 {ip}', 'hydra -l postgres -P rockyou.txt postgres://{ip}'], proteger: ['listen_addresses solo interno', 'pg_hba.conf estricto y contraseñas fuertes'] },
  5900: { svc: 'VNC', atacar: ['nmap --script vnc-info,vnc-brute -p5900 {ip}', 'hydra -P rockyou.txt vnc://{ip}'], proteger: ['Contraseña fuerte y cifrado', 'No lo expongas: solo por VPN/SSH túnel'] },
  6379: { svc: 'Redis', atacar: ['redis-cli -h {ip} info', 'nmap --script redis-info -p6379 {ip}'], proteger: ['requirepass activado', 'bind a localhost; nunca abierto a internet'] },
  8080: { svc: 'Web (alternativo)', atacar: ['whatweb {url}', 'nikto -h {url}', 'gobuster dir -u {url} -w /usr/share/wordlists/dirb/common.txt'], proteger: ['Cierra el panel si no se usa', 'Autenticación y actualizaciones'] },
  9200: { svc: 'Elasticsearch', atacar: ['curl -s {ip}:9200/_cat/indices', 'nmap --script http-elasticsearch-head -p9200 {ip}'], proteger: ['Activa seguridad (usuario/clave)', 'Nunca abierto a internet'] },
  27017: { svc: 'MongoDB', atacar: ['nmap --script mongodb-info,mongodb-databases -p27017 {ip}', 'mongo --host {ip} --eval "db.adminCommand(\'listDatabases\')"'], proteger: ['Activa autenticación', 'bindIp a interno; nunca abierto'] },
};

function toolsPuerto(port) {
  return KALI[port] || {
    svc: `puerto ${port}`,
    atacar: ['nmap -sV -sC -p{port} {ip}'],
    proteger: ['Cierra el puerto si no se usa', 'Mantén el servicio actualizado'],
  };
}

function esperarViewer(timeout = 30000) {
  return new Promise((res) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      const v = window.__godsEyeView?.viewer;
      if ((v && !v.isDestroyed?.()) || Date.now() - t0 > timeout) {
        clearInterval(i);
        res(v || null);
      }
    }, 300);
  });
}

function css() {
  if (document.getElementById(ID + '-css')) return;
  const s = document.createElement('style');
  s.id = ID + '-css';
  s.textContent = `
  #${ID}{position:fixed;left:16px;bottom:16px;z-index:150;width:min(94vw,440px);font-family:'JetBrains Mono',monospace}
  #${ID} .mb-exp-bar{display:flex;gap:6px;background:rgba(6,10,14,.92);border:1px solid rgba(0,255,65,.4);border-radius:12px;padding:6px;backdrop-filter:blur(10px)}
  #${ID} input{flex:1;background:transparent;border:none;color:#e8ecf5;font:inherit;font-size:14px;padding:7px 8px;outline:none}
  #${ID} .mb-exp-bar button[type=submit]{background:#00ff41;color:#04120a;border:none;border-radius:8px;font-weight:700;padding:0 14px;cursor:pointer;font:inherit;font-size:13px}
  #${ID} .mb-exp-quick{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}
  #${ID} .mb-exp-quick button{background:rgba(6,10,14,.8);color:#cfe8d6;border:1px solid rgba(0,255,65,.25);border-radius:999px;font:inherit;font-size:11px;padding:3px 10px;cursor:pointer}
  #${ID} button:disabled{opacity:.4;cursor:default}
  #${ID} .mb-exp-card{margin-bottom:8px;background:rgba(6,10,14,.96);border:1px solid rgba(0,255,65,.35);border-radius:14px;padding:14px 16px;color:#e8ecf5;max-height:72vh;overflow:auto;animation:mbexpin .25s ease both}
  @keyframes mbexpin{from{opacity:0;transform:translateY(8px)}}
  #${ID} .mb-exp-card h3{margin:0 0 2px;font-size:16px;color:#00ff41;word-break:break-all}
  #${ID} .mb-exp-card .mb-sub{color:#8b93a7;font-size:12px;margin-bottom:10px}
  #${ID} .mb-exp-card .mb-row{font-size:13px;margin:8px 0;line-height:1.55}
  #${ID} .mb-exp-card .mb-k{color:#8b93a7}
  #${ID} .mb-chip,#${ID} a.mb-chip{display:inline-block;background:rgba(0,255,65,.12);border:1px solid rgba(0,255,65,.3);border-radius:999px;padding:2px 9px;margin:3px 4px 0 0;font-size:12px;color:#d7ffe2;text-decoration:none}
  #${ID} a.mb-chip:hover{background:rgba(0,255,65,.22)}
  #${ID} .mb-vuln,#${ID} a.mb-vuln{display:inline-block;background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.4);color:#ff9b9b;border-radius:999px;padding:2px 9px;margin:3px 4px 0 0;font-size:12px;text-decoration:none}
  #${ID} a.mb-vuln:hover{background:rgba(255,80,80,.22)}
  #${ID} .mb-exp-close{float:right;background:none;color:#8b93a7;border:none;cursor:pointer;font-size:15px;padding:0}
  #${ID} .mb-exp-err{color:#ff9b9b;font-size:13px}
  /* Interruptor bipolar Atacar/Proteger */
  #${ID} .mb-modo{display:flex;gap:0;margin:10px 0 4px;border:1px solid rgba(255,255,255,.12);border-radius:999px;overflow:hidden;width:fit-content}
  #${ID} .mb-modo button{background:transparent;color:#8b93a7;border:none;font:inherit;font-size:12px;font-weight:700;padding:5px 14px;cursor:pointer}
  #${ID} .mb-modo button[aria-pressed=true][data-modo=atacar]{background:#ff2d2d;color:#190404}
  #${ID} .mb-modo button[aria-pressed=true][data-modo=proteger]{background:#00ff41;color:#04120a}
  /* Puerto desplegable con herramientas */
  #${ID} .mb-port{border:1px solid rgba(255,255,255,.1);border-radius:10px;margin:6px 0;overflow:hidden}
  #${ID} .mb-port>summary{list-style:none;cursor:pointer;padding:7px 10px;font-size:12.5px;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.04)}
  #${ID} .mb-port>summary::-webkit-details-marker{display:none}
  #${ID} .mb-port .mb-pnum{font-weight:700;color:#00ff41}
  #${ID} .mb-port[data-modo=atacar] .mb-pnum{color:#ff6b6b}
  #${ID} .mb-tools{padding:6px 10px 10px}
  #${ID} .mb-cmd{display:flex;align-items:center;gap:6px;background:#04120a;border:1px solid rgba(0,255,65,.18);border-radius:8px;padding:6px 8px;margin:5px 0;font-size:11.5px;color:#9cffb3;word-break:break-all}
  #${ID} .mb-port[data-modo=atacar] .mb-cmd{border-color:rgba(255,80,80,.25);color:#ffc2c2;background:#160404}
  #${ID} .mb-cmd code{flex:1}
  #${ID} .mb-copy{background:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#cbd2e0;font-size:10px;padding:2px 6px;cursor:pointer}
  #${ID} .mb-tip{font-size:12px;color:#bfe9c9;margin:5px 0;padding-left:14px;position:relative}
  #${ID} .mb-tip::before{content:'•';position:absolute;left:2px;color:#00ff41}
  @media(max-width:680px){#${ID}{left:8px;right:8px;width:auto;bottom:88px}}
  `;
  document.head.appendChild(s);
}

export function initExposureUI() {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  css();
  const root = document.createElement('div');
  root.id = ID;
  root.innerHTML = `
    <div class="mb-exp-card" hidden></div>
    <div class="mb-exp-quick">
      <button type="button" data-t="mybestia.com">🛡️ mi web</button>
      <button type="button" data-t="scanme.nmap.org">🎯 ejemplo</button>
      <button type="button" data-mi-ip>📍 mi IP</button>
      <button type="button" data-borrar hidden>🗑️ borrar</button>
    </div>
    <form class="mb-exp-bar" autocomplete="off">
      <input type="text" inputmode="url" placeholder="🔎 IP o dominio" aria-label="IP o dominio a consultar" />
      <button type="submit">Analizar</button>
    </form>`;
  document.body.appendChild(root);

  const form = root.querySelector('form');
  const input = root.querySelector('input');
  const btn = root.querySelector('button[type="submit"]');
  const card = root.querySelector('.mb-exp-card');
  const btnBorrar = root.querySelector('[data-borrar]');
  let entidades = [];
  let modo = 'atacar'; // 'atacar' | 'proteger' — el panel bipolar
  let ultimo = null; // último dato para repintar al cambiar de modo

  const limpiar = () => {
    const v = window.__godsEyeView?.viewer;
    entidades.forEach((e) => { try { v?.entities.remove(e); } catch {} });
    entidades = [];
    btnBorrar.hidden = true;
  };

  const volarA = (lat, lon) => {
    const v = window.__godsEyeView?.viewer;
    v?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 2500),
      orientation: { pitch: Cesium.Math.toRadians(-40) }, duration: 2.5 });
  };

  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // Bloque de herramientas de Kali para un puerto, según el modo.
  const bloqueTools = (port, ip, url) => {
    const t = toolsPuerto(port);
    const sub = (s) => s.replace(/\{ip\}/g, ip || '').replace(/\{port\}/g, port).replace(/\{url\}/g, url || `http://${ip}`);
    if (modo === 'atacar') {
      return t.atacar.map((c) => {
        const cmd = esc(sub(c));
        return `<div class="mb-cmd"><code>${cmd}</code><button class="mb-copy" data-cmd="${cmd}">copiar</button></div>`;
      }).join('');
    }
    return t.proteger.map((p) => `<div class="mb-tip">${esc(p)}</div>`).join('');
  };

  const ficha = (d) => {
    ultimo = d;
    const chips = (arr, cls) => arr.length ? arr.map((x) => `<span class="${cls}">${x}</span>`).join('') : '<span class="mb-k">—</span>';
    const u = d.ubicacion;
    const ip = d.ip;
    const esWeb = (d.puertos || []).some((p) => [80, 443, 8080].includes(p));
    const url = `http${(d.puertos || []).includes(443) ? 's' : ''}://${d.objetivo}`;

    // Puertos: cada uno desplegable, enlace a Shodan + herramientas por modo.
    const puertos = (d.puertos || []).map((p) => {
      const t = toolsPuerto(p);
      const shodan = `https://www.shodan.io/host/${encodeURIComponent(ip)}`;
      const abrir = [80, 443, 8080].includes(p)
        ? ` · <a class="mb-chip" href="${url.replace(/:\d+$/, '')}" target="_blank" rel="noopener">abrir</a>`
        : '';
      return `<details class="mb-port" data-modo="${modo}">
        <summary><span class="mb-pnum">${p}</span> ${esc(t.svc)}
          <a class="mb-chip" href="${shodan}" target="_blank" rel="noopener" title="Ver en Shodan">Shodan↗</a>${abrir}</summary>
        <div class="mb-tools">${bloqueTools(p, ip, url)}</div>
      </details>`;
    }).join('');

    // CVE: enlaces clicables. Atacar → Exploit-DB; Proteger → NVD (parche).
    const vuln = (d.vulns_detalle || []).map((c) => {
      const grave = c.cvss >= 9 || c.kev;
      const sev = c.cvss != null ? ` ${c.cvss}` : '';
      const href = modo === 'atacar'
        ? `https://www.exploit-db.com/search?cve=${encodeURIComponent(c.id)}`
        : `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c.id)}`;
      const t = (c.summary || '').replace(/"/g, '');
      return `<a class="mb-vuln${grave ? ' alta' : ''}" href="${href}" target="_blank" rel="noopener" title="${esc(t)}">${c.kev ? '🔥 ' : ''}${esc(c.id)}${sev}↗</a>`;
    }).join('');
    const resto = Math.max(0, (d.vulnerabilidades?.length || 0) - (d.vulns_detalle || []).length);

    const sec = (titulo, cuerpo) => cuerpo ? `<div class="mb-row"><span class="mb-k">${titulo}</span><br>${cuerpo}</div>` : '';
    const web = d.web, dns = d.dns, cert = d.certificados, dom = d.dominio, red = d.red, fx = d.ficheros;

    const webHtml = web ? [
      web.servidor ? `Servidor: <b>${esc(web.servidor)}</b>` : '',
      web.tecnologia ? `Tecnología: <b>${esc(web.tecnologia)}</b>` : '',
      web.seguridad_falta?.length ? `Le faltan: ${web.seguridad_falta.map((x) => `<span class="mb-vuln">${esc(x)}</span>`).join('')}` : '',
      web.seguridad_ok?.length ? `Tiene: ${web.seguridad_ok.map((x) => `<span class="mb-chip">${esc(x)}</span>`).join('')}` : '',
    ].filter(Boolean).join('<br>') : '';

    const domHtml = dom ? [
      dom.registrador ? `Registrador: <b>${esc(dom.registrador)}</b>` : '',
      dom.creado ? `Creado: ${esc(String(dom.creado).slice(0, 10))}` : '',
      dom.expira ? `Expira: ${esc(String(dom.expira).slice(0, 10))}` : '',
    ].filter(Boolean).join('<br>') : '';

    const modoBtns = `<div class="mb-modo" role="group" aria-label="Modo">
      <button type="button" data-modo="atacar" aria-pressed="${modo === 'atacar'}">🔴 Atacar</button>
      <button type="button" data-modo="proteger" aria-pressed="${modo === 'proteger'}">🟢 Proteger</button>
    </div>`;

    const ayudaModo = modo === 'atacar'
      ? 'Cada puerto despliega la herramienta de Kali para auditarlo. CVE → Exploit-DB.'
      : 'Cada puerto despliega cómo blindarlo. CVE → NVD (parche del fabricante).';

    card.innerHTML = `
      <button class="mb-exp-close" aria-label="Cerrar">✕</button>
      <h3>${esc(d.objetivo)}</h3>
      <div class="mb-sub">${esc(ip)}${u ? ` · ${esc([u.ciudad, u.pais].filter(Boolean).join(', '))}` : ''}${red?.red ? ` · ${esc(red.red)}` : ''}</div>
      <div class="mb-row"><span class="mb-k">Resumen:</span> ${esc(d.titular)}${d.criticas ? ` · <b style="color:#ff6b6b">${d.criticas} crítica(s)</b>` : ''}</div>
      ${modoBtns}
      <div class="mb-row mb-k" style="font-size:11px;margin-top:2px">${ayudaModo}</div>
      ${sec('🌐 Servidor web', webHtml)}
      ${(d.puertos || []).length ? `<div class="mb-row"><span class="mb-k">🔌 Puertos abiertos (${d.puertos.length}) — toca para ${modo === 'atacar' ? 'explotar' : 'proteger'}:</span>${puertos}</div>` : ''}
      ${(d.vulnerabilidades?.length) ? `<div class="mb-row"><span class="mb-k">⚠️ Vulnerabilidades (${d.vulnerabilidades.length}, 🔥 = explotada), toca una:</span><br>${vuln}${resto ? ` <span class="mb-k">y ${resto} más</span>` : ''}</div>` : ''}
      ${cert ? sec(`🔐 Subdominios (${cert.total})${cert.emisor ? ` · cert. de ${esc(cert.emisor)}` : ''}`, cert.muestra.length ? chips(cert.muestra.map(esc), 'mb-chip') : '<span class="mb-k">—</span>') : ''}
      ${dns ? sec('📧 Correo (MX)', dns.mx.length ? chips(dns.mx.map(esc), 'mb-chip') : '<span class="mb-k">—</span>') : ''}
      ${dns?.ns?.length ? sec('🗂️ Servidores DNS', chips(dns.ns.map(esc), 'mb-chip')) : ''}
      ${sec('🏷️ Dominio', domHtml)}
      ${fx ? `<div class="mb-row"><span class="mb-k">Buenas prácticas:</span> security.txt ${fx.security_txt ? '✅' : '❌'} · robots.txt ${fx.robots_txt ? '✅' : '❌'}</div>` : ''}
      ${d.etiquetas?.length ? sec('Etiquetas', chips(d.etiquetas.map(esc), 'mb-chip')) : ''}
      ${d.nota ? `<div class="mb-row mb-k">${esc(d.nota)}</div>` : ''}
      <div class="mb-row mb-k" style="margin-top:8px;font-size:10px">Fuentes: ${esc(d.fuente)}. Solo lectura, un objetivo tuyo. Úsalo en lo que te pertenece o en tu laboratorio.</div>`;
    card.hidden = false;

    card.querySelector('.mb-exp-close').onclick = () => { card.hidden = true; };
    // Interruptor bipolar: cambia el modo y repinta con el mismo objetivo.
    card.querySelectorAll('.mb-modo button').forEach((b) => {
      b.onclick = () => { modo = b.dataset.modo; if (ultimo) ficha(ultimo); };
    });
    // Copiar comando.
    card.querySelectorAll('.mb-copy').forEach((b) => {
      b.onclick = async (ev) => {
        ev.preventDefault();
        try { await navigator.clipboard.writeText(b.dataset.cmd); b.textContent = '✓'; setTimeout(() => (b.textContent = 'copiar'), 1200); } catch {}
      };
    });
  };

  const pintar = (d) => {
    const v = window.__godsEyeView?.viewer;
    if (v && d.ubicacion) {
      const { lat, lon } = d.ubicacion;
      const peligro = (d.criticas || 0) > 0 ? '#ff3b3b' : d.vulnerabilidades.length ? '#ffb020' : '#00ff41';
      const color = Cesium.Color.fromCssColorString(peligro);
      entidades.filter((e) => e.mbIp === d.ip).forEach((e) => { try { v.entities.remove(e); } catch {} });
      entidades = entidades.filter((e) => e.mbIp !== d.ip);
      const ent = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: { pixelSize: 15, color: color.withAlpha(0.9), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: d.ip, font: '13px JetBrains Mono', fillColor: Cesium.Color.WHITE,
          showBackground: true, backgroundColor: color.withAlpha(0.4), pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
      ent.mbIp = d.ip; ent.mbData = d;
      entidades.push(ent);
      btnBorrar.hidden = false;
      volarA(lat, lon);
    }
    ficha(d);
  };

  const analizar = async (target) => {
    if (!target) return;
    input.value = target;
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch(`/api/exposure?target=${encodeURIComponent(target)}`);
      const d = await r.json();
      if (!r.ok) { card.innerHTML = `<button class="mb-exp-close">✕</button><div class="mb-exp-err">${esc(d.error || 'Error')}</div>`; card.hidden = false; card.querySelector('.mb-exp-close').onclick = () => { card.hidden = true; }; }
      else pintar(d);
    } catch {
      card.innerHTML = `<div class="mb-exp-err">No he podido consultar. ¿Sin conexión?</div>`; card.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Analizar'; }
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); analizar(input.value.trim()); });
  root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => analizar(b.dataset.t)));
  btnBorrar.addEventListener('click', () => { limpiar(); card.hidden = true; });
  root.querySelector('[data-mi-ip]').addEventListener('click', async () => {
    try { const { ip } = await (await fetch('https://api.ipify.org?format=json')).json(); if (ip) analizar(ip); } catch {}
  });

  const viewer = window.__godsEyeView?.viewer;
  if (viewer) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((m) => {
      const picked = viewer.scene.pick(m.position);
      const d = picked?.id?.mbData;
      if (d?.ubicacion) { volarA(d.ubicacion.lat, d.ubicacion.lon); ficha(d); }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
}

esperarViewer().then((v) => { if (v) initExposureUI(); });
