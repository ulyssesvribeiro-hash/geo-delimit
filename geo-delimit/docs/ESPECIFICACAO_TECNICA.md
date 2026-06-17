# GeoDelimit — Especificação Técnica Completa
**Delimitação Territorial Interativa com Efeito Neon**
**Versão:** 1.0.0 | **Data:** 2025 | **Arquiteto:** Sistema Geoespacial Full Stack

---

## 1. VISÃO GERAL DO SISTEMA

### 1.1 Objetivo
Aplicação web que permite pesquisar qualquer área territorial (bairro, cidade, estado) e visualizá-la no mapa com contorno luminoso (neon/glow), com gestão completa dos dados geográficos.

### 1.2 Público-Alvo
- Gestores públicos municipais
- Urbanistas e arquitetos
- Pesquisadores de geoprocessamento
- Profissionais de mercado imobiliário

### 1.3 Escopo do MVP
- Busca geográfica com autocomplete
- Visualização de polígonos com efeito neon
- Painel de personalização visual
- CRUD de áreas territoriais
- Exportação de dados

---

## 2. ARQUITETURA DO SISTEMA

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTE (Browser)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  React/Next  │  │  Mapbox GL   │  │    Painel Lateral    │  │
│  │  TypeScript  │  │  + Turf.js   │  │    (Personalização)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼─────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API GATEWAY (Next.js API Routes)            │
│              Rate Limiting | Auth | CORS | Logging              │
└────────────┬──────────────────────────┬────────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────┐      ┌───────────────────────┐
│   Backend Node.js  │      │    APIs Externas       │
│   Express + PostGIS│      │  ┌─────────────────┐  │
│                    │      │  │ Nominatim (OSM) │  │
│  /api/areas        │      │  │ Overpass API    │  │
│  /api/geocode      │      │  │ MapboxGeocoding │  │
│  /api/export       │      │  └─────────────────┘  │
└────────┬───────────┘      └───────────────────────┘
         │
         ▼
┌────────────────────┐
│  PostgreSQL        │
│  + PostGIS         │
│                    │
│  [areas]           │
│  [area_history]    │
└────────────────────┘
```

---

## 3. FLUXOGRAMA PRINCIPAL

```
USUÁRIO DIGITA BUSCA
        │
        ▼
┌───────────────────┐
│ Autocomplete API  │◄── Nominatim / Mapbox Geocoding
│ (debounce 300ms)  │
└───────┬───────────┘
        │
        ▼
USUÁRIO SELECIONA RESULTADO
        │
        ▼
┌───────────────────┐
│ Busca Polígono    │◄── Overpass API / OpenStreetMap
│ da Área           │    (admin_level boundaries)
└───────┬───────────┘
        │
   ┌────┴────┐
   │Encontrou│
   └────┬────┘
     Sim│         Não──► Exibe: "Área não encontrada"
        │
        ▼
┌───────────────────┐
│ Renderiza         │
│ Polígono no Mapa  │
│ (Mapbox Layer)    │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ Aplica Efeito     │
│ Neon/Glow         │
│ (CSS + WebGL)     │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│ Calcula:          │
│ - Área (km²)      │
│ - Perímetro (km)  │
│ - Bbox/Centroid   │
└───────┬───────────┘
        │
        ▼
USUÁRIO PERSONALIZA / SALVA
        │
        ▼
