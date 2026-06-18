import { Router, Request, Response } from 'express';

const router = Router();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];
const USER_AGENT = 'GeoDelimit/1.0 (contato@geodelimit.app)';

// ─── GET /api/geocode/search?q=&limit=5 ──────────────────────────────────────
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) return res.status(400).json({ error: 'Parâmetro q é obrigatório' });

    const url = new URL(`${NOMINATIM_URL}/search`);
    url.searchParams.set('q', String(q));
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'br');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' },
    });

    if (!response.ok) {
      console.error('[geocode/search] Erro Nominatim, status:', response.status);
      return res.status(502).json({ error: 'Erro ao consultar serviço de geocodificação' });
    }

    const data = await response.json() as NominatimResult[];

    const results = data.map(item => ({
      osm_id: item.osm_id,
      osm_type: item.osm_type,
      display_name: item.display_name,
      nome: item.name || item.display_name.split(',')[0],
      tipo: mapNominatimType(item.type, item.class),
      municipio: item.address?.city || item.address?.town || item.address?.municipality,
      estado: item.address?.state,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      bbox: item.boundingbox?.map(parseFloat),
    }));

    res.json(results);
  } catch (err) {
    console.error('[geocode/search] EXCEPTION:', err);
    res.status(500).json({ error: 'Erro na geocodificação', details: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/geocode/polygon?osm_type=relation&osm_id=123 ───────────────────
router.get('/polygon', async (req: Request, res: Response) => {
  try {
    const { osm_type, osm_id } = req.query;
    if (!osm_id) return res.status(400).json({ error: 'osm_id é obrigatório' });

    const overpassQuery = buildOverpassQuery(String(osm_type || 'relation'), String(osm_id));

    let overpassData: OverpassResult | null = null;

    for (const baseUrl of OVERPASS_URLS) {
      try {
        const overpassResponse = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: `data=${encodeURIComponent(overpassQuery)}`,
        });

        if (!overpassResponse.ok) continue;

        overpassData = await overpassResponse.json() as OverpassResult;
        if (overpassData?.elements?.length > 0) break;
      } catch {
        continue;
      }
    }

    // Sempre fecha os anéis (closeRings) para garantir geometria válida no PostGIS
    const geojson = overpassData ? closeRings(overpassToGeoJSON(overpassData)) : null;

    if (!geojson) {
      const nominatimUrl = `${NOMINATIM_URL}/details?osmtype=${getOsmTypeChar(String(osm_type))}&osmid=${osm_id}&polygon_geojson=1&format=json`;
      const nominatimResp = await fetch(nominatimUrl, { headers: { 'User-Agent': USER_AGENT } });

      if (!nominatimResp.ok) {
        return res.status(502).json({ error: 'Erro ao consultar detalhes da área (todos os serviços falharam)' });
      }

      const nominatimData = await nominatimResp.json() as NominatimDetails;

      if (nominatimData.geometry) {
        return res.json({ geometry: closeRings(nominatimData.geometry), source: 'nominatim' });
      }

      return res.status(404).json({ error: 'Polígono não encontrado para esta área' });
    }

    res.json({ geometry: geojson, source: 'overpass' });
  } catch (err) {
    console.error('[geocode/polygon] EXCEPTION:', err);
    res.status(500).json({ error: 'Erro ao obter polígono', details: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mapNominatimType(type: string, cls: string): string {
  if (cls === 'boundary' || type === 'administrative') return 'municipio';
  if (type === 'neighbourhood' || type === 'suburb') return 'bairro';
  if (type === 'city' || type === 'town') return 'cidade';
  if (type === 'state') return 'estado';
  if (type === 'district') return 'distrito';
  return 'outro';
}

function getOsmTypeChar(osmType: string): string {
  return { relation: 'R', way: 'W', node: 'N' }[osmType] || 'R';
}

function buildOverpassQuery(osmType: string, osmId: string): string {
  const type = osmType === 'relation' ? 'relation' : osmType === 'way' ? 'way' : 'node';
  return `[out:json][timeout:25];${type}(${osmId});out geom;`;
}

function overpassToGeoJSON(data: OverpassResult): GeoJSONGeometry | null {
  if (!data?.elements || data.elements.length === 0) return null;

  const element = data.elements[0];

  if (element.type === 'relation' && element.members) {
    const outerWays = element.members.filter((m: OverpassMember) => m.role === 'outer');
    const coordinates = outerWays
      .filter((w: OverpassMember) => w.geometry && w.geometry.length > 0)
      .map((w: OverpassMember) => [w.geometry!.map((pt: { lat: number; lon: number }) => [pt.lon, pt.lat])]);

    if (coordinates.length === 0) return null;

    return {
      type: 'MultiPolygon',
      coordinates: coordinates.map((c: number[][][]) => [c[0]]),
    };
  }

  if (element.type === 'way' && element.geometry && element.geometry.length > 0) {
    return {
      type: 'Polygon',
      coordinates: [element.geometry.map((pt: { lat: number; lon: number }) => [pt.lon, pt.lat])],
    };
  }

  return null;
}

/**
 * Garante que cada anel (ring) de um Polygon/MultiPolygon esteja "fechado",
 * ou seja, o primeiro ponto deve ser idêntico ao último.
 * O PostGIS/GEOS rejeita anéis abertos com o erro:
 * "Points of LinearRing do not form a closed linestring"
 */
function closeRing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, [first[0], first[1]]];
  }
  return ring;
}

function closeRings(geom: GeoJSONGeometry | null): GeoJSONGeometry | null {
  if (!geom) return null;

  if (geom.type === 'Polygon') {
    const coords = geom.coordinates as number[][][];
    return { type: 'Polygon', coordinates: coords.map(closeRing) };
  }

  if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates as number[][][][];
    return {
      type: 'MultiPolygon',
      coordinates: coords.map(polygon => polygon.map(closeRing)),
    };
  }

  return geom;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface NominatimResult {
  osm_id: number;
  osm_type: string;
  display_name: string;
  name: string;
  type: string;
  class: string;
  lat: string;
  lon: string;
  boundingbox: string[];
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    state?: string;
  };
}

interface NominatimDetails {
  geometry?: GeoJSONGeometry;
}

interface OverpassResult {
  elements: OverpassElement[];
}

interface OverpassElement {
  type: string;
  id: number;
  members?: OverpassMember[];
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassMember {
  role: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface GeoJSONGeometry {
  type: string;
  coordinates: unknown[];
}

export default router;
