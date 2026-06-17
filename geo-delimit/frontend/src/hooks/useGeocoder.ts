import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface SearchResult {
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

export interface PolygonResult {
  geometry: GeoJSON.Geometry;
  source: string;
}

export function useGeocoder() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingPolygon, setLoadingPolygon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced autocomplete
  useEffect(() => {
    setError(null);
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoadingSearch(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/geocode/search?q=${encodeURIComponent(query)}&limit=6`
        );
        if (!res.ok) throw new Error('Erro na busca');
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(String(e));
        setSuggestions([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPolygon = useCallback(async (result: SearchResult): Promise<PolygonResult | null> => {
    setLoadingPolygon(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/geocode/polygon?osm_type=${result.osm_type}&osm_id=${result.osm_id}`
      );
      if (!res.ok) throw new Error('Polígono não encontrado');
      return await res.json();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoadingPolygon(false);
    }
  }, []);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  return {
    query, setQuery,
    suggestions, clearSuggestions,
    fetchPolygon,
    loadingSearch, loadingPolygon,
    error,
  };
}
