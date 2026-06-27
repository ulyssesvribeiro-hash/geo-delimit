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
  area_km2?: number;
  perimetro_km?: number;
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

// ─── Helpers de cor ───────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

declare global {
  interface Window { L: any; }
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function App() {
  const mapRef        = useRef<any>(null);
  const leafletRef    = useRef<any>(null);
  const layerGroupRef = useRef<any>(null);
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

  // ── Estado da lista de áreas salvas ──
  const [savedAreas,      setSavedAreas]      = useState<SavedArea[]>([]);
  const [listLoading,     setListLoading]     = useState(false);
  const [listError,       setListError]       = useState('');
  const [listSearch,      setListSearch]      = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [style, setStyle] = useState<AreaStyle>({
    cor: '#00FFFF', espessura: 3, opacidade: 0.2, brilho: true, animacao: false,
  });

  const [areaData, setAreaData] = useState<AreaData>({
    nome: '', municipio: '', estado: '', regiao: '', populacao: '', descricao: '', observacoes: '',
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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    leafletRef.current = L;
  }, [leafletReady]);

  // ─── Desenha polígono com efeito neon ────────────────────────────────────
  const drawPolygon = useCallback((geometry: GeoJSON.Geometry, s: AreaStyle) => {
    const L = leafletRef.current;
    const lg = layerGroupRef.current;
    if (!L || !lg) return;

    lg.clearLayers();

    const geojsonOptions = {
      style: () => ({
        color: s.cor,
        weight: s.espessura,
        opacity: 1,
        fillColor: s.cor,
        fillOpacity: s.opacidade,
      }),
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

  // ─── Atualiza visual quando estilo muda ──────────────────────────────────
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
        if (layer.setStyle) {
          try { layer.setStyle({ opacity, weight }); } catch { /* ignorar */ }
        }
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

  // ─── Seleciona área pela busca ────────────────────────────────────────────
  const handleSelect = async (result: SearchResult) => {
    setSuggestions([]);
    setQuery(result.nome);
    setSelectedResult(result);
    setCurrentAreaId(null);
    setLoading(true);
    setSaveMsg('');
    setAreaData(prev => ({ ...prev, nome: result.nome, municipio: result.municipio || '', estado: result.estado || '' }));

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

  // ─── Carrega lista de áreas salvas ───────────────────────────────────────
  const fetchSavedAreas = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const res = await fetch(`${API_BASE}/areas?limit=100`);
      if (!res.ok) throw new Error('Erro ao buscar áreas salvas');
      const data = await res.json();
      setSavedAreas(data.data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, []);

  // Carrega a lista automaticamente quando o usuário abre a aba "Lista"
  useEffect(() => {
    if (activeTab === 'list') fetchSavedAreas();
  }, [activeTab, fetchSavedAreas]);

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

      setStyle({
        cor: area.cor_contorno || '#00FFFF',
        espessura: area.espessura ?? 3,
        opacidade: area.opacidade ?? 0.2,
        brilho: area.brilho_ativo ?? true,
        animacao: area.animacao_ativa ?? false,
      });

      setAreaData({
        nome: area.nome || '',
        municipio: area.municipio || '',
        estado: area.estado || '',
        regiao: area.regiao || '',
        populacao: area.populacao ? String(area.populacao) : '',
        descricao: area.descricao || '',
        observacoes: area.observacoes || '',
      });

      drawPolygon(full.geometry, {
        cor: area.cor_contorno || '#00FFFF',
        espessura: area.espessura ?? 3,
        opacidade: area.opacidade ?? 0.2,
        brilho: area.brilho_ativo ?? true,
        animacao: area.animacao_ativa ?? false,
      });

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
    } catch (err) {
      setSaveMsg(`❌ Erro: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Exportar GeoJSON (área atual, ainda não necessariamente salva) ───────
  const handleExport = () => {
    if (!currentGeometry) return;
    const feature: GeoJSON.Feature = { type: 'Feature', properties: { ...areaData }, geometry: currentGeometry };
    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${areaData.nome || 'area'}.geojson`;
    a.click();
  };

  // ─── Filtro da lista ──────────────────────────────────────────────────────
  const filteredAreas = savedAreas.filter(a => {
    const term = listSearch.toLowerCase();
    return (
      a.nome.toLowerCase().includes(term) ||
      (a.municipio || '').toLowerCase().includes(term) ||
      (a.estado || '').toLowerCase().includes(term)
    );
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', width: '100vw', background: '#0a0a0f', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>

      {/* ── Barra Superior ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)' }}>

        <div style={{ color: '#00FFFF', fontWeight: 700, fontSize: 18, letterSpacing: '0.05em', textShadow: '0 0 10px #00FFFF', whiteSpace: 'nowrap' }}>
          ⬡ GeoDelimit
        </div>

        <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍  Pesquisar cidade, bairro, estado..."
            style={{ width: '100%', padding: '10px 16px', border: '1px solid rgba(0,255,255,0.4)', borderRadius: 8, background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 14, outline: 'none', backdropFilter: 'blur(8px)', boxSizing: 'border-box' }}
          />
          {loading && <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#00FFFF', fontSize: 18, animation: 'spin 1s linear infinite' }}>⟳</div>}

          {suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'rgba(8,8,20,0.98)', border: '1px solid rgba(0,255,255,0.3)', borderRadius: 8, overflow: 'hidden', zIndex: 2000, backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              {suggestions.map((s, i) => (
                <div key={i} onClick={() => handleSelect(s)}
                  style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e0e0e0', fontSize: 13, transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,255,255,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: '#00FFFF', marginRight: 8 }}>📍</span>
                  <strong>{s.nome}</strong>
                  <span style={{ color: '#666', marginLeft: 8, fontSize: 11 }}>
                    {[s.municipio, s.estado, 'Brasil'].filter(Boolean).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => setSidebarOpen(v => !v)}
          style={{ padding: '9px 14px', background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.3)', borderRadius: 8, color: '#00FFFF', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </div>

      {/* ── Mapa ── */}
      <div ref={mapContainer} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

      {/* ── Métricas ── */}
      {metrics && (
        <div style={{ position: 'absolute', bottom: 40, left: sidebarOpen ? 'calc(340px + 16px)' : 16, zIndex: 500, background: 'rgba(0,0,0,0.8)', border: `1px solid ${hexToRgba(style.cor, 0.5)}`, borderRadius: 8, padding: '8px 16px', color: style.cor, fontSize: 13, backdropFilter: 'blur(8px)', transition: 'left 0.3s', boxShadow: `0 0 12px ${hexToRgba(style.cor, 0.2)}` }}>
          📐 Área: <strong>{metrics.areaKm2} km²</strong>
        </div>
      )}

      {/* ── Painel Lateral ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 500, width: sidebarOpen ? 340 : 0, background: 'rgba(6,6,16,0.96)', borderRight: '1px solid rgba(0,255,255,0.12)', backdropFilter: 'blur(16px)', overflow: 'hidden', transition: 'width 0.3s ease', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '72px 16px 16px', overflowY: 'auto', flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {(['style', 'data', 'list'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: `1px solid ${activeTab === tab ? 'rgba(0,255,255,0.5)' : 'rgba(255,255,255,0.08)'}`, background: activeTab === tab ? 'rgba(0,255,255,0.15)' : 'transparent', color: activeTab === tab ? '#00FFFF' : '#666', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.2s' }}>
                {tab === 'style' ? '🎨 Estilo' : tab === 'data' ? '📝 Dados' : '📋 Lista'}
              </button>
            ))}
          </div>

          {/* ── Aba Estilo ── */}
          {activeTab === 'style' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              <SectionTitle>Cores Neon</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {NEON_COLORS.map(c => (
                  <button key={c.hex} onClick={() => setStyle(s => ({ ...s, cor: c.hex }))} title={c.name}
                    style={{ width: 38, height: 38, borderRadius: 8, background: c.hex, border: style.cor === c.hex ? '3px solid white' : '2px solid transparent', cursor: 'pointer', boxShadow: `0 0 10px ${c.hex}88`, transition: 'transform 0.15s' }} />
                ))}
                <input type="color" value={style.cor} onChange={e => setStyle(s => ({ ...s, cor: e.target.value }))}
                  style={{ width: 38, height: 38, borderRadius: 8, border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 2, background: 'transparent' }} title="Cor personalizada" />
              </div>

              <SectionTitle>Espessura da Linha</SectionTitle>
              <SliderRow value={style.espessura} min={1} max={12} step={1} onChange={v => setStyle(s => ({ ...s, espessura: v }))} label={`${style.espessura}px`} color={style.cor} />

              <SectionTitle>Opacidade do Preenchimento</SectionTitle>
              <SliderRow value={style.opacidade} min={0} max={0.8} step={0.05} onChange={v => setStyle(s => ({ ...s, opacidade: v }))} label={`${Math.round(style.opacidade * 100)}%`} color={style.cor} />

              <SectionTitle>Efeitos</SectionTitle>
              <ToggleRow label="✨ Efeito Brilho (Glow)"  value={style.brilho}   onChange={v => setStyle(s => ({ ...s, brilho: v }))}   color={style.cor} />
              <ToggleRow label="💫 Animação de Pulsação"  value={style.animacao} onChange={v => setStyle(s => ({ ...s, animacao: v }))} color={style.cor} />

              {currentGeometry && (
                <>
                  <SectionTitle>Exportar</SectionTitle>
                  <button onClick={handleExport} style={btnStyle('#0a2a0a', '#00FF41')}>⬇ Exportar GeoJSON</button>
                </>
              )}
            </div>
          )}

          {/* ── Aba Dados ── */}
          {activeTab === 'data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionTitle>{currentAreaId ? 'Editando Área Salva' : 'Informações da Área'}</SectionTitle>
              {([
                ['nome',      'Nome da Área *',      'text'],
                ['municipio', 'Município',           'text'],
                ['estado',    'Estado',              'text'],
                ['regiao',    'Região',              'text'],
                ['populacao', 'População estimada',  'number'],
              ] as [keyof AreaData, string, string][]).map(([field, label, type]) => (
                <div key={field}>
                  <label style={{ color: '#666', fontSize: 11, display: 'block', marginBottom: 4, letterSpacing: '0.05em' }}>{label}</label>
                  <input type={type} value={areaData[field]} onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e0e0e0', fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' }} />
                </div>
              ))}

              {(['descricao', 'observacoes'] as const).map(field => (
                <div key={field}>
                  <label style={{ color: '#666', fontSize: 11, display: 'block', marginBottom: 4, letterSpacing: '0.05em' }}>
                    {field === 'descricao' ? 'Descrição' : 'Observações'}
                  </label>
                  <textarea value={areaData[field]} onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))} rows={3}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e0e0e0', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
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
                placeholder="🔍 Filtrar áreas salvas..."
                style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e0e0e0', fontSize: 13, outline: 'none' }}
              />

              <button onClick={fetchSavedAreas} style={{ padding: '7px', borderRadius: 6, background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.25)', color: '#00FFFF', fontSize: 12, cursor: 'pointer' }}>
                {listLoading ? '⟳ Carregando...' : `↻ Recarregar (${savedAreas.length})`}
              </button>

              {listError && (
                <div style={{ color: '#ff6b6b', fontSize: 12, padding: '6px 10px', background: 'rgba(255,0,0,0.08)', borderRadius: 6 }}>
                  {listError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1 }}>
                {filteredAreas.length === 0 && !listLoading && (
                  <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    {listSearch ? 'Nenhuma área encontrada' : 'Nenhuma área salva ainda'}
                  </div>
                )}

                {filteredAreas.map(area => (
                  <div key={area.id}
                    style={{
                      borderRadius: 8,
                      border: currentAreaId === area.id ? `1px solid ${area.cor_contorno}` : '1px solid rgba(255,255,255,0.07)',
                      background: currentAreaId === area.id ? hexToRgba(area.cor_contorno, 0.1) : 'rgba(255,255,255,0.025)',
                      overflow: 'hidden',
                    }}
                  >
                    <div onClick={() => handleLoadSavedArea(area)}
                      style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: area.cor_contorno, boxShadow: `0 0 6px ${area.cor_contorno}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {TIPO_ICONS[area.tipo] || '📍'} {area.nome}
                        </div>
                        <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                          {[area.municipio, area.estado].filter(Boolean).join(', ')}
                          {area.area_km2 ? ` · ${Number(area.area_km2).toFixed(2)} km²` : ''}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 4, padding: '0 8px 8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 6 }}>
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
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS global inline */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { background: #0a0a0f !important; }
        .leaflet-tile { filter: brightness(0.85) saturate(0.7); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        ::-webkit-scrollbar-thumb { background: rgba(0,255,255,0.3); border-radius: 2px; }
        input:focus, textarea:focus { border-color: rgba(0,255,255,0.4) !important; box-shadow: 0 0 0 2px rgba(0,255,255,0.08) !important; }
      `}</style>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#555', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
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

function ToggleRow({ label, value, onChange, color }: {
  label: string; value: boolean; onChange: (v: boolean) => void; color: string;
}) {
  return (
    <div onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
      <span style={{ color: '#bbb', fontSize: 13 }}>{label}</span>
      <div style={{ width: 42, height: 24, borderRadius: 12, background: value ? color : '#222', position: 'relative', transition: 'background 0.25s', boxShadow: value ? `0 0 10px ${color}66` : 'none', flexShrink: 0 }}>
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