┌───────────────────┐
│ Persiste no       │
│ PostgreSQL+PostGIS│
└───────────────────┘
```

---

## 4. MODELO DE BANCO DE DADOS

### 4.1 Diagrama ER

```
┌─────────────────────────────────────────────────────┐
│                      areas                          │
├──────────────────┬──────────────────────────────────┤
│ id               │ UUID PRIMARY KEY                 │
│ nome             │ VARCHAR(255) NOT NULL             │
│ tipo             │ ENUM (cidade,bairro,distrito...)  │
│ municipio        │ VARCHAR(255)                      │
│ estado           │ VARCHAR(100)                      │
│ regiao           │ VARCHAR(100)                      │
│ pais             │ VARCHAR(100) DEFAULT 'Brasil'     │
│ descricao        │ TEXT                              │
│ observacoes      │ TEXT                              │
│ populacao        │ BIGINT                            │
│ area_km2         │ NUMERIC(12,4) (calculado)         │
│ perimetro_km     │ NUMERIC(12,4) (calculado)         │
│ cor_contorno     │ VARCHAR(7) DEFAULT '#00FFFF'      │
│ espessura        │ SMALLINT DEFAULT 3                │
│ opacidade        │ NUMERIC(3,2) DEFAULT 0.3          │
│ brilho_ativo     │ BOOLEAN DEFAULT true              │
│ animacao_ativa   │ BOOLEAN DEFAULT false             │
│ geometry         │ GEOMETRY(MULTIPOLYGON, 4326)      │
│ bbox             │ GEOMETRY(POLYGON, 4326)           │
│ centroide        │ GEOMETRY(POINT, 4326)             │
│ osm_id           │ BIGINT (referência OSM)           │
│ fonte_dados      │ VARCHAR(100)                      │
│ data_criacao     │ TIMESTAMPTZ DEFAULT NOW()         │
│ data_atualizacao │ TIMESTAMPTZ                       │
│ criado_por       │ VARCHAR(255)                      │
└──────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   area_history                      │
├──────────────────┬──────────────────────────────────┤
│ id               │ UUID PRIMARY KEY                 │
│ area_id          │ UUID FK → areas.id               │
│ operacao         │ ENUM (CREATE, UPDATE, DELETE)     │
│ dados_anteriores │ JSONB                             │
│ dados_novos      │ JSONB                             │
│ usuario          │ VARCHAR(255)                      │
│ timestamp        │ TIMESTAMPTZ DEFAULT NOW()         │
└──────────────────┴──────────────────────────────────┘
```

### 4.2 Script SQL de Criação

```sql
-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- para busca por similaridade

-- Enum para tipos de área
CREATE TYPE tipo_area AS ENUM (
  'cidade', 'bairro', 'distrito', 'municipio',
  'estado', 'regiao', 'pais', 'outro'
);

-- Tabela principal
CREATE TABLE areas (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome              VARCHAR(255) NOT NULL,
  tipo              tipo_area NOT NULL DEFAULT 'bairro',
  municipio         VARCHAR(255),
  estado            VARCHAR(100),
  regiao            VARCHAR(100),
  pais              VARCHAR(100) DEFAULT 'Brasil',
  descricao         TEXT,
  observacoes       TEXT,
  populacao         BIGINT,
  area_km2          NUMERIC(12,4),
  perimetro_km      NUMERIC(12,4),
  cor_contorno      VARCHAR(7) DEFAULT '#00FFFF',
  espessura         SMALLINT DEFAULT 3 CHECK (espessura BETWEEN 1 AND 20),
  opacidade         NUMERIC(3,2) DEFAULT 0.3 CHECK (opacidade BETWEEN 0 AND 1),
  brilho_ativo      BOOLEAN DEFAULT true,
  animacao_ativa    BOOLEAN DEFAULT false,
  geometry          GEOMETRY(MULTIPOLYGON, 4326),
  bbox              GEOMETRY(POLYGON, 4326) GENERATED ALWAYS AS (ST_Envelope(geometry)) STORED,
  centroide         GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_Centroid(geometry)) STORED,
  osm_id            BIGINT,
  fonte_dados       VARCHAR(100) DEFAULT 'openstreetmap',
  data_criacao      TIMESTAMPTZ DEFAULT NOW(),
  data_atualizacao  TIMESTAMPTZ DEFAULT NOW(),
  criado_por        VARCHAR(255)
);

-- Calcular área e perímetro automaticamente
CREATE OR REPLACE FUNCTION calcular_metricas_area()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.geometry IS NOT NULL THEN
    NEW.area_km2 := ST_Area(NEW.geometry::geography) / 1000000;
    NEW.perimetro_km := ST_Perimeter(NEW.geometry::geography) / 1000;
    NEW.data_atualizacao := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_metricas_area
  BEFORE INSERT OR UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION calcular_metricas_area();

-- Índices
CREATE INDEX idx_areas_geometry ON areas USING GIST (geometry);
CREATE INDEX idx_areas_nome ON areas USING GIN (nome gin_trgm_ops);
CREATE INDEX idx_areas_municipio ON areas (municipio);
CREATE INDEX idx_areas_estado ON areas (estado);
CREATE INDEX idx_areas_tipo ON areas (tipo);

