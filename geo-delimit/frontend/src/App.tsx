import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as turf from '@turf/turf';

// ─── ATENÇÃO: Substitua pela sua chave Mapbox ─────────────────────────────────
// Obtenha gratuitamente em: https://account.mapbox.com/access-tokens/
// Ou use estilo alternativo gratuito com OSM (veja README)
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || 'SUA_CHAVE_MAPBOX_AQUI';

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
  perimetroKm: number;
}

const NEON_COLORS = [
  { name: 'Ciano', hex: '#00FFFF' },
  { name: 'Verde', hex: '#00FF41' },
  { name: 'Rosa', hex: '#FF0090' },
  { name: 'Amarelo', hex: '#FFFF00' },
  { name: 'Roxo', hex: '#BF00FF' },
  { name: 'Laranja', hex: '#FF6600' },
];

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'style' | 'data' | 'list'>('style');
  const [currentGeometry, setCurrentGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [metrics, setMetrics] = useState<AreaMetrics | null>(null);
  const [saveMsg, setSaveMsg] = useState('');

  const [style, setStyle] = useState<AreaStyle>({
    cor: '#00FFFF',
    espessura: 3,
    opacidade: 0.2,
    brilho: true,
    animacao: false,
  });

  const [areaData, setAreaData] = useState<AreaData>({
    nome: '', municipio: '', estado: '',
    regiao: '', populacao: '', descricao: '', observacoes: '',
  });

  // ─── Inicializa Mapa ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      // Estilo dark gratuito — funciona sem token válido para visualização base
      style: mapboxgl.accessToken !== 'SUA_CHAVE_MAPBOX_AQUI'
        ? 'mapbox://styles/mapbox/dark-v11'
        : {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
      center: [-47.9, -15.7], // Brasília
      zoom: 4,
      attributionControl: false,
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    mapRef.current.addControl(new mapboxgl.AttributionControl({ compact: true }));

    mapRef.current.on('load', () => {
      initMapLayers(mapRef.current!);
    });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ─── Inicializa Camadas do Mapa ─────────────────────────────────────────────
  function initMapLayers(map: mapboxgl.Map) {
    // Source vazio — preenchido dinamicamente
    map.addSource('area-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Camada 1: Preenchimento transparente
    map.addLayer({
      id: 'area-fill',
      type: 'fill',
      source: 'area-source',
      paint: {
        'fill-color': '#00FFFF',
        'fill-opacity': 0.15,
      },
    });

    // Camada 2: Glow externo largo (mais difuso)
    map.addLayer({
      id: 'area-glow-outer',
      type: 'line',
      source: 'area-source',
      paint: {
        'line-color': '#00FFFF',
        'line-width': 18,
        'line-opacity': 0.08,
        'line-blur': 12,
      },
    });

    // Camada 3: Glow médio
    map.addLayer({
      id: 'area-glow-mid',
      type: 'line',
      source: 'area-source',
      paint: {
        'line-color': '#00FFFF',
        'line-width': 10,
        'line-opacity': 0.18,
        'line-blur': 6,
      },
    });

    // Camada 4: Borda principal sólida
    map.addLayer({
      id: 'area-line',
      type: 'line',
      source: 'area-source',
      paint: {
        'line-color': '#00FFFF',
        'line-width': 3,
        'line-opacity': 1,
      },
    });

    // Camada 5: Brilho interno fino (branco)
    map.addLayer({
      id: 'area-glow-inner',
      type: 'line',
      source: 'area-source',
      paint: {
        'line-color': '#FFFFFF',
        'line-width': 1,
        'line-opacity': 0.6,
        'line-blur': 1,
      },
    });
  }

  // ─── Atualiza Estilo das Camadas ────────────────────────────────────────────
  const updateMapStyle = useCallback((s: AreaStyle) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    try {
      map.setPaintProperty('area-fill', 'fill-color', s.cor);
      map.setPaintProperty('area-fill', 'fill-opacity', s.opacidade);

      map.setPaintProperty('area-line', 'line-color', s.cor);
      map.setPaintProperty('area-line', 'line-width', s.espessura);

      if (s.brilho) {
        map.setPaintProperty('area-glow-outer', 'line-color', s.cor);
        map.setPaintProperty('area-glow-outer', 'line-opacity', 0.08);
        map.setPaintProperty('area-glow-mid', 'line-color', s.cor);
        map.setPaintProperty('area-glow-mid', 'line-opacity', 0.18);
        map.setPaintProperty('area-glow-inner', 'line-opacity', 0.6);
      } else {
        map.setPaintProperty('area-glow-outer', 'line-opacity', 0);
        map.setPaintProperty('area-glow-mid', 'line-opacity', 0);
        map.setPaintProperty('area-glow-inner', 'line-opacity', 0);
      }
    } catch (e) {
      // Map ainda carregando
    }
  }, []);

  useEffect(() => {
    updateMapStyle(style);
  }, [style, updateMapStyle]);

  // ─── Animação de Pulsação ───────────────────────────────────────────────────
  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (!style.animacao) return;

    let t = 0;
    const pulse = () => {
      t += 0.03;
      const factor = 0.5 + 0.5 * Math.sin(t * Math.PI);
      const opacity = 0.08 + factor * 0.15;
      const width = style.espessura + factor * 2;

      const map = mapRef.current;
      if (map && map.isStyleLoaded()) {
        try {
          map.setPaintProperty('area-glow-mid', 'line-opacity', opacity);
          map.setPaintProperty('area-line', 'line-width', width);
        } catch (e) { /* ignorar */ }
      }
      animFrameRef.current = requestAnimationFrame(pulse);
    };

    animFrameRef.current = requestAnimationFrame(pulse);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [style.animacao, style.espessura]);

  // ─── Busca Autocomplete ─────────────────────────────────────────────────────
  useEffect(() => {
    if (query.length < 3) { setSuggestions([]); return; }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/geocode/search?q=${encodeURIComponent(query)}&limit=6`);
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      }
    }, 300); // debounce

    return () => clearTimeout(timer);
  }, [query]);

  // ─── Seleciona Área da Busca ────────────────────────────────────────────────
  const handleSelect = async (result: SearchResult) => {
    setSuggestions([]);
    setQuery(result.nome);
    setSelectedResult(result);
    setLoading(true);
    setSaveMsg('');

    // Preenche form automaticamente
    setAreaData(prev => ({
      ...prev,
      nome: result.nome,
      municipio: result.municipio || '',
      estado: result.estado || '',
    }));

    try {
      // Busca polígono via backend
      const res = await fetch(
        `${API_BASE}/geocode/polygon?osm_type=${result.osm_type}&osm_id=${result.osm_id}`
      );
      const data = await res.json();

      if (!data.geometry) throw new Error('Polígono não encontrado');

      const geom = data.geometry;
      setCurrentGeometry(geom);

      // Atualiza source do mapa
      const map = mapRef.current;
      if (map) {
        const source = map.getSource('area-source') as mapboxgl.GeoJSONSource;
        const feature: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: geom };
        source.setData({ type: 'FeatureCollection', features: [feature] });

        // Calcula métricas
        try {
          const fc = turf.featureCollection([feature]);
          const areaM2 = turf.area(fc);
          const areaKm2 = Math.round(areaM2 / 1000) / 1000;

          // Fit map to polygon
          const bbox = turf.bbox(fc);
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]] as mapboxgl.LngLatBoundsLike, {
            padding: 80,
            maxZoom: 15,
            duration: 1200,
          });

          setMetrics({ areaKm2, perimetroKm: 0 }); // perimetro calculado no backend ao salvar
        } catch (e) {
          map.flyTo({ center: [result.lng, result.lat], zoom: 13 });
        }
      }
    } catch (err) {
      console.error('Erro ao buscar polígono:', err);
      // Fallback: fly to com ponto simples
      mapRef.current?.flyTo({ center: [result.lng, result.lat], zoom: 13 });
    } finally {
      setLoading(false);
    }
  };

  // ─── Salvar Área ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!currentGeometry) return setSaveMsg('❌ Selecione uma área primeiro');
    if (!areaData.nome.trim()) return setSaveMsg('❌ Nome é obrigatório');

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/areas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...areaData,
          populacao: areaData.populacao ? parseInt(areaData.populacao) : null,
          tipo: selectedResult?.tipo || 'bairro',
          cor_contorno: style.cor,
          espessura: style.espessura,
          opacidade: style.opacidade,
          brilho_ativo: style.brilho,
          animacao_ativa: style.animacao,
          geometry: currentGeometry,
          osm_id: selectedResult?.osm_id,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      setSaveMsg('✅ Área salva com sucesso!');
    } catch (err) {
      setSaveMsg(`❌ Erro ao salvar: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Exportar ───────────────────────────────────────────────────────────────
  const handleExport = (fmt: string) => {
    if (!currentGeometry) return;

    if (fmt === 'geojson') {
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        properties: { ...areaData, cor_contorno: style.cor },
        geometry: currentGeometry,
      };
      const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${areaData.nome || 'area'}.geojson`;
      a.click();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', width: '100vw', background: '#0a0a0f', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>

      {/* ── Barra Superior ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
      }}>
        {/* Logo */}
        <div style={{ color: '#00FFFF', fontWeight: 700, fontSize: 18, letterSpacing: '0.05em', textShadow: '0 0 10px #00FFFF', whiteSpace: 'nowrap' }}>
          ⬡ GeoDelimit
        </div>

        {/* Search */}
        <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍  Pesquisar cidade, bairro, estado..."
            style={{
              width: '100%', padding: '10px 16px', border: '1px solid rgba(0,255,255,0.3)',
              borderRadius: 8, background: 'rgba(0,0,0,0.7)', color: '#fff',
              fontSize: 14, outline: 'none', backdropFilter: 'blur(8px)',
              boxSizing: 'border-box',
            }}
          />
          {loading && (
            <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#00FFFF', fontSize: 12 }}>
              ⟳
            </div>
          )}
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
              background: 'rgba(10,10,20,0.97)', border: '1px solid rgba(0,255,255,0.3)',
              borderRadius: 8, overflow: 'hidden', zIndex: 100, backdropFilter: 'blur(12px)',
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  onClick={() => handleSelect(s)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    color: '#e0e0e0', fontSize: 13, transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,255,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: '#00FFFF', marginRight: 8 }}>📍</span>
                  <strong>{s.nome}</strong>
                  <span style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>
                    {[s.municipio, s.estado, 'Brasil'].filter(Boolean).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{ padding: '9px 14px', background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.3)', borderRadius: 8, color: '#00FFFF', cursor: 'pointer', fontSize: 16 }}
          title={sidebarOpen ? 'Fechar painel' : 'Abrir painel'}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </div>

      {/* ── Mapa ── */}
      <div ref={mapContainer} style={{ flex: 1, width: '100%', height: '100%' }} />

      {/* ── Métricas ── */}
      {metrics && (
        <div style={{
          position: 'absolute', bottom: 40, left: sidebarOpen ? 'calc(340px + 16px)' : 16,
          background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(0,255,255,0.3)',
          borderRadius: 8, padding: '8px 16px', color: '#00FFFF', fontSize: 13,
          backdropFilter: 'blur(8px)', transition: 'left 0.3s',
        }}>
          📐 Área: <strong>{metrics.areaKm2} km²</strong>
        </div>
      )}

      {/* ── Painel Lateral ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: sidebarOpen ? 340 : 0,
        background: 'rgba(8,8,18,0.95)',
        borderRight: '1px solid rgba(0,255,255,0.15)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        transition: 'width 0.3s ease',
        zIndex: 5,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '72px 16px 16px', overflowY: 'auto', flex: 1, minWidth: 340 }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {(['style', 'data'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6,
                  border: '1px solid rgba(0,255,255,0.3)',
                  background: activeTab === tab ? 'rgba(0,255,255,0.2)' : 'transparent',
                  color: activeTab === tab ? '#00FFFF' : '#888',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                {tab === 'style' ? '🎨 Estilo' : '📝 Dados'}
              </button>
            ))}
          </div>

          {/* ── Aba Estilo ── */}
          {activeTab === 'style' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              <SectionTitle>Cores Neon</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {NEON_COLORS.map(c => (
                  <button
                    key={c.hex}
                    onClick={() => setStyle(s => ({ ...s, cor: c.hex }))}
                    title={c.name}
                    style={{
                      width: 36, height: 36, borderRadius: 6,
                      background: c.hex,
                      border: style.cor === c.hex ? `3px solid white` : '2px solid transparent',
                      cursor: 'pointer',
                      boxShadow: `0 0 8px ${c.hex}`,
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={style.cor}
                  onChange={e => setStyle(s => ({ ...s, cor: e.target.value }))}
                  style={{ width: 36, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer', padding: 2, background: 'transparent' }}
                  title="Cor personalizada"
                />
              </div>

              <SectionTitle>Espessura da Linha</SectionTitle>
              <SliderRow
                value={style.espessura} min={1} max={12} step={1}
                onChange={v => setStyle(s => ({ ...s, espessura: v }))}
                label={`${style.espessura}px`}
                color={style.cor}
              />

              <SectionTitle>Opacidade do Preenchimento</SectionTitle>
              <SliderRow
                value={style.opacidade} min={0} max={0.8} step={0.05}
                onChange={v => setStyle(s => ({ ...s, opacidade: v }))}
                label={`${Math.round(style.opacidade * 100)}%`}
                color={style.cor}
              />

              <SectionTitle>Efeitos</SectionTitle>
              <ToggleRow
                label="✨ Efeito Brilho (Glow)"
                value={style.brilho}
                onChange={v => setStyle(s => ({ ...s, brilho: v }))}
                color={style.cor}
              />
              <ToggleRow
                label="💫 Animação de Pulsação"
                value={style.animacao}
                onChange={v => setStyle(s => ({ ...s, animacao: v }))}
                color={style.cor}
              />

              {currentGeometry && (
                <>
                  <SectionTitle>Exportar</SectionTitle>
                  <button
                    onClick={() => handleExport('geojson')}
                    style={btnStyle('#1a3a2a', '#00FF41')}
                  >
                    ⬇ Exportar GeoJSON
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Aba Dados ── */}
          {activeTab === 'data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionTitle>Informações da Área</SectionTitle>
              {([
                ['nome', 'Nome da Área *', 'text'],
                ['municipio', 'Município', 'text'],
                ['estado', 'Estado', 'text'],
                ['regiao', 'Região', 'text'],
                ['populacao', 'População estimada', 'number'],
              ] as [keyof AreaData, string, string][]).map(([field, label, type]) => (
                <div key={field}>
                  <label style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4 }}>{label}</label>
                  <input
                    type={type}
                    value={areaData[field]}
                    onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#e0e0e0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}

              {(['descricao', 'observacoes'] as const).map(field => (
                <div key={field}>
                  <label style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4 }}>
                    {field === 'descricao' ? 'Descrição' : 'Observações'}
                  </label>
                  <textarea
                    value={areaData[field]}
                    onChange={e => setAreaData(d => ({ ...d, [field]: e.target.value }))}
                    rows={3}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#e0e0e0', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}

              <button onClick={handleSave} disabled={loading} style={btnStyle('#003355', '#00FFFF', loading)}>
                {loading ? '⟳ Salvando...' : '💾 Salvar no Banco de Dados'}
              </button>

              {saveMsg && (
                <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(0,255,255,0.1)', color: '#00FFFF', fontSize: 13 }}>
                  {saveMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#888', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>
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
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: color }}
      />
      <span style={{ color: '#00FFFF', fontSize: 12, minWidth: 36, textAlign: 'right' }}>{label}</span>
    </div>
  );
}

function ToggleRow({ label, value, onChange, color }: {
  label: string; value: boolean; onChange: (v: boolean) => void; color: string;
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '8px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}
    >
      <span style={{ color: '#ccc', fontSize: 13 }}>{label}</span>
      <div style={{
        width: 40, height: 22, borderRadius: 11,
        background: value ? color : '#333',
        position: 'relative', transition: 'background 0.2s',
        boxShadow: value ? `0 0 8px ${color}` : 'none',
      }}>
        <div style={{
          position: 'absolute', top: 3, left: value ? 20 : 3, width: 16, height: 16,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        }} />
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string, disabled = false): React.CSSProperties {
  return {
    padding: '10px 16px', borderRadius: 8,
    background: disabled ? 'rgba(255,255,255,0.05)' : bg,
    border: `1px solid ${color}40`,
    color: disabled ? '#555' : color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 14, fontWeight: 600, width: '100%',
    boxShadow: disabled ? 'none' : `0 0 12px ${color}30`,
    transition: 'all 0.2s',
  };
}
