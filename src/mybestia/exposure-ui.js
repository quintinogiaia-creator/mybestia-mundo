/**
 * Capa "Exposición" de MyBestia (Francis 2026-10-03): un buscador donde metes
 * una IP o un dominio y el mundo vuela hasta ahí y enseña una tarjeta con sus
 * puertos, servicios y vulnerabilidades conocidas. Datos de Shodan InternetDB
 * (gratis, sin clave) vía /api/exposure. Mirar un objetivo elegido, nunca
 * barrer a terceros. Módulo autónomo: no toca el sistema de plantillas; crea
 * su propio DOM y usa window.__godsEyeView.viewer cuando ya existe.
 */
import * as Cesium from 'cesium';

const ID = 'mb-exposure';

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
  #${ID}{position:fixed;left:16px;bottom:16px;z-index:150;width:min(92vw,360px);font-family:'JetBrains Mono',monospace}
  #${ID} .mb-exp-bar{display:flex;gap:6px;background:rgba(6,10,14,.92);border:1px solid rgba(0,255,65,.4);border-radius:12px;padding:6px;backdrop-filter:blur(10px)}
  #${ID} input{flex:1;background:transparent;border:none;color:#e8ecf5;font:inherit;font-size:13px;padding:6px 8px;outline:none}
  #${ID} button{background:#00ff41;color:#04120a;border:none;border-radius:8px;font-weight:700;padding:0 12px;cursor:pointer;font:inherit;font-size:12px}
  #${ID} button:disabled{opacity:.4;cursor:default}
  #${ID} .mb-exp-card{margin-bottom:8px;background:rgba(6,10,14,.95);border:1px solid rgba(0,255,65,.35);border-radius:12px;padding:12px 14px;color:#e8ecf5;max-height:50vh;overflow:auto;animation:mbexpin .25s ease both}
  @keyframes mbexpin{from{opacity:0;transform:translateY(8px)}}
  #${ID} .mb-exp-card h3{margin:0 0 2px;font-size:14px;color:#00ff41;word-break:break-all}
  #${ID} .mb-exp-card .mb-sub{color:#8b93a7;font-size:11px;margin-bottom:8px}
  #${ID} .mb-exp-card .mb-row{font-size:12px;margin:5px 0;line-height:1.5}
  #${ID} .mb-exp-card .mb-k{color:#8b93a7}
  #${ID} .mb-chip{display:inline-block;background:rgba(0,255,65,.12);border:1px solid rgba(0,255,65,.3);border-radius:999px;padding:1px 8px;margin:2px 3px 0 0;font-size:11px}
  #${ID} .mb-vuln{display:inline-block;background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.4);color:#ff9b9b;border-radius:999px;padding:1px 8px;margin:2px 3px 0 0;font-size:11px}
  #${ID} .mb-exp-close{float:right;background:none;color:#8b93a7;border:none;cursor:pointer;font-size:14px;padding:0}
  #${ID} .mb-exp-err{color:#ff9b9b;font-size:12px}
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

  const ficha = (d) => {
    const chips = (arr, cls) => arr.length ? arr.map((x) => `<span class="${cls}">${x}</span>`).join('') : '<span class="mb-k">—</span>';
    const u = d.ubicacion;
    const vuln = (d.vulns_detalle || []).map((c) => {
      const grave = c.cvss >= 9 || c.kev;
      const sev = c.cvss != null ? ` ${c.cvss}` : '';
      return `<span class="mb-vuln${grave ? ' alta' : ''}" title="${(c.summary || '').replace(/"/g, '')}">${c.kev ? '🔥 ' : ''}${c.id}${sev}</span>`;
    }).join('');
    const resto = Math.max(0, d.vulnerabilidades.length - (d.vulns_detalle || []).length);
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
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

    card.innerHTML = `
      <button class="mb-exp-close" aria-label="Cerrar">✕</button>
      <h3>${esc(d.objetivo)}</h3>
      <div class="mb-sub">${esc(d.ip)}${u ? ` · ${esc([u.ciudad, u.pais].filter(Boolean).join(', '))}` : ''}${red?.red ? ` · ${esc(red.red)}` : ''}</div>
      <div class="mb-row"><span class="mb-k">Resumen:</span> ${esc(d.titular)}${d.criticas ? ` · <b style="color:#ff6b6b">${d.criticas} crítica(s)</b>` : ''}</div>
      ${sec('🌐 Servidor web', webHtml)}
      ${d.puertos.length ? sec('🔌 Puertos / servicios', chips(d.servicios, 'mb-chip')) : ''}
      ${d.vulnerabilidades.length ? `<div class="mb-row"><span class="mb-k">⚠️ Vulnerabilidades (${d.vulnerabilidades.length}, 🔥 = explotada):</span><br>${vuln}${resto ? ` <span class="mb-k">y ${resto} más</span>` : ''}</div>` : ''}
      ${cert ? sec(`🔐 Subdominios (${cert.total})${cert.emisor ? ` · cert. de ${esc(cert.emisor)}` : ''}`, cert.muestra.length ? chips(cert.muestra.map(esc), 'mb-chip') : '<span class="mb-k">—</span>') : ''}
      ${dns ? sec('📧 Correo (MX)', dns.mx.length ? chips(dns.mx.map(esc), 'mb-chip') : '<span class="mb-k">—</span>') : ''}
      ${dns?.ns?.length ? sec('🗂️ Servidores DNS', chips(dns.ns.map(esc), 'mb-chip')) : ''}
      ${sec('🏷️ Dominio', domHtml)}
      ${fx ? `<div class="mb-row"><span class="mb-k">Buenas prácticas:</span> security.txt ${fx.security_txt ? '✅' : '❌'} · robots.txt ${fx.robots_txt ? '✅' : '❌'}</div>` : ''}
      ${d.etiquetas.length ? sec('Etiquetas', chips(d.etiquetas.map(esc), 'mb-chip')) : ''}
      ${d.nota ? `<div class="mb-row mb-k">${esc(d.nota)}</div>` : ''}
      <div class="mb-row mb-k" style="margin-top:8px;font-size:10px">Fuentes: ${esc(d.fuente)}. Datos públicos, solo lectura.</div>`;
    card.hidden = false;
    card.querySelector('.mb-exp-close').onclick = () => { card.hidden = true; };
  };

  const pintar = (d) => {
    const v = window.__godsEyeView?.viewer;
    if (v && d.ubicacion) {
      const { lat, lon } = d.ubicacion;
      const peligro = (d.criticas || 0) > 0 ? '#ff3b3b' : d.vulnerabilidades.length ? '#ffb020' : '#00ff41';
      const color = Cesium.Color.fromCssColorString(peligro);
      // Quitar un marcador anterior del mismo objetivo para no duplicar.
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
      if (!r.ok) { card.innerHTML = `<button class="mb-exp-close">✕</button><div class="mb-exp-err">${d.error || 'Error'}</div>`; card.hidden = false; card.querySelector('.mb-exp-close').onclick = () => { card.hidden = true; }; }
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

  // Clic en un marcador del mapa → vuela a él y abre su ficha.
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
