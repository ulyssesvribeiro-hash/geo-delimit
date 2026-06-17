import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as turf from '@turf/turf';

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

mapboxgl.accessToken = MAPBOX_TOKEN;
