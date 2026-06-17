import { Router, Request, Response } from 'express';

const router = Router();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'GeoDelimit/1.0 (geodelimit@example.com)';

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
    url.searchParams.set('countrycodes', 'br'); // Foco no Brasil
    url.searchParams.set('featuretype', 'settlement,boundary');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT }
    });

    const data = await response.json() as NominatimResult[];

    const results = data.map(item => ({
      osm_id: item.osm_id,
      osm_type: item.osm_type, // 'relation' | 'way' | 'node'
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
    res.status(500).json({ error: 'Erro na geocodificação', details: String(err) });
  }
});

// ─── GET /api/geocode/polygon?osm_type=relation&osm_id=123 ───────────────────
router.get('/polygon', async (req: Request, res: Response) => {
  try {
    const { osm_type, osm_id } = req.query;
    if (!osm_id) return res.status(400).json({ error: 'osm_id é obrigatório' });

    // Estratégia 1: Overpass API para polígonos de admin_boundary
    const overpassQuery = buildOverpassQuery(String(osm_type || 'relation'), String(osm_id));

    const overpassResponse = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    const overpassData = await overpassResponse.json() as OverpassResult;
    const geojson = overpassToGeoJSON(overpassData);

    if (!geojson) {
      // Fallback: Nominatim details endpoint (para polígonos simples)
      const nominatimUrl = `${NOMINATIM_URL}/details?osmtype=${getOsmTypeChar(String(osm_type))}&osmid=${osm_id}&polygon_geojson=1&format=json`;
      const nominatimResp = await fetch(nominatimUrl, { headers: { 'User-Agent': USER_AGENT } });
      const nominatimData = await nominatimResp.json() as NominatimDetails;

      if (nominatimData.geometry) {
        return res.json({ geometry: nominatimData.geometry, source: 'nominatim' });
      }

      return res.status(404).json({ error: 'Polígono não encontrado para esta área' });
    }

    res.json({ geometry: geojson, source: 'overpass' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter polígono', details: String(err) });
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
  return `
    [out:json][timeout:30];
    ${type}(${osmId});
    out geom;
  `;
}

function overpassToGeoJSON(data: OverpassResult): GeoJSONGeometry | null {
  if (!data.elements || data.elements.length === 0) return null;

  const element = data.elements[0];

  if (element.type === 'relation' && element.members) {
    // Construir MultiPolygon de uma relação OSM
    const outerWays = element.members.filter((m: OverpassMember) => m.role === 'outer');
    const coordinates = outerWays
      .filter((w: OverpassMember) => w.geometry)
      .map((w: OverpassMember) => [w.geometry!.map((pt: { lat: number; lon: number }) => [pt.lon, pt.lat])]);

    if (coordinates.length === 0) return null;

    return {
      type: 'MultiPolygon',
      coordinates: coordinates.map((c: number[][][]) => [c[0]]),
    };
  }

  if (element.type === 'way' && element.geometry) {
    return {
      type: 'Polygon',
      coordinates: [element.geometry.map((pt: { lat: number; lon: number }) => [pt.lon, pt.lat])],
    };
  }

  return null;
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
