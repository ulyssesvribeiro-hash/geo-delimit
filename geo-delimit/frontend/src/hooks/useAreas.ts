import { useState, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface Area {
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
  centroide?: GeoJSON.Point;
  geometry?: GeoJSON.Geometry;
  data_criacao: string;
}

export interface CreateAreaPayload {
  nome: string;
  tipo?: string;
  municipio?: string;
  estado?: string;
  regiao?: string;
  populacao?: number | null;
  descricao?: string;
  observacoes?: string;
  cor_contorno: string;
  espessura: number;
  opacidade: number;
  brilho_ativo: boolean;
  animacao_ativa: boolean;
  geometry: GeoJSON.Geometry;
  osm_id?: number;
  fonte_dados?: string;
}

export function useAreas() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAreas = useCallback(async (params?: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      const res = await fetch(`${API_BASE}/areas${qs}`);
      if (!res.ok) throw new Error('Erro ao buscar áreas');
      const data = await res.json();
      setAreas(data.data ?? []);
      return data;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAreaById = useCallback(async (id: string): Promise<Area | null> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/areas/${id}`);
      if (!res.ok) throw new Error('Área não encontrada');
      return await res.json();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createArea = useCallback(async (payload: CreateAreaPayload): Promise<Area | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/areas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao criar área');
      }
      const created = await res.json();
      setAreas(prev => [created, ...prev]);
      return created;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateArea = useCallback(async (id: string, payload: Partial<CreateAreaPayload>): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/areas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Erro ao atualizar');
      const updated = await res.json();
      setAreas(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteArea = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/areas/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao remover');
      setAreas(prev => prev.filter(a => a.id !== id));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const exportArea = useCallback((id: string, fmt: 'geojson' | 'kml' | 'csv') => {
    window.open(`${API_BASE}/export/${id}?fmt=${fmt}`, '_blank');
  }, []);

  return {
    areas, loading, error,
    fetchAreas, fetchAreaById,
    createArea, updateArea, deleteArea,
    exportArea,
  };
}