-- Tabela de histórico
CREATE TABLE area_history (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id          UUID REFERENCES areas(id) ON DELETE CASCADE,
  operacao         VARCHAR(10) NOT NULL CHECK (operacao IN ('CREATE','UPDATE','DELETE')),
  dados_anteriores JSONB,
  dados_novos      JSONB,
  usuario          VARCHAR(255),
  timestamp        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_history_area_id ON area_history (area_id);
CREATE INDEX idx_history_timestamp ON area_history (timestamp DESC);
```

---

## 5. ESTRUTURA DE PASTAS

```
geo-delimit/
├── frontend/                          # Next.js App
│   ├── public/
│   │   └── icons/
│   ├── src/
│   │   ├── app/                       # App Router (Next.js 14)
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Mapa principal
│   │   │   └── api/                   # API Routes
│   │   │       ├── geocode/route.ts
│   │   │       ├── areas/route.ts
│   │   │       └── export/route.ts
│   │   ├── components/
│   │   │   ├── Map/
│   │   │   │   ├── MapContainer.tsx   # Mapbox GL wrapper
│   │   │   │   ├── NeonLayer.tsx      # Efeito glow
│   │   │   │   ├── PolygonLayer.tsx   # Preenchimento
│   │   │   │   └── MapControls.tsx    # Zoom, medição
│   │   │   ├── Search/
│   │   │   │   ├── SearchBar.tsx
│   │   │   │   └── SearchResults.tsx
│   │   │   ├── Sidebar/
│   │   │   │   ├── SidebarPanel.tsx
│   │   │   │   ├── StylePanel.tsx     # Cor, espessura, brilho
│   │   │   │   ├── DataPanel.tsx      # Form de metadados
│   │   │   │   └── ExportPanel.tsx
│   │   │   └── UI/
│   │   │       ├── ColorPicker.tsx
│   │   │       ├── Slider.tsx
│   │   │       └── Toggle.tsx
│   │   ├── hooks/
│   │   │   ├── useGeocoder.ts
│   │   │   ├── usePolygon.ts
│   │   │   ├── useMapStyle.ts
│   │   │   └── useAreas.ts
│   │   ├── services/
│   │   │   ├── geocodeService.ts      # Nominatim + Mapbox
│   │   │   ├── osmService.ts          # Overpass API
│   │   │   ├── areaService.ts         # CRUD backend
│   │   │   └── exportService.ts
│   │   ├── types/
│   │   │   ├── area.ts
│   │   │   └── geojson.ts
│   │   └── styles/
│   │       ├── globals.css
│   │       └── neon.css
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                           # Node.js + Express
│   ├── src/
│   │   ├── index.ts                   # Entry point
│   │   ├── routes/
│   │   │   ├── areas.ts
│   │   │   ├── geocode.ts
│   │   │   └── export.ts
│   │   ├── models/
│   │   │   └── Area.ts
│   │   ├── services/
│   │   │   ├── postgisService.ts
│   │   │   ├── osmService.ts
│   │   │   └── exportService.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── errorHandler.ts
│   │   └── config/
│   │       └── database.ts
│   ├── package.json
│   └── .env.example
│
├── docker-compose.yml                 # PostgreSQL + PostGIS
└── docs/
    └── ESPECIFICACAO_TECNICA.md
```

---

## 6. APIs REST

### 6.1 Endpoints

| Método | Rota                    | Descrição                         |
|--------|-------------------------|-----------------------------------|
| GET    | /api/geocode/search     | Busca + autocomplete de locais    |
| GET    | /api/geocode/polygon    | Obtém polígono de uma área        |
| GET    | /api/areas              | Lista todas as áreas salvas       |
| POST   | /api/areas              | Cria nova área                    |
| GET    | /api/areas/:id          | Obtém área por ID                 |
| PUT    | /api/areas/:id          | Atualiza área                     |
| DELETE | /api/areas/:id          | Remove área                       |
| GET    | /api/areas/:id/export   | Exporta (kml/geojson/shp/png/pdf) |
| GET    | /api/areas/nearby       | Áreas próximas a um ponto         |

### 6.2 Contratos de Dados

**POST /api/areas — Request:**
```json
{
  "nome": "Copacabana",
  "tipo": "bairro",
  "municipio": "Rio de Janeiro",
  "estado": "RJ",
  "regiao": "Zona Sul",
  "descricao": "Bairro famoso da Zona Sul",
  "populacao": 150000,
  "cor_contorno": "#00FFFF",
  "espessura": 3,
  "opacidade": 0.25,
  "brilho_ativo": true,
  "animacao_ativa": false,
  "geometry": {
    "type": "MultiPolygon",
    "coordinates": [[[[...]]]],
    "crs": { "type": "name", "properties": { "name": "EPSG:4326" } }
  },
  "osm_id": 1234567,
  "fonte_dados": "openstreetmap"
}
```

**GET /api/areas/:id — Response:**
```json
{
  "id": "uuid-aqui",
  "nome": "Copacabana",
  "tipo": "bairro",
  "municipio": "Rio de Janeiro",
  "estado": "RJ",
  "area_km2": 4.87,
  "perimetro_km": 12.3,
  "cor_contorno": "#00FFFF",
  "espessura": 3,
  "opacidade": 0.25,
  "brilho_ativo": true,
  "animacao_ativa": false,
  "centroide": { "type": "Point", "coordinates": [-43.1869, -22.9712] },
  "geometry": { "type": "MultiPolygon", "coordinates": [[[[...]]]] },
  "data_criacao": "2025-01-15T10:30:00Z"
}
```

---

## 7. WIREFRAMES DAS TELAS

### 7.1 Tela Principal

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  [🔍 Pesquisar cidade ou bairro...                              ] [⚙] [📤]    │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                  │             │
│                                                                  │  PAINEL     │
│                     MAPA (Tela Cheia)                            │  LATERAL    │
│                     Tema Escuro                                  │  ─────────  │
│                                                                  │  [Estilo]   │
│              ┌─────────────────────────────┐                     │  Cor: 🎨    │
│              │   Copacabana               │                     │  Esp: ──●── │
│              │  ╔═══════════════════════╗  │                     │  Opa: ──●── │
│              │  ║  ░░░░░░░░░░░░░░░░░░  ║  │                     │  Brilho [✓] │
│              │  ║  ░░(NEON GLOW)░░░░  ║  │                     │  Anim  [ ]  │
│              │  ║  ░░░░░░░░░░░░░░░░░░  ║  │                     │  ─────────  │
│              │  ╚═══════════════════════╝  │                     │  [Dados]    │
│              └─────────────────────────────┘                     │  Nome:      │
│                                                                  │  [_______]  │
│  [+]                                                             │  Municip:   │
│  [-]                                                             │  [_______]  │
│  [📐]  Área: 4.87 km²  |  Perímetro: 12.3 km                   │  [💾 Salvar]│
└────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Autocomplete de Busca

```
┌─────────────────────────────────────────────────────┐
│  🔍 Rio de Janeiro                                   │
├─────────────────────────────────────────────────────┤
│  📍 Rio de Janeiro — Cidade — RJ, Brasil            │
│  📍 Rio de Janeiro — Estado — Brasil                │
│  🏘  Bairro Rio de Janeiro — São Paulo, SP          │
└─────────────────────────────────────────────────────┘
```

---

## 8. TECNOLOGIAS E DEPENDÊNCIAS

### 8.1 Frontend
```json
{
  "next": "^14.0.0",
  "react": "^18.0.0",
  "typescript": "^5.0.0",
  "mapbox-gl": "^3.0.0",
  "@turf/turf": "^6.5.0",
  "zustand": "^4.4.0",
  "react-color": "^2.19.0",
  "axios": "^1.6.0",
  "tailwindcss": "^3.3.0"
}
```

### 8.2 Backend
```json
{
  "express": "^4.18.0",
  "pg": "^8.11.0",
  "postgis": "via pg",
  "gdal-async": "^3.8.0",
  "@turf/turf": "^6.5.0",
  "node-fetch": "^3.0.0",
  "helmet": "^7.1.0",
  "express-rate-limit": "^7.1.0",
  "pdfkit": "^0.14.0",
  "archiver": "^6.0.0"
}
```

### 8.3 Infraestrutura
```yaml
# docker-compose.yml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: geodelimit
      POSTGRES_USER: geodelimit
      POSTGRES_PASSWORD: secret
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  backend:
    build: ./backend
    ports: ["3001:3001"]
    depends_on: [db]

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend]
```

---

## 9. EFEITO NEON — IMPLEMENTAÇÃO TÉCNICA

### 9.1 Camadas Mapbox GL JS (múltiplas para efeito glow)

```
Camada 1: fill-layer      → preenchimento transparente
Camada 2: line-layer      → borda principal (cor sólida)
Camada 3: line-layer      → glow externo (blur + opacidade)
Camada 4: line-layer      → glow externo maior (mais blur)
Camada 5: line-layer      → halo interno (branco, thin)
```

### 9.2 Paleta de Cores Neon

| Nome           | Hex       | Uso sugerido         |
|----------------|-----------|----------------------|
| Ciano Neon     | `#00FFFF` | Padrão               |
| Verde Neon     | `#00FF41` | Zonas naturais       |
| Rosa Neon      | `#FF0090` | Destaques            |
| Amarelo Neon   | `#FFFF00` | Alertas              |
| Roxo Neon      | `#BF00FF` | Áreas especiais      |
| Laranja Neon   | `#FF6600` | Zonas comerciais     |

