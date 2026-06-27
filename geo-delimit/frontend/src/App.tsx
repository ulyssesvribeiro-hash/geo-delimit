import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as turf from '@turf/turf';

// ─── Variáveis de ambiente (Runtime via env.js) ───────────────────────────────
const ENV = (window as any).__ENV__ || {};
const API_BASE = ENV.VITE_API_URL || (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SearchResult {
  osm_id: number;
  osm_type: string;
  display_name: string;
  nome: string;
  tipo: string;
  municipio?: string;
  estado?: string;
  lat: number;
  lng: number;
}

interface AreaStyle {
  cor: string;
  espessura: number;
  opacidade: number;
  brilho: boolean;
  animacao: boolean;
}

interface AreaData {
  nome: string;
  municipio: string;
  estado: string;
  regiao: string;
  populacao: string;
  faccao: string;
  descricao: string;
  observacoes: string;
}

interface AreaMetrics {
  areaKm2: number;
}

interface SavedArea {
  id: string;
  nome: string;
  tipo: string;
  municipio?: string;
  estado?: string;
  regiao?: string;
  faccao?: string;
  area_km2?: number | string;
  perimetro_km?: number | string;
  populacao?: number;
  descricao?: string;
  observacoes?: string;
  cor_contorno: string;
  espessura: number;
  opacidade: number;
  brilho_ativo: boolean;
  animacao_ativa: boolean;
  data_criacao: string;
}

type MapTheme = 'dark' | 'light';
type SortMode = 'recente' | 'faccao' | 'nome' | 'area';

const NEON_COLORS = [
  { name: 'Ciano',   hex: '#00FFFF' },
  { name: 'Verde',   hex: '#00FF41' },
  { name: 'Rosa',    hex: '#FF0090' },
  { name: 'Amarelo', hex: '#FFFF00' },
  { name: 'Roxo',    hex: '#BF00FF' },
  { name: 'Laranja', hex: '#FF6600' },
];

const TIPO_ICONS: Record<string, string> = {
  cidade: '🏙', bairro: '🏘', distrito: '🗺', municipio: '🏛',
  estado: '🗾', regiao: '🌎', pais: '🌍', outro: '📍',
};

const FACCAO_SUGESTOES = ['CV', 'PCC', 'ADA', 'TCP', 'PCV'];

const FACCAO_CORES: Record<string, string> = {
  CV:  '#FF0000',
  PCC: '#0033CC',
  ADA: '#FFD700',
  TCP: '#00CC66',
  PCV: '#FF6600',
};

const TILE_LAYERS: Record<MapTheme, { url: string; attribution: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function faccaoColor(faccao?: string): string | null {
  if (!faccao) return null;
  const key = faccao.trim().toUpperCase();
  return FACCAO_CORES[key] || null;
}

declare global {
  interface Window { L: any; }
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function App() {
  const mapRef        = useRef<any>(null);
  const leafletRef    = useRef<any>(null);
  const layerGroupRef = useRef<any>(null);
  const tileLayerRef  = useRef<any>(null);
  const animFrameRef  = useRef<number | null>(null);
  const mapContainer  = useRef<HTMLDivElement>(null);

  const [query,           setQuery]           = useState('');
  const [suggestions,     setSuggestions]     = useState<SearchResult[]>([]);
  const [loading,         setLoading]         = useState(false);
  const [sidebarOpen,     setSidebarOpen]     = useState(true);
  const [activeTab,       setActiveTab]       = useState<'style' | 'data' | 'list'>('style');
  const [currentGeometry, setCurrentGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [currentAreaId,   setCurrentAreaId]   = useState<string | null>(null);
  const [selectedResult,  setSelectedResult]  = useState<SearchResult | null>(null);
  const [metrics,         setMetrics]         = useState<AreaMetrics | null>(null);
  const [saveMsg,         setSaveMsg]         = useState('');
  const [leafletReady,    setLeafletReady]    = useState(false);
  const [mapTheme,        setMapTheme]        = useState<MapTheme>('dark');

  // ── Painel de resumo territorial (bairros já cadastrados na cidade buscada) ──
  const [territorioPanel,  setTerritorioPanel]  = useState<SavedArea[] | null>(null);
  const [territorioLoading, setTerritorioLoading] = useState(false);
  const [territorioCidade, setTerritorioCidade] = useState('');

  // ── Estado da lista de áreas salvas ──
  const [savedAreas,      setSavedAreas]      = useState<SavedArea[]>([]);
  const [listLoading,     setListLoading]     = useState(false);
  const [listError,       setListError]       = useState('');
  const [listSearch,      setListSearch]      = useState('');
  const [sortMode,        setSortMode]        = useState<SortMode>('faccao');
  const [faccaoFilter,    setFaccaoFilter]    = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [style, setStyle] = useState<AreaStyle>({
    cor: '#00FFFF', espessura: 3, opacidade: 0.2, brilho: true, animacao: false,
  });

  const [areaData, setAreaData] = useState<AreaData>({
    nome: '', municipio: '', estado: '', regiao: '', populacao: '', faccao: '', descricao: '', observacoes: '',
  });

  // ─── Carrega Leaflet dinamicamente ───────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id  = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setLeafletReady(true);
      document.head.appendChild(script);
    } else if (window.L) {
      setLeafletReady(true);
    }
  }, []);

  // ─── Inicializa mapa Leaflet ──────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapContainer.current || mapRef.current) return;
    const L = window.L;

    const map = L.map(mapContainer.current, {
      center: [-15.7, -47.9],
      zoom: 4,
      zoomControl: false,
    });

    const initialTile = TILE_LAYERS[mapTheme];
    tileLayerRef.current = L.tileLayer(initialTile.url, {
      attribution: initialTile.attribution,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    leafletRef.current = L;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady]);

  // ─── Troca o tile layer quando o tema muda ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);

    const tile = TILE_LAYERS[mapTheme];
    tileLayerRef.current = L.tileLayer(tile.url, {
      attribution: tile.attribution,
      subdomains: 'abcd',
      maxZoom: 19,
    });
    tileLayerRef.current.addTo(map);
    tileLayerRef.current.bringToBack();
  }, [mapTheme]);

  // ─── Desenha polígono com efeito neon ────────────────────────────────────
  const drawPolygon = useCallback((geometry: GeoJSON.Geometry, s: AreaStyle) => {
    const L = leafletRef.current;
    const lg = layerGroupRef.current;
    if (!L || !lg) return;

    lg.clearLayers();

    const geojsonOptions = {
      style: () => ({ color: s.cor, weight: s.espessura, opacity: 1, fillColor: s.cor, fillOpacity: s.opacidade }),
    };

    const feature: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry };

    L.geoJSON(feature, geojsonOptions).addTo(lg);

    if (s.brilho) {
      L.geoJSON(feature, { style: () => ({ color: s.cor, weight: s.espessura + 14, opacity: 0.07, fill: false }) }).addTo(lg);
      L.geoJSON(feature, { style: () => ({ color: s.cor, weight: s.espessura + 7,  opacity: 0.15, fill: false }) }).addTo(lg);
      L.geoJSON(feature, { style: () => ({ color: s.cor, weight: s.espessura + 3,  opacity: 0.30, fill: false }) }).addTo(lg);
      L.geoJSON(feature, { style: () => ({ color: '#FFFFFF', weight: 1, opacity: 0.5, fill: false }) }).addTo(lg);
    }
  }, []);

  useEffect(() => {
    if (currentGeometry) drawPolygon(currentGeometry, style);
  }, [style, currentGeometry, drawPolygon]);

  // ─── Animação de pulsação ─────────────────────────────────────────────────
  useEffect(() => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (!style.animacao || !currentGeometry) return;

    let t = 0;
    const lg = layerGroupRef.current;
    if (!lg) return;

    const tick = () => {
      t += 0.03;
      const wave = 0.5 + 0.5 * Math.sin(t * Math.PI);
      const opacity = 0.1 + wave * 0.3;
      const weight  = style.espessura + wave * 3;

      lg.eachLayer((layer: any) => {
        if (layer.setStyle) { try { layer.setStyle({ opacity, weight }); } catch { /* ignorar */ } }
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [style.animacao, style.espessura, currentGeometry]);

  // ─── Autocomplete (debounce 320ms) ───────────────────────────────────────
  useEffect(() => {
    if (query.length < 3) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(`${API_BASE}/geocode/search?q=${encodeURIComponent(query)}&limit=6`);
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch { setSuggestions([]); }
    }, 320);
    return () => clearTimeout(timer);
  }, [query]);

  // ─── Consulta bairros já cadastrados em um município ──────────────────────
  // Dispara automaticamente quando o resultado da busca é uma cidade/município,
  // ou quando o nome do município bate com o que foi buscado.
  const fetchTerritorioDaCidade = useCallback(async (municipioNome: string) => {
    if (!municipioNome) { setTerritorioPanel(null); return; }
    setTerritorioLoading(true);
    setTerritorioCidade(municipioNome);
    try {
      const res = await fetch(`${API_BASE}/areas?municipio=${encodeURIComponent(municipioNome)}&sort=faccao&limit=100`);
      if (!res.ok) throw new Error('Erro ao consultar território');
      const data = await res.json();
      const areas: SavedArea[] = data.data ?? [];
      setTerritorioPanel(areas.length > 0 ? areas : []);
    } catch {
      setTerritorioPanel(null);
    } finally {
      setTerritorioLoading(false);
    }
  }, []);

  // ─── Seleciona área pela busca ────────────────────────────────────────────
  const handleSelect = async (result: SearchResult) => {
    setSuggestions([]);
    setQuery(result.nome);
    setSelectedResult(result);
    setCurrentAreaId(null);
    setLoading(true);
    setSaveMsg('');
    setAreaData(prev => ({ ...prev, nome: result.nome, municipio: result.municipio || '', estado: result.estado || '' }));

    // Se o resultado é uma cidade/município (ou tem município associado),
    // consulta automaticamente quais bairros já têm facção registrada ali.
    const tiposCidade = ['cidade', 'municipio'];
    const nomeMunicipioParaConsulta = tiposCidade.includes(result.tipo) ? result.nome : (result.municipio || null);
    if (nomeMunicipioParaConsulta) {
      fetchTerritorioDaCidade(nomeMunicipioParaConsulta);
    } else {
      setTerritorioPanel(null);
    }

    try {
      const res  = await fetch(`${API_BASE}/geocode/polygon?osm_type=${result.osm_type}&osm_id=${result.osm_id}`);
      const data = await res.json();
      if (!data.geometry) throw new Error('Polígono não encontrado');

      const geom = data.geometry;
      setCurrentGeometry(geom);
      drawPolygon(geom, style);

      const map = mapRef.current;
      if (map) {
        try {
          const fc    = turf.featureCollection([{ type: 'Feature', properties: {}, geometry: geom }]);
          const bbox  = turf.bbox(fc);
          const areaM2 = turf.area(fc);
          setMetrics({ areaKm2: Math.round(areaM2 / 1000) / 1000 });
          map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [60, 60], maxZoom: 15 });
        } catch {
          map.setView([result.lat, result.lng], 13);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar polígono:', err);
      mapRef.current?.setView([result.lat, result.lng], 13);
    } finally {
      setLoading(false);
    }
  };

  // ─── Carrega lista de áreas salvas (com ordenação no backend) ────────────
  const fetchSavedAreas = useCallback(async (sort: SortMode = sortMode) => {
    setListLoading(true);
    setListError('');
    try {
      const res = await fetch(`${API_BASE}/areas?limit=200&sort=${sort}`);
      if (!res.ok) throw new Error('Erro ao buscar áreas salvas');
      const data = await res.json();
      setSavedAreas(data.data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [sortMode]);

  useEffect(() => {
    if (activeTab === 'list') fetchSavedAreas(sortMode);
  }, [activeTab, sortMode, fetchSavedAreas]);

  // ─── Carrega uma área salva no mapa ───────────────────────────────────────
  const handleLoadSavedArea = async (area: SavedArea) => {
    setLoading(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/areas/${area.id}`);
      if (!res.ok) throw new Error('Erro ao carregar área completa');
      const full = await res.json();

      if (!full.geometry) throw new Error('Área sem geometria salva');

      setCurrentGeometry(full.geometry);
      setCurrentAreaId(area.id);
      setQuery(area.nome);
      setSelectedResult(null);

      const loadedStyle: AreaStyle = {
        cor: area.cor_contorno || '#00FFFF',
        espessura: area.espessura ?? 3,
        opacidade: area.opacidade ?? 0.2,
        brilho: area.brilho_ativo ?? true,
        animacao: area.animacao_ativa ?? false,
      };
      setStyle(loadedStyle);

      setAreaData({
        nome: area.nome || '',
        municipio: area.municipio || '',
        estado: area.estado || '',
        regiao: area.regiao || '',
        populacao: area.populacao ? String(area.populacao) : '',
        faccao: area.faccao || '',
        descricao: area.descricao || '',
        observacoes: area.observacoes || '',
      });

      drawPolygon(full.geometry, loadedStyle);

      const map = mapRef.current;
      if (map) {
        try {
          const fc = turf.featureCollection([{ type: 'Feature', properties: {}, geometry: full.geometry }]);
          const bbox = turf.bbox(fc);
          const areaM2 = turf.area(fc);
          setMetrics({ areaKm2: Math.round(areaM2 / 1000) / 1000 });
          map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [60, 60], maxZoom: 15 });
        } catch { /* ignorar */ }
      }

      setActiveTab('style');
    } catch (err) {
      setSaveMsg(`❌ Erro ao carregar: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Excluir área salva ───────────────────────────────────────────────────
  const handleDeleteArea = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    try {
      const res = await fetch(`${API_BASE}/areas/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir');
      setSavedAreas(prev => prev.filter(a => a.id !== id));
      setTerritorioPanel(prev => prev ? prev.filter(a => a.id !== id) : prev);
      if (currentAreaId === id) setCurrentAreaId(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmDeleteId(null);
    }
  };

  // ─── Exportar área salva (backend) ────────────────────────────────────────
  const handleExportSaved = (id: string, fmt: 'geojson' | 'kml' | 'csv') => {
    window.open(`${API_BASE}/export/${id}?fmt=${fmt}`, '_blank');
  };

  // ─── Salvar (criar nova) ───────────────────────────────────────────────────
  const handleSave = async () => {
    if (!currentGeometry) return setSaveMsg('❌ Selecione uma área primeiro');
    if (!areaData.nome.trim()) return setSaveMsg('❌ Nome é obrigatório');
    setLoading(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/areas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...areaData,
          populacao: areaData.populacao ? parseInt(areaData.populacao) : null,
          faccao: areaData.faccao.trim() || null,
          tipo: selectedResult?.tipo || 'bairro',
          cor_contorno: style.cor, espessura: style.espessura,
          opacidade: style.opacidade, brilho_ativo: style.brilho,
          animacao_ativa: style.animacao, geometry: currentGeometry,
          osm_id: selectedResult?.osm_id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      setCurrentAreaId(created.id || null);
      setSaveMsg('✅ Área salva com sucesso!');
      // Atualiza o painel de território caso a cidade atual esteja sendo exibida
      if (areaData.municipio && territorioCidade) {
        fetchTerritorioDaCidade(territorioCidade);
      }
    } catch (err) {
      setSaveMsg(`❌ Erro: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Aplica a cor sugerida da sigla digitada ──────────────────────────────
  const handleFaccaoChange = (value: string) => {
    setAreaData(d => ({ ...d, faccao: value }));
    const sugerida = faccaoColor(value);
    if (sugerida) setStyle(s => ({ ...s, cor: sugerida }));
  };

  // ─── Exportar GeoJSON (área atual) ─────────────────────────────────────────
  const handleExport = () => {
    if (!currentGeometry) return;
    const feature: GeoJSON.Feature = { type: 'Feature', properties: { ...areaData }, geometry: currentGeometry };
    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${areaData.nome || 'area'}.geojson`;
    a.click();
  };

  // ─── Lista de siglas distintas presentes nos dados (para o filtro) ───────
  const faccoesDisponiveis = Array.from(
    new Set(savedAreas.map(a => (a.faccao || '').trim()).filter(Boolean))
  ).sort();

  // ─── Filtro da lista (texto + sigla) ──────────────────────────────────────
  const filteredAreas = savedAreas.filter(a => {
    const term = listSearch.toLowerCase();
    const matchesText =
      a.nome.toLowerCase().includes(term) ||
      (a.municipio || '').toLowerCase().includes(term) ||
      (a.estado || '').toLowerCase().includes(term);
    const matchesFaccao = !faccaoFilter || (a.faccao || '').toUpperCase() === faccaoFilter.toUpperCase();
    return matchesText && matchesFaccao;
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', width: '100vw', background: mapTheme === 'dark' ? '#0a0a0f' : '#e8eaed', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>

      {/* ── Barra Superior ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: mapTheme === 'dark' ? 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)' : 'linear-gradient(to bottom, rgba(255,255,255,0.9), transparent)' }}>

        <div style={{ color: mapTheme === 'dark' ? '#00FFFF' : '#0088aa', fontWeight: 700, fontSize: 18, letterSpacing: '0.05em', textShadow: mapTheme === 'dark' ? '0 0 10px #00FFFF' : 'none', whiteSpace: 'nowrap' }}>
          ⬡ GeoDelimit
        </div>

        <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍  Pesquisar cidade, bairro, estado..."
            style={{
              width: '100%', padding: '10px 16px',
              border: mapTheme === 'dark' ? '1px solid rgba(0,255,255,0.4)' : '1px solid rgba(0,0,0,0.2)',
              borderRadius: 8,
              background: mapTheme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)',
              color: mapTheme === 'dark' ? '#fff' : '#111',
              fontSize: 14, outline: 'none', backdropFilter: 'blur(8px)', boxSizing: 'border-box',
            }}
          />
          {loading && <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: mapTheme === 'dark' ? '#00FFFF' : '#0088aa', fontSize: 18, animation: 'spin 1s linear infinite' }}>⟳</div>}

          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
              background: mapTheme === 'dark' ? 'rgba(8,8,20,0.98)' : 'rgba(255,255,255,0.98)',
              border: mapTheme === 'dark' ? '1px solid rgba(0,255,255,0.3)' : '1px solid rgba(0,0,0,0.15)',
              borderRadius: 8, overflow: 'hidden', zIndex: 2000, backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}>
              {suggestions.map((s, i) => (
                <div key={i} onClick={() => handleSelect(s)}
                  style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.06)', color: mapTheme === 'dark' ? '#e0e0e0' : '#222', fontSize: 13, transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = mapTheme === 'dark' ? 'rgba(0,255,255,0.12)' : 'rgba(0,150,170,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: mapTheme === 'dark' ? '#00FFFF' : '#0088aa', marginRight: 8 }}>📍</span>
                  <strong>{s.nome}</strong>
                  <span style={{ color: mapTheme === 'dark' ? '#666' : '#888', marginLeft: 8, fontSize: 11 }}>
                    {[s.municipio, s.estado, 'Brasil'].filter(Boolean).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => setMapTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          title={mapTheme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
          style={{
            padding: '9px 14px',
            background: mapTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(0,0,0,0.15)',
            borderRadius: 8, color: mapTheme === 'dark' ? '#FFD700' : '#444', cursor: 'pointer', fontSize: 16, flexShrink: 0,
          }}>
          {mapTheme === 'dark' ? '☀️' : '🌙'}
        </button>

        <button onClick={() => setSidebarOpen(v => !v)}
          style={{
            padding: '9px 14px',
            background: mapTheme === 'dark' ? 'rgba(0,255,255,0.1)' : 'rgba(0,150,170,0.1)',
            border: mapTheme === 'dark' ? '1px solid rgba(0,255,255,0.3)' : '1px solid rgba(0,150,170,0.3)',
            borderRadius: 8, color: mapTheme === 'dark' ? '#00FFFF' : '#0088aa', cursor: 'pointer', fontSize: 16, flexShrink: 0,
          }}>
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </div>

      {/* ── Mapa ── */}
      <div ref={mapContainer} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

      {/* ── Painel de Resumo Territorial (bairros já cadastrados na cidade buscada) ── */}
      {territorioPanel !== null && (
        <div style={{
          position: 'absolute', top: 72, right: 16, zIndex: 600, width: 300, maxHeight: 'calc(100vh - 140px)',
          background: mapTheme === 'dark' ? 'rgba(8,8,18,0.97)' : 'rgba(255,255,255,0.98)',
          border: mapTheme === 'dark' ? '1px solid rgba(255,90,90,0.3)' : '1px solid rgba(200,30,30,0.25)',
          borderRadius: 10, backdropFilter: 'blur(14px)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
          }}>
            <div style={{ color: mapTheme === 'dark' ? '#ff6b6b' : '#cc2222', fontWeight: 700, fontSize: 12, letterSpacing: '0.04em' }}>
              ⚠ Domínio territorial — {territorioCidade}
            </div>
            <button onClick={() => setTerritorioPanel(null)}
              style={{ background: 'transparent', border: 'none', color: mapTheme === 'dark' ? '#888' : '#999', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
          </div>

          <div style={{ overflowY: 'auto', maxHeight: 360, padding: 8 }}>
            {territorioLoading && (
              <div style={{ padding: '16px', textAlign: 'center', color: mapTheme === 'dark' ? '#888' : '#999', fontSize: 12 }}>⟳ Consultando registros...</div>
            )}

            {!territorioLoading && territorioPanel.length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', color: mapTheme === 'dark' ? '#666' : '#999', fontSize: 12 }}>
                Nenhum bairro com facção registrada nesta cidade ainda.
              </div>
            )}

            {!territorioLoading && territorioPanel.map(area => {
              const cor = area.cor_contorno || faccaoColor(area.faccao) || '#888';
              return (
                <div key={area.id} onClick={() => handleLoadSavedArea(area)}
                  style={{
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                    background: mapTheme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.05)',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = hexToRgba(cor, 0.12))}
                  onMouseLeave={e => (e.currentTarget.style.background = mapTheme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)')}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor, boxShadow: `0 0 6px ${cor}`, flexShrink: 0 }} />
                  <span style={{ color: mapTheme === 'dark' ? '#ddd' : '#222', fontSize: 12, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {area.nome}
                  </span>
                  {area.faccao && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                      background: hexToRgba(cor, 0.2), color: cor, border: `1px solid ${cor}66`, flexShrink: 0,
                    }}>
                      {area.faccao.toUpperCase()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {!territorioLoading && territorioPanel.length > 0 && (
            <div style={{ padding: '8px 14px', borderTop: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)', fontSize: 10, color: mapTheme === 'dark' ? '#555' : '#999' }}>
              {territorioPanel.length} {territorioPanel.length === 1 ? 'área registrada' : 'áreas registradas'} · clique para visualizar
            </div>
          )}
        </div>
      )}

      {/* ── Métricas ── */}
      {metrics && (
        <div style={{
          position: 'absolute', bottom: 40, left: sidebarOpen ? 'calc(340px + 16px)' : 16, zIndex: 500,
          background: mapTheme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)',
          border: `1px solid ${hexToRgba(style.cor, 0.5)}`, borderRadius: 8, padding: '8px 16px',
          color: mapTheme === 'dark' ? style.cor : '#222', fontSize: 13, backdropFilter: 'blur(8px)',
          transition: 'left 0.3s', boxShadow: `0 0 12px ${hexToRgba(style.cor, 0.2)}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span>📐 Área: <strong>{metrics.areaKm2} km²</strong></span>
          {areaData.faccao && (
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              background: hexToRgba(style.cor, 0.25), border: `1px solid ${style.cor}`,
              color: mapTheme === 'dark' ? '#fff' : '#222',
            }}>
              {areaData.faccao.toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* ── Painel Lateral ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 500, width: sidebarOpen ? 340 : 0,
        background: mapTheme === 'dark' ? 'rgba(6,6,16,0.96)' : 'rgba(255,255,255,0.97)',
        borderRight: mapTheme === 'dark' ? '1px solid rgba(0,255,255,0.12)' : '1px solid rgba(0,0,0,0.08)',
        backdropFilter: 'blur(16px)', overflow: 'hidden', transition: 'width 0.3s ease, background 0.3s', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '72px 16px 16px', overflowY: 'auto', flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {(['style', 'data', 'list'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 6,
                  border: `1px solid ${activeTab === tab ? (mapTheme === 'dark' ? 'rgba(0,255,255,0.5)' : 'rgba(0,150,170,0.5)') : (mapTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)')}`,
                  background: activeTab === tab ? (mapTheme === 'dark' ? 'rgba(0,255,255,0.15)' : 'rgba(0,150,170,0.1)') : 'transparent',
                  color: activeTab === tab ? (mapTheme === 'dark' ? '#00FFFF' : '#0088aa') : (mapTheme === 'dark' ? '#666' : '#888'),
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                }}>
                {tab === 'style' ? '🎨 Estilo' : tab === 'data' ? '📝 Dados' : '📋 Lista'}
              </button>
            ))}
          </div>

          {/* ── Aba Estilo ── */}
          {activeTab === 'style' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              <SectionTitle theme={mapTheme}>Cores Neon</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {NEON_COLORS.map(c => (
                  <button key={c.hex} onClick={() => setStyle(s => ({ ...s, cor: c.hex }))} title={c.name}
                    style={{ width: 38, height: 38, borderRadius: 8, background: c.hex, border: style.cor === c.hex ? `3px solid ${mapTheme === 'dark' ? 'white' : '#333'}` : '2px solid transparent', cursor: 'pointer', boxShadow: `0 0 10px ${c.hex}88`, transition: 'transform 0.15s' }} />
                ))}
                <input type="color" value={style.cor} onChange={e => setStyle(s => ({ ...s, cor: e.target.value }))}
                  style={{ width: 38, height: 38, borderRadius: 8, border: mapTheme === 'dark' ? '2px solid rgba(255,255,255,0.2)' : '2px solid rgba(0,0,0,0.15)', cursor: 'pointer', padding: 2, background: 'transparent' }} title="Cor personalizada" />
              </div>

              <SectionTitle theme={mapTheme}>Espessura da Linha</SectionTitle>
              <SliderRow value={style.espessura} min={1} max={12} step={1} onChange={v => setStyle(s => ({ ...s, espessura: v }))} label={`${style.espessura}px`} color={style.cor} />

              <SectionTitle theme={mapTheme}>Opacidade do Preenchimento</SectionTitle>
              <SliderRow value={style.opacidade} min={0} max={0.8} step={0.05} onChange={v => setStyle(s => ({ ...s, opacidade: v }))} label={`${Math.round(style.opacidade * 100)}%`} color={style.cor} />

              <SectionTitle theme={mapTheme}>Efeitos</SectionTitle>
              <ToggleRow label="✨ Efeito Brilho (Glow)"  value={style.brilho}   onChange={v => setStyle(s => ({ ...s, brilho: v }))}   color={style.cor} theme={mapTheme} />
              <ToggleRow label="💫 Animação de Pulsação"  value={style.animacao} onChange={v => setStyle(s => ({ ...s, animacao: v }))} color={style.cor} theme={mapTheme} />

              <SectionTitle theme={mapTheme}>Mapa</SectionTitle>
              <ToggleRow label="☀️ Modo Claro do Mapa" value={mapTheme === 'light'} onChange={v => setMapTheme(v ? 'light' : 'dark')} color={style.cor} theme={mapTheme} />

              {currentGeometry && (
                <>
                  <SectionTitle theme={mapTheme}>Exportar</SectionTitle>
                  <button onClick={handleExport} style={btnStyle('#0a2a0a', '#00FF41')}>⬇ Exportar GeoJSON</button>
                </>
              )}
            </div>
          )}

          {/* ── Aba Dados ── */}
          {activeTab === 'data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionTitle theme={mapTheme}>{currentAreaId ? 'Editando Área Salva' : 'Informações da Área'}</SectionTitle>

              {([
                ['nome',      'Nome da Área *',      'text'],
                ['municipio', 'Município',           'text'],
                ['estado',    'Estado',              'text'],
                ['regiao',    'Região',              'text'],
                ['populacao', 'População estimada',  'number'],
              ] as [keyof AreaData, string, string][]).map(([field, label, type]) => (
                <div key={field}>
                  <label style={{ color: mapTheme === 'dark' ? '#666' : '#777', fontSize: 11, display: 'block', marginBottom: 4, letterSpacing: '0.05em' }}>{label}</label>
                  <input type={type} value={areaData[field]} onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      background: mapTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.12)',
                      color: mapTheme === 'dark' ? '#e0e0e0' : '#222',
                      fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
                    }} />
                </div>
              ))}

              <div>
                <label style={{ color: mapTheme === 'dark' ? '#666' : '#777', fontSize: 11, display: 'block', marginBottom: 4, letterSpacing: '0.05em' }}>
                  Sigla / Organização com domínio territorial
                </label>
                <input
                  list="faccao-sugestoes"
                  value={areaData.faccao}
                  onChange={e => handleFaccaoChange(e.target.value)}
                  placeholder="Ex: CV, PCC, ADA..."
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: mapTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.12)',
                    color: mapTheme === 'dark' ? '#e0e0e0' : '#222',
                    fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <datalist id="faccao-sugestoes">
                  {FACCAO_SUGESTOES.map(f => <option key={f} value={f} />)}
                </datalist>
                <div style={{ color: mapTheme === 'dark' ? '#555' : '#999', fontSize: 10, marginTop: 4 }}>
                  Campo de uso interno/institucional — a cor do contorno é sugerida automaticamente.
                </div>
              </div>

              {(['descricao', 'observacoes'] as const).map(field => (
                <div key={field}>
                  <label style={{ color: mapTheme === 'dark' ? '#666' : '#777', fontSize: 11, display: 'block', marginBottom: 4, letterSpacing: '0.05em' }}>
                    {field === 'descricao' ? 'Descrição' : 'Observações'}
                  </label>
                  <textarea value={areaData[field]} onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))} rows={3}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      background: mapTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.12)',
                      color: mapTheme === 'dark' ? '#e0e0e0' : '#222',
                      fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                    }} />
                </div>
              ))}

              <button onClick={handleSave} disabled={loading} style={btnStyle('#001a33', '#00FFFF', loading)}>
                {loading ? '⟳ Salvando...' : currentAreaId ? '💾 Salvar como Nova Cópia' : '💾 Salvar no Banco de Dados'}
              </button>

              {saveMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: saveMsg.startsWith('✅') ? 'rgba(0,255,65,0.1)' : 'rgba(255,50,50,0.1)', color: saveMsg.startsWith('✅') ? '#00FF41' : '#ff6b6b', fontSize: 13, border: `1px solid ${saveMsg.startsWith('✅') ? 'rgba(0,255,65,0.3)' : 'rgba(255,50,50,0.3)'}` }}>
                  {saveMsg}
                </div>
              )}
            </div>
          )}

          {/* ── Aba Lista (Áreas Salvas) ── */}
          {activeTab === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>

              <input
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder="🔍 Filtrar por nome, município, estado..."
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  background: mapTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                  border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.12)',
                  color: mapTheme === 'dark' ? '#e0e0e0' : '#222', fontSize: 13, outline: 'none',
                }}
              />

              <div>
                <label style={{ color: mapTheme === 'dark' ? '#555' : '#999', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ordenar por</label>
                <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
                  style={{
                    width: '100%', marginTop: 4, padding: '7px 10px', borderRadius: 6,
                    background: mapTheme === 'dark' ? 'rgba(255,255,255,0.05)' : '#fff',
                    border: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.15)',
                    color: mapTheme === 'dark' ? '#e0e0e0' : '#222', fontSize: 12,
                  }}>
                  <option value="faccao">Sigla (agrupar por facção)</option>
                  <option value="recente">Mais recentes</option>
                  <option value="nome">Nome (A-Z)</option>
                  <option value="area">Maior área</option>
                </select>
              </div>

              {faccoesDisponiveis.length > 0 && (
                <div>
                  <label style={{ color: mapTheme === 'dark' ? '#555' : '#999', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Filtrar sigla</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <button onClick={() => setFaccaoFilter('')}
                      style={chipStyle(faccaoFilter === '', mapTheme === 'dark' ? '#888' : '#666', mapTheme)}>
                      Todas
                    </button>
                    {faccoesDisponiveis.map(f => {
                      const cor = faccaoColor(f) || '#888';
                      return (
                        <button key={f} onClick={() => setFaccaoFilter(f)}
                          style={chipStyle(faccaoFilter.toUpperCase() === f.toUpperCase(), cor, mapTheme)}>
                          {f.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button onClick={() => fetchSavedAreas(sortMode)} style={{
                padding: '7px', borderRadius: 6,
                background: mapTheme === 'dark' ? 'rgba(0,255,255,0.06)' : 'rgba(0,150,170,0.08)',
                border: mapTheme === 'dark' ? '1px solid rgba(0,255,255,0.25)' : '1px solid rgba(0,150,170,0.25)',
                color: mapTheme === 'dark' ? '#00FFFF' : '#0088aa', fontSize: 12, cursor: 'pointer',
              }}>
                {listLoading ? '⟳ Carregando...' : `↻ Recarregar (${filteredAreas.length}/${savedAreas.length})`}
              </button>

              {listError && (
                <div style={{ color: '#ff6b6b', fontSize: 12, padding: '6px 10px', background: 'rgba(255,0,0,0.08)', borderRadius: 6 }}>
                  {listError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1 }}>
                {filteredAreas.length === 0 && !listLoading && (
                  <div style={{ color: mapTheme === 'dark' ? '#444' : '#999', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    {listSearch || faccaoFilter ? 'Nenhuma área encontrada' : 'Nenhuma área salva ainda'}
                  </div>
                )}

                {filteredAreas.map(area => {
                  const corFaccao = faccaoColor(area.faccao);
                  return (
                    <div key={area.id}
                      style={{
                        borderRadius: 8,
                        border: currentAreaId === area.id ? `1px solid ${area.cor_contorno}` : (mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.08)'),
                        background: currentAreaId === area.id ? hexToRgba(area.cor_contorno, 0.1) : (mapTheme === 'dark' ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)'),
                        overflow: 'hidden',
                      }}
                    >
                      <div onClick={() => handleLoadSavedArea(area)}
                        style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: area.cor_contorno, boxShadow: `0 0 6px ${area.cor_contorno}` }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: mapTheme === 'dark' ? '#e0e0e0' : '#222', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {TIPO_ICONS[area.tipo] || '📍'} {area.nome}
                            </span>
                            {area.faccao && (
                              <span style={{
                                fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
                                background: hexToRgba(corFaccao || '#888', 0.2),
                                color: corFaccao || '#888',
                                border: `1px solid ${corFaccao || '#888'}66`,
                                flexShrink: 0,
                              }}>
                                {area.faccao.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div style={{ color: mapTheme === 'dark' ? '#555' : '#999', fontSize: 11, marginTop: 2 }}>
                            {[area.municipio, area.estado].filter(Boolean).join(', ')}
                            {area.area_km2 ? ` · ${Number(area.area_km2).toFixed(2)} km²` : ''}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 4, padding: '0 8px 8px', borderTop: mapTheme === 'dark' ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
                        {(['geojson', 'kml', 'csv'] as const).map(fmt => (
                          <button key={fmt} onClick={() => handleExportSaved(area.id, fmt)} title={`Exportar ${fmt.toUpperCase()}`}
                            style={microBtn('#0a1f0a', '#00FF41')}>
                            {fmt.toUpperCase()}
                          </button>
                        ))}
                        <div style={{ flex: 1 }} />
                        <button onClick={() => handleDeleteArea(area.id)}
                          style={microBtn(confirmDeleteId === area.id ? '#330a0a' : '#1a0a0a', confirmDeleteId === area.id ? '#FF5555' : '#FF666688')}
                          title={confirmDeleteId === area.id ? 'Confirmar exclusão' : 'Excluir área'}>
                          {confirmDeleteId === area.id ? '⚠ Confirmar' : '🗑'}
                        </button>
                        {confirmDeleteId === area.id && (
                          <button onClick={() => setConfirmDeleteId(null)} style={microBtn('#161616', '#888')}>✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS global inline */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { background: ${mapTheme === 'dark' ? '#0a0a0f' : '#e8eaed'} !important; }
        .leaflet-tile { filter: ${mapTheme === 'dark' ? 'brightness(0.85) saturate(0.7)' : 'none'}; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        ::-webkit-scrollbar-thumb { background: rgba(0,255,255,0.3); border-radius: 2px; }
        input:focus, textarea:focus, select:focus { border-color: rgba(0,255,255,0.4) !important; box-shadow: 0 0 0 2px rgba(0,255,255,0.08) !important; }
      `}</style>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function SectionTitle({ children, theme }: { children: React.ReactNode; theme: MapTheme }) {
  return (
    <div style={{ color: theme === 'dark' ? '#555' : '#999', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function SliderRow({ value, min, max, step, onChange, label, color }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; label: string; color: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: color, height: 4 }} />
      <span style={{ color, fontSize: 12, minWidth: 36, textAlign: 'right', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function ToggleRow({ label, value, onChange, color, theme }: {
  label: string; value: boolean; onChange: (v: boolean) => void; color: string; theme: MapTheme;
}) {
  return (
    <div onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
        padding: '10px 12px', borderRadius: 8,
        background: theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
        border: theme === 'dark' ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.06)',
        transition: 'background 0.2s',
      }}>
      <span style={{ color: theme === 'dark' ? '#bbb' : '#444', fontSize: 13 }}>{label}</span>
      <div style={{ width: 42, height: 24, borderRadius: 12, background: value ? color : (theme === 'dark' ? '#222' : '#ccc'), position: 'relative', transition: 'background 0.25s', boxShadow: value ? `0 0 10px ${color}66` : 'none', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 4, left: value ? 22 : 4, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string, disabled = false): React.CSSProperties {
  return {
    padding: '11px 16px', borderRadius: 8,
    background: disabled ? 'rgba(255,255,255,0.03)' : bg,
    border: `1px solid ${color}${disabled ? '22' : '44'}`,
    color: disabled ? '#444' : color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 14, fontWeight: 600, width: '100%',
    boxShadow: disabled ? 'none' : `0 0 16px ${color}22`,
    transition: 'all 0.2s',
  };
}

function microBtn(bg: string, color: string): React.CSSProperties {
  return {
    padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
    background: bg, border: `1px solid ${color}44`, color, cursor: 'pointer',
  };
}

function chipStyle(active: boolean, color: string, theme: MapTheme): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
    background: active ? hexToRgba(color, 0.25) : (theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
    border: `1px solid ${active ? color : (theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)')}`,
    color: active ? color : (theme === 'dark' ? '#888' : '#666'),
    cursor: 'pointer',
  };
}
