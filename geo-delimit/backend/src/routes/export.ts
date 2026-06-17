import { Router, Request, Response } from 'express';
import { db } from '../index';

const router = Router();

// ─── GET /api/export/:id?fmt=geojson|kml|csv ─────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { fmt = 'geojson' } = req.query;

    const result = await db.query(
      `SELECT *, ST_AsGeoJSON(geometry)::json AS geom
       FROM areas WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Área não encontrada' });
    const area = result.rows[0];

    switch (String(fmt)) {
      case 'geojson': return exportGeoJSON(res, area);
      case 'kml':     return exportKML(res, area);
      case 'csv':     return exportCSV(res, area);
      default:
        return res.status(400).json({ error: `Formato '${fmt}' não suportado. Use: geojson, kml, csv` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro na exportação', details: String(err) });
  }
});

// ─── Export Functions ─────────────────────────────────────────────────────────
function exportGeoJSON(res: Response, area: AreaRow) {
  const featureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        id: area.id,
        nome: area.nome,
        tipo: area.tipo,
        municipio: area.municipio,
        estado: area.estado,
        regiao: area.regiao,
        area_km2: area.area_km2,
        perimetro_km: area.perimetro_km,
        populacao: area.populacao,
        descricao: area.descricao,
        cor_contorno: area.cor_contorno,
        data_criacao: area.data_criacao,
      },
      geometry: area.geom,
    }],
  };

  res.setHeader('Content-Type', 'application/geo+json');
  res.setHeader('Content-Disposition', `attachment; filename="${slugify(area.nome)}.geojson"`);
  res.json(featureCollection);
}

function exportKML(res: Response, area: AreaRow) {
  const color = hexToKmlColor(area.cor_contorno || '#00FFFF');
  const coords = geojsonCoordsToKML(area.geom);

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(area.nome)}</name>
    <description>${escapeXml(area.descricao || '')}</description>
    <Style id="neonStyle">
      <LineStyle>
        <color>${color}</color>
        <width>${area.espessura || 3}</width>
      </LineStyle>
      <PolyStyle>
        <color>40${color.substring(2)}</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(area.nome)}</name>
      <ExtendedData>
        <Data name="municipio"><value>${escapeXml(area.municipio || '')}</value></Data>
        <Data name="estado"><value>${escapeXml(area.estado || '')}</value></Data>
        <Data name="area_km2"><value>${area.area_km2 || ''}</value></Data>
        <Data name="perimetro_km"><value>${area.perimetro_km || ''}</value></Data>
        <Data name="populacao"><value>${area.populacao || ''}</value></Data>
      </ExtendedData>
      <styleUrl>#neonStyle</styleUrl>
      <MultiGeometry>
        ${coords}
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>`;

  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${slugify(area.nome)}.kml"`);
  res.send(kml);
}

function exportCSV(res: Response, area: AreaRow) {
  const headers = ['id', 'nome', 'tipo', 'municipio', 'estado', 'regiao', 'area_km2', 'perimetro_km', 'populacao', 'descricao', 'data_criacao'];
  const row = headers.map(h => `"${String(area[h] ?? '').replace(/"/g, '""')}"`);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slugify(area.nome)}.csv"`);
  res.send('\uFEFF' + headers.join(';') + '\n' + row.join(';')); // BOM para Excel
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function hexToKmlColor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return `ff${b}${g}${r}`; // KML usa AABBGGRR
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugify(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
}

function geojsonCoordsToKML(geom: GeoJSONGeometry): string {
  if (!geom) return '';

  const polygonToKML = (ring: number[][]): string =>
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>\n${
      ring.map(([lng, lat]) => `${lng},${lat},0`).join('\n')
    }\n</coordinates></LinearRing></outerBoundaryIs></Polygon>`;

  if (geom.type === 'Polygon') {
    return polygonToKML(geom.coordinates[0] as number[][]);
  }

  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][])
      .map(poly => polygonToKML(poly[0]))
      .join('\n');
  }

  return '';
}

interface AreaRow {
  [key: string]: unknown;
  id: string;
  nome: string;
  tipo: string;
  municipio: string;
  estado: string;
  regiao: string;
  descricao: string;
  populacao: number;
  area_km2: number;
  perimetro_km: number;
  cor_contorno: string;
  espessura: number;
  opacidade: number;
  data_criacao: string;
  geom: GeoJSONGeometry;
}

interface GeoJSONGeometry {
  type: string;
  coordinates: unknown[];
}

export default router;