### 9.3 Animação de Pulsação (CSS + Mapbox expressions)

```javascript
// Expressão Mapbox para pulsação via interpolação temporal
['interpolate', ['linear'], ['%', ['+', ['/', ['time'], 1000], 0], 2],
  0, corBase,
  1, corBrilho,
  2, corBase
]
```

---

## 10. FLUXO DE OBTENÇÃO DE POLÍGONOS

```
OVERPASS API (OSM) — Consulta de Limites Administrativos

Query:
[out:json];
(
  relation["name"="Copacabana"]["boundary"="administrative"];
  way["name"="Copacabana"]["boundary"="administrative"];
);
out geom;

→ Retorna coordenadas do polígono
→ Converte para GeoJSON
→ Passa por Turf.js (simplificação + cálculos)
→ Renderiza no Mapbox
```

---

## 11. EXPORTAÇÃO DE DADOS

| Formato   | Biblioteca        | Endpoint                    |
|-----------|-------------------|-----------------------------|
| GeoJSON   | Nativo JS         | /api/areas/:id/export?fmt=geojson |
| KML       | tokml / custom    | /api/areas/:id/export?fmt=kml     |
| Shapefile | shapefile-js      | /api/areas/:id/export?fmt=shp     |
| PNG       | Mapbox Static API | /api/areas/:id/export?fmt=png     |
| PDF       | pdfkit + png      | /api/areas/:id/export?fmt=pdf     |

