/**
 * Interfaz propia de MYBESTIA Mundo (Francis 2026-10-03: "se parece muchísimo
 * al original, es justo lo que no quiero" y "los paneles en medio joden las
 * vistas"). Escondemos TODA la interfaz del original y ponemos la nuestra:
 * mapa limpio a pantalla completa, marca arriba, una barra pequeña abajo y un
 * cajón (cerrado por defecto) con las capas en español y el buscador de
 * seguridad. Manejamos el motor por su API (dataManager / viewer), sin tocar
 * sus plantillas.
 */
import * as Cesium from 'cesium';
import './shell.css';

// Solo capas que funcionan sin clave y tienen sentido fuera de EE. UU.
const CAPAS = [
  { id: 'flights', icono: '✈️', nombre: 'Vuelos en directo', fuente: 'OpenSky' },
  { id: 'military', icono: '🎖️', nombre: 'Aviones militares', fuente: 'adsb.lol' },
  { id: 'satellites', icono: '🛰️', nombre: 'Satélites', fuente: 'CelesTrak' },
  { id: 'rocket-launches', icono: '🚀', nombre: 'Lanzamientos (30 días)', fuente: 'Launch Library' },
  { id: 'earthquakes', icono: '🌋', nombre: 'Terremotos (24 h)', fuente: 'USGS' },
  { id: 'wind', icono: '🌬️', nombre: 'Viento', fuente: 'GFS / ECMWF' },
  { id: 'cctv', icono: '📹', nombre: 'Cámaras públicas', fuente: 'CCTV abiertas' },
  { id: 'telegeography-submarine-cables', icono: '🌊', nombre: 'Cables submarinos', fuente: 'TeleGeography' },
  { id: 'radio', icono: '📻', nombre: 'Radios del mundo', fuente: 'Radio Browser' },
];

const VISTAS = {
  palma: { lon: 2.6455, lat: 39.5545, alt: 900, heading: 10, pitch: -28 },
  planeta: { lon: 2.65, lat: 30, alt: 16000000, heading: 0, pitch: -90 },
};

function esperar(fn, timeout = 40000) {
  return new Promise((res) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      const v = fn();
      if (v || Date.now() - t0 > timeout) {
        clearInterval(i);
        res(v || null);
      }
    }, 300);
  });
}

