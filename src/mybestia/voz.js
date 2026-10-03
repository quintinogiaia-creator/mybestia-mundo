/**
 * Voz GRATIS de MyBestia Mundo (Francis 2026-10-03: "la voz que sea gratis, no
 * la de OpenAI, pero que funcione igual en el programa").
 *
 * El motor trae voz por OpenAI Realtime (de pago). Esto es una alternativa
 * independiente y SIN COSTE: usa la voz del propio navegador.
 *   - Oír: Web Speech API (SpeechRecognition), en español, gratis y sin clave.
 *   - Entender: un intérprete local de órdenes (volar a un sitio, encender/
 *     apagar capas, cambiar de vista). Sin servidor ni modelo de pago.
 *   - Actuar: mueve el MISMO globo (window.__godsEyeView.viewer / dataManager).
 *   - Hablar: speechSynthesis del navegador (gratis).
 *   - Geocodificar sitios: Nominatim de OpenStreetMap (gratis, sin clave).
 *
 * No toca el sistema realtime del motor. Si el navegador no soporta Web Speech,
 * el botón lo dice y no rompe nada.
 */
import * as Cesium from 'cesium';

// Nombre hablado -> id de capa del motor (los de shell.js CAPAS).
const CAPAS = {
  'vuelos': 'flights', 'aviones': 'flights',
  'militares': 'military', 'aviones militares': 'military',
  'satelites': 'satellites', 'satélites': 'satellites',
  'lanzamientos': 'rocket-launches', 'cohetes': 'rocket-launches',
  'terremotos': 'earthquakes', 'seismos': 'earthquakes',
  'viento': 'wind',
  'camaras': 'cctv', 'cámaras': 'cctv', 'camaras publicas': 'cctv',
  'cables': 'telegeography-submarine-cables', 'cables submarinos': 'telegeography-submarine-cables',
  'radio': 'radio', 'radios': 'radio',
};

function sinTildes(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function crearVoz() {
  const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let activa = false;
  let onEstado = null;

  function soportada() {
    return Boolean(Recog) && 'speechSynthesis' in window;
  }

  function hablar(texto) {
    try {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-ES';
      u.rate = 1.0;
      const voces = window.speechSynthesis.getVoices();
      const es = voces.find((v) => v.lang?.startsWith('es'));
      if (es) u.voice = es;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* sin voz, seguimos */ }
  }

  function estado(txt) {
    if (onEstado) onEstado(txt);
  }

  function viewer() {
    return window.__godsEyeView?.viewer || null;
  }
  function dm() {
    return window.__godsEyeView?.dataManager || null;
  }

  async function volarASitio(nombre) {
    estado(`Buscando ${nombre}…`);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(nombre)}`,
        { headers: { 'Accept-Language': 'es' } },
      );
      const d = await r.json();
      if (!d?.length) { hablar(`No encuentro ${nombre}`); estado(''); return; }
      const lat = parseFloat(d[0].lat);
      const lon = parseFloat(d[0].lon);
      const v = viewer();
      if (!v) return;
      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 2500),
        orientation: { pitch: Cesium.Math.toRadians(-35) },
        duration: 3,
      });
      hablar(`Volando a ${nombre}`);
    } catch {
      hablar(`No he podido ir a ${nombre}`);
    }
    estado('');
  }

  function cambiarVista(destino) {
    // Reutiliza los botones de vista del shell (Palma / Planeta).
    const b = document.querySelector(`#mb-barra [data-vista="${destino}"]`);
    if (b) { b.click(); return true; }
    return false;
  }

  function capa(texto, encender) {
    const key = sinTildes(texto);
    let id = CAPAS[key];
    if (!id) {
      // coincidencia parcial: "enciende los vuelos" -> busca 'vuelos'
      for (const k of Object.keys(CAPAS)) {
        if (key.includes(sinTildes(k))) { id = CAPAS[k]; break; }
      }
    }
    // Capas propias de MyBestia por interruptor del shell.
    if (!id) {
      if (key.includes('wifi')) return clickCheck('[data-wifi]', encender);
      if (key.includes('planeta') || key.includes('conectado')) return clickCheck('[data-planeta]', encender);
    }
    if (!id) { hablar('No sé qué capa es esa'); return false; }
    const d = dm();
    if (!d) return false;
    try {
      d.setEnabled(id, encender, { origin: 'user' });
      hablar(`${encender ? 'Encendido' : 'Apagado'}: ${texto}`);
      return true;
    } catch { return false; }
  }

  function clickCheck(sel, encender) {
    const c = document.querySelector(sel);
    if (!c) return false;
    if (c.checked !== encender) c.click();
    hablar(`${encender ? 'Encendido' : 'Apagado'}`);
    return true;
  }

  function procesar(textoBruto) {
    const t = sinTildes(textoBruto);
    estado(`"${textoBruto}"`);

    // Vistas
    if (/\b(planeta|mundo|tierra|espacio)\b/.test(t) && !/enciende|apaga|pon|quita/.test(t)) {
      if (cambiarVista('planeta')) { hablar('Vista del planeta'); return; }
    }
    if (/\bpalma\b/.test(t) && !/vuela|ve a|ir a/.test(t)) {
      if (cambiarVista('palma')) { hablar('Vamos a Palma'); return; }
    }
    // Encender / apagar capas
    let m = t.match(/(?:enciende|pon|activa|muestra|ensena|saca)\s+(?:la |el |los |las )?(.+)/);
    if (m) { capa(m[1], true); return; }
    m = t.match(/(?:apaga|quita|oculta|desactiva|cierra)\s+(?:la |el |los |las )?(.+)/);
    if (m) { capa(m[1], false); return; }
    // Volar a un sitio
    m = t.match(/(?:vuela|ve|vete|ir|llevame|vamos|ensename|muestrame)\s+a\s+(.+)/);
    if (m) { volarASitio(m[1].replace(/\bpor favor\b/g, '').trim()); return; }

    hablar('No te he entendido. Dime: vuela a Madrid, enciende los vuelos, o planeta.');
  }

  function iniciar() {
    if (!Recog) return;
    recog = new Recog();
    recog.lang = 'es-ES';
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      if (r && r.isFinal) procesar(r[0].transcript.trim());
    };
    recog.onerror = (e) => { if (e.error === 'not-allowed') { estado('Permite el micrófono'); parar(); } };
    recog.onend = () => { if (activa) { try { recog.start(); } catch {} } };
    try { recog.start(); } catch {}
  }

  function parar() {
    activa = false;
    estado('');
    try { recog?.stop(); } catch {}
    recog = null;
  }

  function alternar() {
    if (!soportada()) {
      estado('Tu navegador no soporta voz. Usa Chrome.');
      return false;
    }
    activa = !activa;
    if (activa) {
      iniciar();
      estado('Escuchando… di "vuela a Madrid" o "enciende los vuelos"');
      hablar('Te escucho');
    } else {
      parar();
    }
    return activa;
  }

  return {
    alternar,
    soportada,
    set onEstado(fn) { onEstado = fn; },
    get activa() { return activa; },
  };
}