---

## 12. CONSIDERAÇÕES DE SEGURANÇA

- Rate limiting em todos os endpoints
- Validação de geometria (anti SQL injection via geometry)
- Sanitização dos inputs de texto
- CORS configurado para domínios autorizados
- Variáveis sensíveis via .env (nunca commitar)
- Chaves Mapbox com restrição de domínio

---

## 13. CHECKLIST DE DESENVOLVIMENTO

### Fase 1 — Base (2 semanas)
- [x] Estrutura do projeto
- [ ] Docker + PostgreSQL + PostGIS
- [ ] Mapa base (Mapbox GL JS)
- [ ] Campo de busca com autocomplete
- [ ] Integração Nominatim/Overpass

### Fase 2 — Visual (1 semana)
- [ ] Renderização do polígono
- [ ] Efeito neon/glow (múltiplas camadas)
- [ ] Painel lateral de estilo
- [ ] Animação de pulsação

### Fase 3 — Dados (1 semana)
- [ ] CRUD completo (Frontend + Backend)
- [ ] Persistência PostGIS
- [ ] Histórico de alterações

### Fase 4 — Extras (1 semana)
- [ ] Exportação (GeoJSON, KML, PNG, PDF)
- [ ] Medição de área/perímetro
- [ ] Responsividade

---

*Documento gerado automaticamente — GeoDelimit v1.0.0*
