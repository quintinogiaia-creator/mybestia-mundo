/**
 * Capa "WiFi de la comunidad" de MYBESTIA (Francis 2026-10-03): pinta sobre el
 * globo las redes WiFi que la gente ha mapeado y publicado en WiGLE, SOLO del
 * trozo de mapa que estás mirando. Color por cifrado para ver de un vistazo las
 * abiertas (rojo) frente a las bien protegidas (verde). Datos públicos de la
 * comunidad, igual que las demás capas; no se conecta ni ataca a ninguna red.
 *
 * Usa el proveedor /api/wifi (server/providers/wifi.js). Sin clave de WiGLE la
 * capa avisa con honestidad y no pinta nada.
 */
import * as Cesium from 'cesium';

const COLORES = [
  Cesium.Color.fromCssColorString('#00ff41'), // riesgo 0: WPA2/WPA3 (verde)
  Cesium.Color.fromCssColorString('#ffd23f'), // riesgo 1: WPA / desconocido
  Cesium.Color.fromCssColorString('#ff8c00'), // riesgo 2: WEP
  Cesium.Color.fromCssColorString('#ff2d2d'), // riesgo 3: abierta
];

export function crearWifi() {
  let fuente = null;
  let visible = false;
  let onPick = null;
  let onCam = null;
  let timer = null;
  let ultimaClave = '';

  function viewer() {
    return window.__godsEyeView?.viewer || null;
  }

  function ventana(v) {
    const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
    if (!rect) return null;
    const g = Cesium.Math.toDegrees;
    return { n: g(rect.north), s: g(rect.south), e: g(rect.east), w: g(rect.west) };
  }

  async function refrescar() {
    const v = viewer();
    if (!v || !visible || !fuente) return;
    const q = ventana(v);
    if (!q) {
      estado('Acércate para ver las redes WiFi de la comunidad.');
      return;
    }
    const clave = [q.n, q.s, q.e, q.w].map((x) => x.toFixed(3)).join(',');
    if (clave === ultimaClave) return;
    ultimaClave = clave;

    let data;
    try {
      const r = await fetch(`/api/wifi?n=${q.n}&s=${q.s}&e=${q.e}&w=${q.w}`);
      data = await r.json();
      if (r.status === 503 && data?.error === 'no_key') {
        estado(data.mensaje || 'La capa WiFi necesita una clave gratis de WiGLE.');
        return;
      }
    } catch {
      estado('No he podido consultar WiGLE.');
      return;
    }
    if (data?.acercate || data?.limite) {
      estado(data.mensaje || '');
      return;
    }

    fuente.entities.removeAll();
    const redes = data?.redes || [];
    for (const red of redes.slice(0, 400)) {
      const color = COLORES[Math.min(3, Math.max(0, red.riesgo | 0))];
      const ent = fuente.entities.add({
        position: Cesium.Cartesian3.fromDegrees(red.lon, red.lat),
        point: {
          pixelSize: red.riesgo >= 3 ? 10 : 7,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      ent._mbWifi = red;
    }
    estado(redes.length ? '' : 'Aquí no hay redes mapeadas por la comunidad todavía.');
    v.scene.requestRender?.();
  }

  function estado(msg) {
    window.dispatchEvent(new CustomEvent('mb-wifi-estado', { detail: msg || '' }));
  }

  function programar() {
    clearTimeout(timer);
    timer = setTimeout(refrescar, 450);
  }

  function engancharPick(v) {
    if (onPick) return;
    onPick = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    onPick.setInputAction((mov) => {
      if (!visible) return;
      const hits = v.scene.drillPick(mov.position, 5) || [];
      let red = null;
      for (const h of hits) {
        if (h?.id?._mbWifi) { red = h.id._mbWifi; break; }
      }
      if (red) window.dispatchEvent(new CustomEvent('mb-wifi', { detail: red }));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  async function mostrar(si) {
    const v = viewer();
    if (!v) return;
    visible = si;
    if (si) {
      if (!fuente) {
        fuente = new Cesium.CustomDataSource('mb-wifi');
        v.dataSources.add(fuente);
      } else if (!v.dataSources.contains(fuente)) {
        v.dataSources.add(fuente);
      }
      engancharPick(v);
      if (!onCam) {
        onCam = () => programar();
        v.camera.moveEnd.addEventListener(onCam);
      }
      ultimaClave = '';
      refrescar();
    } else {
      if (fuente) fuente.entities.removeAll();
      if (onCam) {
        v.camera.moveEnd.removeEventListener(onCam);
        onCam = null;
      }
      estado('');
    }
    v.scene.requestRender?.();
  }

  return { mostrar, refrescar, get visible() { return visible; } };
}
