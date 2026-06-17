# ⬡ GeoDelimit — Delimitação Territorial Interativa

Aplicação web full stack para pesquisar e visualizar delimitações territoriais com **efeito neon/glow** animado, armazenamento em PostGIS e exportação em múltiplos formatos.

![Stack](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![Stack](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs) ![Stack](https://img.shields.io/badge/PostgreSQL-16+PostGIS-336791?logo=postgresql) ![Stack](https://img.shields.io/badge/Mapbox_GL_JS-3-000000?logo=mapbox)

---

## 🗂 Estrutura do Projeto

```
geo-delimit/
├── frontend/          → React + TypeScript + Mapbox GL JS
├── backend/           → Node.js + Express + PostGIS
├── db/
│   └── init.sql       → Schema completo (tabelas, triggers, índices)
└── docker-compose.yml → PostgreSQL/PostGIS + Backend + Frontend
```

---

## ⚡ Início Rápido (Docker)

### Pré-requisitos
- Docker + Docker Compose
- Conta Mapbox (token gratuito em https://account.mapbox.com)

```bash
# 1. Clone o projeto
git clone <repo-url> geo-delimit
cd geo-delimit

# 2. Configure o token Mapbox
echo "MAPBOX_TOKEN=pk.eyJ1IjoiXXXXXX..." > .env

# 3. Suba tudo com Docker
docker compose up -d

# 4. Acesse
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001/api/health
```

---

## 🛠 Desenvolvimento Local (sem Docker)

### 1. Banco de Dados

```bash
# Suba só o PostgreSQL+PostGIS via Docker
docker compose up db -d

# Ou instale localmente:
# brew install postgresql postgis  (macOS)
# sudo apt install postgresql postgis  (Ubuntu)

# Crie o banco e rode o schema
psql -U postgres -c "CREATE DATABASE geodelimit;"
psql -U postgres -d geodelimit -f db/init.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # edite as variáveis
npm install
npm run dev               # porta 3001
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # adicione seu REACT_APP_MAPBOX_TOKEN
npm install
npm start                 # porta 3000
```

---

## 🔑 Configuração do Mapbox

1. Acesse https://account.mapbox.com/access-tokens/
2. Crie um token com escopo `styles:read` e `tiles:read`
3. Adicione ao `.env` do frontend:

```env
REACT_APP_MAPBOX_TOKEN=pk.eyJ1IjoiXXXXXX...
```

> **Sem token Mapbox?** O app usa automaticamente tiles gratuitos do OpenStreetMap como fallback (sem tema dark, mas funcional).

---

## 🗺 Funcionalidades

| Feature | Status |
|---------|--------|
| Busca com autocomplete (Nominatim/OSM) | ✅ |
| Delimitação territorial via Overpass API | ✅ |
| Efeito neon/glow multicamada | ✅ |
| Animação de pulsação | ✅ |
| Painel de personalização (cor, espessura, opacidade) | ✅ |
| CRUD de áreas + armazenamento PostGIS | ✅ |
| Cálculo automático de área (km²) e perímetro | ✅ |
| Exportação GeoJSON, KML, CSV | ✅ |
| Histórico de alterações | ✅ |
| Busca por proximidade (PostGIS ST_DWithin) | ✅ |

---

## 📡 API REST

```
GET    /api/health
GET    /api/geocode/search?q=Copacabana
GET    /api/geocode/polygon?osm_type=relation&osm_id=12345
GET    /api/areas?estado=RJ&municipio=Rio+de+Janeiro
POST   /api/areas
GET    /api/areas/:id
PUT    /api/areas/:id
DELETE /api/areas/:id
GET    /api/areas/search/nearby?lat=-22.97&lng=-43.18&radius=5000
GET    /api/export/:id?fmt=geojson|kml|csv
```

---

## 🎨 Cores Neon Disponíveis

| Nome | Hex | Uso Sugerido |
|------|-----|--------------|
| Ciano | `#00FFFF` | Padrão |
| Verde | `#00FF41` | Zonas naturais |
| Rosa | `#FF0090` | Destaques |
| Amarelo | `#FFFF00` | Alertas |
| Roxo | `#BF00FF` | Áreas especiais |
| Laranja | `#FF6600` | Zonas comerciais |

---

## 🗄 Banco de Dados

```sql
-- Tabelas
areas           → delimitações com geometria MultiPolygon (PostGIS)
area_history    → auditoria automática via trigger

-- Views
v_areas_resumo  → resumo sem geometria completa (performance)

-- Triggers automáticos
trg_metricas_area   → calcula área_km2 e perimetro_km no INSERT/UPDATE
trg_historico_area  → registra todas as alterações em area_history

-- Índices espaciais
GIST em geometry, centroide, bbox
GIN  em nome (busca por similaridade)
```

---

## 📦 Exportação

```bash
# GeoJSON
curl http://localhost:3001/api/export/<id>?fmt=geojson -o area.geojson

# KML (Google Earth)
curl http://localhost:3001/api/export/<id>?fmt=kml -o area.kml

# CSV
curl http://localhost:3001/api/export/<id>?fmt=csv -o area.csv
```

---

## 🔧 Variáveis de Ambiente

### Frontend (`frontend/.env`)
```env
REACT_APP_MAPBOX_TOKEN=pk.eyJ1...    # Token Mapbox (obrigatório para mapa dark)
REACT_APP_API_URL=http://localhost:3001/api
```

### Backend (`backend/.env`)
```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=geodelimit
DB_USER=geodelimit
DB_PASSWORD=secret
```

---

## 🚀 Deploy em Produção

```bash
# Build do frontend
cd frontend && npm run build

# Build do backend
cd backend && npm run build

# Ou via Docker
docker compose -f docker-compose.yml up -d --build
```

### Serviços recomendados
- **Frontend:** Vercel, Netlify, Cloudflare Pages
- **Backend:** Railway, Render, Fly.io
- **Banco:** Supabase (PostgreSQL + PostGIS grátis), Neon, AWS RDS

---

## 🤝 Contribuindo

```bash
git checkout -b feature/minha-feature
git commit -m 'feat: adiciona nova funcionalidade'
git push origin feature/minha-feature
```

---

## 📄 Licença

MIT © GeoDelimit
