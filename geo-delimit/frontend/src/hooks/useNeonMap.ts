import { useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

export interface NeonStyle {
  cor: string;
  espessura: number;
  opacidade: number;
  brilho: boolean;
  animacao: boolean;
}

const SOURCE_ID = 'area-source';

const LAYERS = [
  // Order matters: bottom → top
  { id: 'area-fill',       type: 'fill' as const },
  { id: 'area-glow-outer', type: 'line' as const },
  { id: 'area-glow-mid',   type: 'line' as const },
  { id: 'area-line',       type: 'line' as const },
  { id: 'area-glow-inner', type: 'line' as const },
];

export function useNeonMap(style: NeonStyle) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  const initMap = useCallback((container: HTMLDivElement, token: string) => {
    if (mapRef.current) return;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container,
      style: token && token !== 'SUA_CHAVE_MAPBOX_AQUI'
        ? 'mapbox://styles/mapbox/dark-v11'
        : buildFallbackStyle(),
      center: [-47.9, -15.7],
      zoom: 4,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    map.on('load', () => {
      addSource(map);
      addLayers(map, style);
    });

    mapRef.current = map;
    containerRef.current = container;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update geometry ─────────────────────────────────────────────────────────
  const setGeometry = useCallback((geometry: GeoJSON.Geometry | null) => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (!geometry) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry }],
    });
  }, []);

  // ── Fit bounds ──────────────────────────────────────────────────────────────
  const fitToGeometry = useCallback((geometry: GeoJSON.Geometry) => {
    const map = mapRef.current;
    if (!map) return;

    try {
      // Simple bbox calculation without turf dependency in hook
      const coords = extractCoords(geometry);
      if (coords.length === 0) return;
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const bounds: mapboxgl.LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1100 });
    } catch {
      // ignore
    }
  }, []);

  // ── Update style paint ──────────────────────────────────────────────────────
  const applyStyle = useCallback((s: NeonStyle) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const safe = (fn: () => void) => { try { fn(); } catch { /* layer not ready */ } };

    safe(() => {
      map.setPaintProperty('area-fill', 'fill-color', s.cor);
      map.setPaintProperty('area-fill', 'fill-opacity', s.opacidade);
    });

    safe(() => {
      map.setPaintProperty('area-line', 'line-color', s.cor);
      map.setPaintProperty('area-line', 'line-width', s.espessura);
      map.setPaintProperty('area-line', 'line-opacity', 1);
    });

    safe(() => {
      const glow = s.brilho ? 0.09 : 0;
      const mid  = s.brilho ? 0.20 : 0;
      const inner = s.brilho ? 0.55 : 0;
      map.setPaintProperty('area-glow-outer', 'line-color', s.cor);
      map.setPaintProperty('area-glow-outer', 'line-opacity', glow);
      map.setPaintProperty('area-glow-outer', 'line-width', 20);
      map.setPaintProperty('area-glow-outer', 'line-blur', 14);

      map.setPaintProperty('area-glow-mid', 'line-color', s.cor);
      map.setPaintProperty('area-glow-mid', 'line-opacity', mid);
      map.setPaintProperty('area-glow-mid', 'line-width', 10);
      map.setPaintProperty('area-glow-mid', 'line-blur', 6);

      map.setPaintProperty('area-glow-inner', 'line-color', '#FFFFFF');
      map.setPaintProperty('area-glow-inner', 'line-opacity', inner);
      map.setPaintProperty('area-glow-inner', 'line-width', 1);
      map.setPaintProperty('area-glow-inner', 'line-blur', 1);
    });
  }, []);

  // React to style prop changes
  useEffect(() => {
    applyStyle(style);
  }, [style, applyStyle]);

  // ── Pulse animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    if (!style.animacao) return;

    let t = 0;
    const tick = () => {
      t += 0.025;
      const wave = 0.5 + 0.5 * Math.sin(t * Math.PI);
      const map = mapRef.current;
      if (map && map.isStyleLoaded()) {
        try {
          map.setPaintProperty('area-glow-mid', 'line-opacity', 0.1 + wave * 0.25);
          map.setPaintProperty('area-glow-outer', 'line-opacity', 0.04 + wave * 0.12);
          map.setPaintProperty('area-line', 'line-width', style.espessura + wave * 2.5);
        } catch { /* ignore */ }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [style.animacao, style.espessura]);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const destroyMap = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  return { initMap, setGeometry, fitToGeometry, applyStyle, destroyMap, mapRef };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addSource(map: mapboxgl.Map) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
}

function addLayers(map: mapboxgl.Map, style: NeonStyle) {
  const layerDefs: mapboxgl.AnyLayer[] = [
    {
      id: 'area-fill',
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': style.cor, 'fill-opacity': style.opacidade },
    },
    {
      id: 'area-glow-outer',
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': style.cor, 'line-width': 20, 'line-opacity': 0.09, 'line-blur': 14 },
    },
    {
      id: 'area-glow-mid',
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': style.cor, 'line-width': 10, 'line-opacity': 0.20, 'line-blur': 6 },
    },
    {
      id: 'area-line',
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': style.cor, 'line-width': style.espessura, 'line-opacity': 1 },
    },
    {
      id: 'area-glow-inner',
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.55, 'line-blur': 1 },
    },
  ];

  layerDefs.forEach(layer => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  });
}

function buildFallbackStyle(): mapboxgl.Style {
  return {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: 'osm-layer', type: 'raster', source: 'osm-tiles' },
    ],
  };
}

function extractCoords(geom: GeoJSON.Geometry): number[][] {
  switch (geom.type) {
    case 'Point': return [geom.coordinates as number[]];
    case 'MultiPoint':
    case 'LineString': return geom.coordinates as number[][];
    case 'MultiLineString':
    case 'Polygon': return (geom.coordinates as number[][][]).flat();
    case 'MultiPolygon': return (geom.coordinates as number[][][][]).flat(2);
    case 'GeometryCollection': return geom.geometries.flatMap(extractCoords);
    default: return [];
  }
}

export { LAYERS };
