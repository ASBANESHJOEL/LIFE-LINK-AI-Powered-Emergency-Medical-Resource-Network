'use client';

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RouteGeometry } from '../../types/dispatch';

interface RouteTrackingMapProps {
  geometry: RouteGeometry;
  donorLocation?: { latitude: number; longitude: number };
  hospitalLocation?: { latitude: number; longitude: number };
  routingProvider?: string;
  fallback?: boolean;
}

export function RouteTrackingMap({
  geometry,
  donorLocation,
  hospitalLocation,
  routingProvider,
  fallback,
}: RouteTrackingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Use free public CartoDB Dark Matter raster tiles for high-contrast medical dark aesthetic
    const style: maplibregl.StyleSpecification = {
      version: 8,
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'carto-dark-layer',
          type: 'raster',
          source: 'carto-dark',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };

    // Calculate center
    const coords = geometry?.coordinates || [];
    const centerCoord: [number, number] =
      coords.length > 0
        ? coords[Math.floor(coords.length / 2)]
        : [hospitalLocation?.longitude || 77.5946, hospitalLocation?.latitude || 12.9716];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: centerCoord,
      zoom: 12,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      // Add GeoJSON Route Source & Layer
      if (geometry && geometry.coordinates && geometry.coordinates.length > 0) {
        map.addSource('route-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: geometry,
          },
        });

        // Route line glow
        map.addLayer({
          id: 'route-line-glow',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#38bdf8',
            'line-width': 8,
            'line-opacity': 0.4,
          },
        });

        // Main Route line
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#0284c7',
            'line-width': 4,
          },
        });

        // Fit bounds to route
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((coord) => bounds.extend(coord as [number, number]));
        map.fitBounds(bounds, { padding: 50, duration: 1000 });
      }

      // Add Donor Marker (Origin)
      if (donorLocation) {
        const donorEl = document.createElement('div');
        donorEl.className = 'custom-donor-marker';
        donorEl.innerHTML = `
          <div style="width: 28px; height: 28px; background: #0284c7; border: 3px solid #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px rgba(2,132,199,0.8);">
            <div style="width: 8px; height: 8px; background: #ffffff; border-radius: 50%;"></div>
          </div>
        `;

        new maplibregl.Marker({ element: donorEl })
          .setLngLat([donorLocation.longitude, donorLocation.latitude])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML('<b style="color:#000">Volunteer Donor Location</b>'))
          .addTo(map);
      }

      // Add Hospital Marker (Destination)
      if (hospitalLocation) {
        const hospEl = document.createElement('div');
        hospEl.className = 'custom-hospital-marker';
        hospEl.innerHTML = `
          <div style="width: 32px; height: 32px; background: #dc2626; border: 3px solid #ffffff; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(220,38,38,0.9); font-weight: 900; color: #fff; font-size: 16px;">
            +
          </div>
        `;

        new maplibregl.Marker({ element: hospEl })
          .setLngLat([hospitalLocation.longitude, hospitalLocation.latitude])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML('<b style="color:#000">Trauma Hospital Destination</b>'))
          .addTo(map);
      }
    });

    return () => {
      map.remove();
    };
  }, [geometry, donorLocation, hospitalLocation]);

  return (
    <div className="relative w-full h-[450px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Provider & Telemetry Badge Overlay */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-slate-900/90 border border-slate-800 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="font-semibold text-slate-200">
          Routing: {routingProvider || 'OSRM Live Highway Engine'}
        </span>
        {fallback && (
          <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-bold border border-amber-800">
            FALLBACK ROUTE
          </span>
        )}
      </div>
    </div>
  );
}
