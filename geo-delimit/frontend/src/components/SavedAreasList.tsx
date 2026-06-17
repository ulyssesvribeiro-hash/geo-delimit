import React, { useEffect, useState } from 'react';
import { useAreas, Area } from '../hooks/useAreas';

interface Props {
  onSelect: (area: Area) => void;
  activeId?: string;
}

const TIPO_ICONS: Record<string, string> = {
  cidade: '🏙', bairro: '🏘', distrito: '🗺', municipio: '🏛',
  estado: '🗾', regiao: '🌎', pais: '🌍', outro: '📍',
};

export default function SavedAreasList({ onSelect, activeId }: Props) {
  const { areas, loading, error, fetchAreas, deleteArea, exportArea } = useAreas();
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { fetchAreas(); }, [fetchAreas]);

  const filtered = areas.filter(a =>
    a.nome.toLowerCase().includes(search.toLowerCase()) ||
    (a.municipio || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.estado || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    await deleteArea(id);
    setConfirmDelete(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Busca interna */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Filtrar áreas salvas..."
        style={{
          padding: '8px 12px', borderRadius: 6,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#e0e0e0', fontSize: 13, outline: 'none',
        }}
      />

      {/* Recarregar */}
      <button
        onClick={() => fetchAreas()}
        style={{
          padding: '7px', borderRadius: 6,
          background: 'rgba(0,255,255,0.07)',
          border: '1px solid rgba(0,255,255,0.25)',
          color: '#00FFFF', fontSize: 12, cursor: 'pointer',
        }}
      >
        {loading ? '⟳ Carregando...' : `↻ Recarregar (${areas.length})`}
      </button>

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: 12, padding: '6px 10px', background: 'rgba(255,0,0,0.08)', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
        {filtered.length === 0 && !loading && (
          <div style={{ color: '#555', fontSize: 13, textAlign: 'center', padding: 20 }}>
            {search ? 'Nenhuma área encontrada' : 'Nenhuma área salva ainda'}
          </div>
        )}

        {filtered.map(area => (
          <div
            key={area.id}
            style={{
              borderRadius: 8,
              border: activeId === area.id
                ? `1px solid ${area.cor_contorno}`
                : '1px solid rgba(255,255,255,0.08)',
              background: activeId === area.id
                ? `${area.cor_contorno}18`
                : 'rgba(255,255,255,0.03)',
              overflow: 'hidden',
              transition: 'all 0.2s',
            }}
          >
            {/* Header clicável */}
            <div
              onClick={() => onSelect(area)}
              style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {/* Cor indicator */}
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: area.cor_contorno,
                boxShadow: `0 0 6px ${area.cor_contorno}`,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {TIPO_ICONS[area.tipo] || '📍'} {area.nome}
                </div>
                <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                  {[area.municipio, area.estado].filter(Boolean).join(', ')}
                  {area.area_km2 && ` · ${area.area_km2.toFixed(2)} km²`}
                </div>
              </div>
            </div>

            {/* Ações */}
            <div style={{
              display: 'flex', gap: 4, padding: '0 8px 8px',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              paddingTop: 6,
            }}>
              {(['geojson', 'kml', 'csv'] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => exportArea(area.id, fmt)}
                  title={`Exportar ${fmt.toUpperCase()}`}
                  style={microBtn('#1a2a1a', '#00FF41')}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}

              <div style={{ flex: 1 }} />

              <button
                onClick={() => handleDelete(area.id)}
                style={microBtn(
                  confirmDelete === area.id ? '#3a0a0a' : '#1a0a0a',
                  confirmDelete === area.id ? '#FF4444' : '#FF666688'
                )}
                title={confirmDelete === area.id ? 'Confirmar exclusão' : 'Excluir área'}
              >
                {confirmDelete === area.id ? '⚠ Confirmar' : '🗑'}
              </button>

              {confirmDelete === area.id && (
                <button
                  onClick={() => setConfirmDelete(null)}
                  style={microBtn('#1a1a1a', '#888')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function microBtn(bg: string, color: string): React.CSSProperties {
  return {
    padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
    background: bg, border: `1px solid ${color}44`, color, cursor: 'pointer',
  };
}
