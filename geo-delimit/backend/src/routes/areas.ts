import { Router, Request, Response } from 'express';
import { db } from '../index';

const router = Router();

// ─── GET /api/areas ───────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { estado, municipio, tipo, search, limit = 50, offset = 0 } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (estado) { params.push(estado); conditions.push(`estado ILIKE $${params.length}`); }
    if (municipio) { params.push(municipio); conditions.push(`municipio ILIKE $${params.length}`); }
    if (tipo) { params.push(tipo); conditions.push(`tipo = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`nome ILIKE $${params.length}`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const result = await db.query(
      `SELECT id, nome, tipo, municipio, estado, regiao, area_km2, perimetro_km,
              cor_contorno, espessura, opacidade, brilho_ativo, animacao_ativa,
              ST_AsGeoJSON(centroide)::json AS centroide,
              data_criacao, data_atualizacao
       FROM areas ${where}
       ORDER BY data_criacao DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM areas ${where}`,
      params.slice(0, -2)
    );

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar áreas', details: String(err) });
  }
});

// ─── GET /api/areas/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id, nome, tipo, municipio, estado, regiao, pais,
              descricao, observacoes, populacao,
              area_km2, perimetro_km,
              cor_contorno, espessura, opacidade, brilho_ativo, animacao_ativa,
              ST_AsGeoJSON(geometry)::json AS geometry,
              ST_AsGeoJSON(centroide)::json AS centroide,
              ST_AsGeoJSON(bbox)::json AS bbox,
              osm_id, fonte_dados,
              data_criacao, data_atualizacao, criado_por
       FROM areas WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Área não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar área', details: String(err) });
  }
});

// ─── POST /api/areas ──────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      nome, tipo = 'bairro', municipio, estado, regiao, pais = 'Brasil',
      descricao, observacoes, populacao,
      cor_contorno = '#00FFFF', espessura = 3, opacidade = 0.3,
      brilho_ativo = true, animacao_ativa = false,
      geometry, osm_id, fonte_dados = 'openstreetmap',
    } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!geometry) return res.status(400).json({ error: 'Geometria é obrigatória' });

    // Validar e converter geometria para MultiPolygon se necessário
    const geomStr = JSON.stringify(geometry);

    const result = await db.query(
      `INSERT INTO areas (
        nome, tipo, municipio, estado, regiao, pais,
        descricao, observacoes, populacao,
        cor_contorno, espessura, opacidade, brilho_ativo, animacao_ativa,
        geometry, osm_id, fonte_dados
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        CASE
          WHEN ST_GeometryType(ST_GeomFromGeoJSON($15)) = 'ST_Polygon'
          THEN ST_Multi(ST_GeomFromGeoJSON($15))
          ELSE ST_GeomFromGeoJSON($15)
        END,
        $16, $17
      )
      RETURNING id, nome, area_km2, perimetro_km, data_criacao`,
      [nome, tipo, municipio, estado, regiao, pais,
       descricao, observacoes, populacao,
       cor_contorno, espessura, opacidade, brilho_ativo, animacao_ativa,
       geomStr, osm_id, fonte_dados]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar área', details: String(err) });
  }
});

// ─── PUT /api/areas/:id ───────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const allowed = [
      'nome', 'tipo', 'municipio', 'estado', 'regiao', 'descricao',
      'observacoes', 'populacao', 'cor_contorno', 'espessura', 'opacidade',
      'brilho_ativo', 'animacao_ativa'
    ];

    const updates = Object.entries(req.body)
      .filter(([k]) => allowed.includes(k))
      .map(([k], i) => `${k} = $${i + 2}`);

    if (updates.length === 0) return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

    const values = Object.entries(req.body)
      .filter(([k]) => allowed.includes(k))
      .map(([, v]) => v);

    const result = await db.query(
      `UPDATE areas SET ${updates.join(', ')}, data_atualizacao = NOW()
       WHERE id = $1 RETURNING id, nome, data_atualizacao`,
      [req.params.id, ...values]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Área não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar área', details: String(err) });
  }
});

// ─── DELETE /api/areas/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'DELETE FROM areas WHERE id = $1 RETURNING id, nome',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Área não encontrada' });
    res.json({ message: 'Área removida com sucesso', ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover área', details: String(err) });
  }
});

// ─── GET /api/areas/nearby?lat=&lng=&radius= ─────────────────────────────────
router.get('/search/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius = 5000 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat e lng são obrigatórios' });

    const result = await db.query(
      `SELECT id, nome, tipo, municipio, estado, area_km2,
              ST_Distance(centroide::geography, ST_MakePoint($2, $1)::geography) AS distancia_m
       FROM areas
       WHERE ST_DWithin(centroide::geography, ST_MakePoint($2, $1)::geography, $3)
       ORDER BY distancia_m LIMIT 20`,
      [lat, lng, radius]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro na busca por proximidade', details: String(err) });
  }
});

export default router;