function volar(nombre) {
  const v = window.__godsEyeView?.viewer;
  const p = VISTAS[nombre];
  if (!v || !p) return;
  v.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
    orientation: {
      heading: Cesium.Math.toRadians(p.heading),
      pitch: Cesium.Math.toRadians(p.pitch),
      roll: 0,
    },
    duration: 3,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

function montar() {
  document.body.classList.add('mb-shell');

  const marca = document.createElement('a');
  marca.id = 'mb-marca';
  marca.href = 'https://mybestia.com';
  marca.title = 'Volver a mybestia.com';
  marca.innerHTML = '<span class="mb-logo">M</span><b>MYBESTIA</b><span class="mb-sub">Mundo</span>';

  const barra = document.createElement('nav');
  barra.id = 'mb-barra';
  barra.setAttribute('aria-label', 'Controles del mundo');
  barra.innerHTML = `
    <button type="button" data-vista="palma"><span>📍</span>Palma</button>
    <button type="button" data-vista="planeta"><span>🌍</span>Planeta</button>
    <button type="button" data-abrir="capas"><span>◎</span>Capas<em class="mb-n" hidden></em></button>
    <button type="button" data-abrir="seguridad"><span>🛡️</span>Seguridad</button>`;

  const cajon = document.createElement('aside');
  cajon.id = 'mb-cajon';
  cajon.setAttribute('aria-hidden', 'true');
  cajon.innerHTML = `
    <header>
      <div class="mb-tabs" role="tablist">
        <button type="button" role="tab" data-tab="capas">Capas en vivo</button>
        <button type="button" role="tab" data-tab="seguridad">Seguridad</button>
      </div>
      <button type="button" class="mb-cerrar" aria-label="Cerrar">✕</button>
    </header>
    <section data-panel="capas">
      <p class="mb-ayuda">Enciende lo que quieras ver encima del mapa. Datos públicos y en directo.</p>
      <ul class="mb-capas">
        ${CAPAS.map((c) => `
          <li><label>
            <span class="mb-ico">${c.icono}</span>
            <span class="mb-txt"><b>${c.nombre}</b><small>${c.fuente}</small></span>
            <input type="checkbox" data-capa="${c.id}"><i class="mb-sw"></i>
          </label></li>`).join('')}
      </ul>
    </section>
    <section data-panel="seguridad" hidden>
      <p class="mb-ayuda">Mete una IP o un dominio: el mapa vuela hasta allí y te enseña sus puertos abiertos y fallos conocidos (Shodan InternetDB, un objetivo cada vez).</p>
      <div class="mb-hueco-exp"></div>
    </section>`;

  document.body.append(marca, barra, cajon);

  const dm = () => window.__godsEyeView?.dataManager;
  const checks = [...cajon.querySelectorAll('[data-capa]')];
  const contador = barra.querySelector('.mb-n');

  const sincronizar = () => {
    const d = dm();
    if (!d) return;
    let n = 0;
    checks.forEach((c) => {
      const on = Boolean(d.isEnabled?.(c.dataset.capa));
      if (!c.dataset.ocupado) c.checked = on;
      if (on) n += 1;
    });
    contador.hidden = n === 0;
    contador.textContent = String(n);
  };

  checks.forEach((c) => {
    c.addEventListener('change', async () => {
      const d = dm();
      if (!d) return;
      c.dataset.ocupado = '1';
      c.closest('li').classList.add('cargando');
      try {
        await d.setEnabled(c.dataset.capa, c.checked, { origin: 'user' });
      } catch (e) {
        console.warn('[MyBestia] capa', c.dataset.capa, e);
      }
      delete c.dataset.ocupado;
      c.closest('li').classList.remove('cargando');
      sincronizar();
    });
  });

  const abrir = (tab) => {
    cajon.querySelectorAll('[data-tab]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.tab === tab)),
    );
    cajon.querySelectorAll('[data-panel]').forEach((p) => {
      p.hidden = p.dataset.panel !== tab;
    });
    barra.querySelectorAll('[data-abrir]').forEach((b) =>
      b.classList.toggle('activo', b.dataset.abrir === tab),
    );
    cajon.classList.add('abierto');
    cajon.setAttribute('aria-hidden', 'false');
    sincronizar();
  };
  const cerrar = () => {
    cajon.classList.remove('abierto');
    cajon.setAttribute('aria-hidden', 'true');
    barra.querySelectorAll('[data-abrir]').forEach((b) => b.classList.remove('activo'));
  };

  barra.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.vista) volar(b.dataset.vista);
    if (b.dataset.abrir) {
      const yaAbierto = cajon.classList.contains('abierto') && b.classList.contains('activo');
      yaAbierto ? cerrar() : abrir(b.dataset.abrir);
    }
  });
  cajon.querySelector('.mb-cerrar').addEventListener('click', cerrar);
  cajon.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => abrir(b.dataset.tab)),
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cajon.classList.contains('abierto')) cerrar();
  });

  // El buscador de exposición (exposure-ui.js) se mete dentro del cajón.
  esperar(() => document.getElementById('mb-exposure')).then((exp) => {
    if (exp) cajon.querySelector('.mb-hueco-exp').appendChild(exp);
  });

  // La bienvenida del original no se enseña: la cerramos por su propio botón
  // "Explorar" para que el motor quede en su estado normal.
  esperar(() => {
    const l = document.getElementById('first-run-launcher');
    return l && !l.hidden ? l : null;
  }, 60000).then((l) => {
    l?.querySelector('[data-first-run-choice="explore"]')?.click();
  });

  esperar(() => dm()).then(() => {
    sincronizar();
    setInterval(sincronizar, 3000);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montar, { once: true });
} else {
  montar();
}
