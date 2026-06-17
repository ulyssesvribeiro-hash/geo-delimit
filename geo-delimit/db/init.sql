-- =============================================================================
-- GeoDelimit — Script de Inicialização do Banco de Dados
-- PostgreSQL 16 + PostGIS 3.4
-- =============================================================================

-- ── Extensões ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Enum: Tipos de Área ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_area AS ENUM (
    'cidade', 'bairro', 'distrito', 'municipio',
    'estado', 'regiao', 'pais', 'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tabela Principal: areas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS areas (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Identificação
  nome              VARCHAR(255) NOT NULL,
  tipo              tipo_area NOT NULL DEFAULT 'bairro',
  municipio         VARCHAR(255),
  estado            VARCHAR(100),
  regiao            VARCHAR(100),
  pais              VARCHAR(100) DEFAULT 'Brasil',

  -- Descrição
  descricao         TEXT,
  observacoes       TEXT,
  populacao         BIGINT,

  -- Métricas (calculadas automaticamente via trigger)
  area_km2          NUMERIC(14, 6),
  perimetro_km      NUMERIC(14, 6),

  -- Estilo visual
  cor_contorno      VARCHAR(7)  NOT NULL DEFAULT '#00FFFF',
  espessura         SMALLINT    NOT NULL DEFAULT 3
                    CHECK (espessura BETWEEN 1 AND 20),
  opacidade         NUMERIC(4,3) NOT NULL DEFAULT 0.200
                    CHECK (opacidade BETWEEN 0 AND 1),
  brilho_ativo      BOOLEAN     NOT NULL DEFAULT TRUE,
  animacao_ativa    BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Geometria PostGIS (WGS84)
  geometry          GEOMETRY(MULTIPOLYGON, 4326),

  -- Colunas geradas automaticamente
  centroide         GEOMETRY(POINT,   4326)
                    GENERATED ALWAYS AS (ST_Centroid(geometry)) STORED,
  bbox              GEOMETRY(POLYGON, 4326)
                    GENERATED ALWAYS AS (ST_Envelope(geometry)) STORED,

  -- Metadados da fonte
  osm_id            BIGINT,
  fonte_dados       VARCHAR(100) DEFAULT 'openstreetmap',

  -- Auditoria
  data_criacao      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_atualizacao  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por        VARCHAR(255)
);

COMMENT ON TABLE  areas IS 'Delimitações territoriais com geometria PostGIS e estilo neon';
COMMENT ON COLUMN areas.geometry    IS 'MultiPolygon WGS84 (EPSG:4326)';
COMMENT ON COLUMN areas.centroide   IS 'Centróide calculado automaticamente';
COMMENT ON COLUMN areas.bbox        IS 'Bounding box calculada automaticamente';

-- ── Trigger: calcular métricas ao inserir/atualizar ───────────────────────────
CREATE OR REPLACE FUNCTION fn_calcular_metricas_area()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geometry IS NOT NULL THEN
    NEW.area_km2     := ROUND(
      (ST_Area(NEW.geometry::geography) / 1e6)::NUMERIC, 6
    );
    NEW.perimetro_km := ROUND(
      (ST_Perimeter(NEW.geometry::geography) / 1e3)::NUMERIC, 6
    );
  END IF;
  NEW.data_atualizacao := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_metricas_area ON areas;
CREATE TRIGGER trg_metricas_area
  BEFORE INSERT OR UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION fn_calcular_metricas_area();

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_areas_geometry  ON areas USING GIST  (geometry);
CREATE INDEX IF NOT EXISTS idx_areas_centroide ON areas USING GIST  (centroide);
CREATE INDEX IF NOT EXISTS idx_areas_bbox      ON areas USING GIST  (bbox);
CREATE INDEX IF NOT EXISTS idx_areas_nome      ON areas USING GIN   (nome gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_areas_municipio ON areas             (municipio);
CREATE INDEX IF NOT EXISTS idx_areas_estado    ON areas             (estado);
CREATE INDEX IF NOT EXISTS idx_areas_tipo      ON areas             (tipo);
CREATE INDEX IF NOT EXISTS idx_areas_criacao   ON areas             (data_criacao DESC);

-- ── Tabela: Histórico de Alterações ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS area_history (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id          UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  operacao         VARCHAR(10) NOT NULL CHECK (operacao IN ('CREATE','UPDATE','DELETE')),
  dados_anteriores JSONB,
  dados_novos      JSONB,
  usuario          VARCHAR(255),
  ip_origem        INET,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_area    ON area_history (area_id);
CREATE INDEX IF NOT EXISTS idx_history_time    ON area_history (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_op      ON area_history (operacao);

-- ── Trigger: histórico automático ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_registrar_historico()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO area_history (area_id, operacao, dados_novos)
    VALUES (NEW.id, 'CREATE', row_to_json(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO area_history (area_id, operacao, dados_anteriores, dados_novos)
    VALUES (NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO area_history (area_id, operacao, dados_anteriores)
    VALUES (OLD.id, 'DELETE', row_to_json(OLD));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_historico_area ON areas;
CREATE TRIGGER trg_historico_area
  AFTER INSERT OR UPDATE OR DELETE ON areas
  FOR EACH ROW EXECUTE FUNCTION fn_registrar_historico();

-- ── View: Resumo de Áreas ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_areas_resumo AS
SELECT
  a.id,
  a.nome,
  a.tipo,
  a.municipio,
  a.estado,
  a.regiao,
  a.area_km2,
  a.perimetro_km,
  a.populacao,
  a.cor_contorno,
  a.espessura,
  a.brilho_ativo,
  a.animacao_ativa,
  ST_AsGeoJSON(a.centroide)::json  AS centroide_geojson,
  ST_AsGeoJSON(a.bbox)::json       AS bbox_geojson,
  a.data_criacao,
  a.data_atualizacao,
  COUNT(h.id) AS total_alteracoes
FROM areas a
LEFT JOIN area_history h ON h.area_id = a.id AND h.operacao = 'UPDATE'
GROUP BY a.id;

COMMENT ON VIEW v_areas_resumo IS 'Resumo de áreas sem geometria completa (performance)';

-- ── Dados de Exemplo ──────────────────────────────────────────────────────────
-- (Descomente para inserir dados de teste)
/*
INSERT INTO areas (nome, tipo, municipio, estado, descricao, cor_contorno, geometry)
VALUES (
  'Copacabana', 'bairro', 'Rio de Janeiro', 'RJ',
  'Bairro famoso da Zona Sul carioca',
  '#00FFFF',
  ST_Multi(ST_GeomFromText(
    'POLYGON((-43.2050 -22.9600, -43.1750 -22.9600,
              -43.1750 -22.9900, -43.2050 -22.9900,
              -43.2050 -22.9600))',
    4326
  ))
);
*/

-- ── Verificação Final ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_postgis_version TEXT;
BEGIN
  SELECT PostGIS_Version() INTO v_postgis_version;
  RAISE NOTICE '✅ GeoDelimit DB inicializado com sucesso!';
  RAISE NOTICE '   PostGIS: %', v_postgis_version;
  RAISE NOTICE '   Tabelas: areas, area_history';
  RAISE NOTICE '   Views:   v_areas_resumo';
END $$;
