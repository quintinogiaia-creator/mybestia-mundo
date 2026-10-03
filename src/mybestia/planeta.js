/**
 * "El planeta conectado" de MYBESTIA (Francis 2026-10-03): pinta cada país
 * según cuánta gente y aparatos tiene conectados a internet, para que el mundo
 * se vea "encendido". Dato REAL y agregado del Banco Mundial (usuarios de
 * internet y población, última cifra disponible). NO señala aparatos ajenos ni
 * da dianas: es una capa de contexto honesta, no un mapa de objetivos.
 *
 * Fuentes (keyless, gratis): api.worldbank.org IT.NET.USER.ZS + SP.POP.TOTL.
 * Polígonos: Natural Earth 110m (dominio público).
 */
import * as Cesium from 'cesium';
import datos from './data/conectividad.json';
import geo from './data/paises.json';

// Color por % de población con internet: cuanto más conectado, más verde y
// brillante; poco conectado = rojo apagado. Da contraste real entre países.
function color(pct) {
  const t = Math.min(1, Math.max(0, pct / 100));
  // De rojo-ámbar (poco) a verde MyBestia (mucho), pasando por amarillo.
  const r = Math.round(t < 0.5 ? 230 : 230 - (t - 0.5) * 2 * 200);
  const g = Math.round(t < 0.5 ? 70 + t * 2 * 170 : 240);
  const b = Math.round(30 + t * 25);
  // Color sólido (poca transparencia) para que se lea sobre el terreno.
  return Cesium.Color.fromBytes(r, g, b, 235);
}

export function crearPlaneta() {
  let fuente = null;
  let cargando = null;
  let visible = false;
  let onPick = null;

  const max = Math.max(
    ...Object.values(datos)
      .filter((d) => d.u)
      .map((d) => d.u),
  );

  async function asegurarCargado() {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer || fuente) return fuente;
    if (cargando) return cargando;
    cargando = Cesium.GeoJsonDataSource.load(geo, {
      clampToGround: true,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
    }).then((ds) => {
      ds.entities.values.forEach((ent) => {
        const iso = ent.properties?.iso?.getValue?.();
        const d = iso && datos[iso];
        if (!ent.polygon) return;
        // Pegado al suelo (drapeado sobre terreno y teselas 3D) para que se vea
        // desde el espacio sin hundirse bajo las montañas.
        ent.polygon.classificationType = Cesium.ClassificationType.BOTH;
        ent.polygon.outline = false;
        if (d) {
          ent.polygon.material = color(d.pct);
          ent._mb = d;
        } else {
          ent.polygon.material = Cesium.Color.fromBytes(40, 44, 52, 90);
        }
      });
      fuente = ds;
      return ds;
    });
    return cargando;
  }

  async function mostrar(si) {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return;
    visible = si;
    if (si) {
      const ds = await asegurarCargado();
      if (ds && !viewer.dataSources.contains(ds)) viewer.dataSources.add(ds);
      engancharPick(viewer);
    } else if (fuente && viewer.dataSources.contains(fuente)) {
      viewer.dataSources.remove(fuente, false);
    }
    viewer.scene.requestRender?.();
  }

  function engancharPick(viewer) {
    if (onPick) return;
    onPick = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    onPick.setInputAction((mov) => {
      if (!visible) return;
      const hits = viewer.scene.drillPick(mov.position, 5) || [];
      let ent = null;
      for (const h of hits) {
        if (h?.id?._mb) { ent = h.id; break; }
      }
      const d = ent?._mb;
      const nombre = ent?.properties?.name?.getValue?.();
      window.dispatchEvent(
        new CustomEvent('mb-pais', { detail: d ? { ...d, nombre } : null }),
      );
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  return { mostrar, get visible() { return visible; }, max };
}
