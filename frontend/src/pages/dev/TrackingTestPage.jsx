import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../context/AuthContext';

const INITIAL_DISPATCH_ID = '';

function lineStringBounds(coordinates = []) {
  if (!coordinates.length) return null;
  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));
  return bounds;
}

export function TrackingTestPage() {
  const { session, userProfile } = useAuth();
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const donorMarkerRef = useRef(null);
  const hospitalMarkerRef = useRef(null);

  const [dispatchId, setDispatchId] = useState(INITIAL_DISPATCH_ID);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [78.9629, 20.5937],
      zoom: 4
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;

    const renderRoute = () => {
      const coordinates = route.geometry?.coordinates || [];
      if (!coordinates.length) return;

      if (map.getSource('lifelink-route')) {
        map.getSource('lifelink-route').setData({
          type: 'Feature',
          properties: {},
          geometry: route.geometry
        });
      } else {
        map.addSource('lifelink-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: route.geometry
          }
        });
        map.addLayer({
          id: 'lifelink-route-line',
          type: 'line',
          source: 'lifelink-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 5, 'line-opacity': 0.9 }
        });
      }

      const origin = [route.origin.longitude, route.origin.latitude];
      const destination = [route.destination.longitude, route.destination.latitude];

      if (donorMarkerRef.current) donorMarkerRef.current.remove();
      if (hospitalMarkerRef.current) hospitalMarkerRef.current.remove();

      donorMarkerRef.current = new maplibregl.Marker()
        .setLngLat(origin)
        .setPopup(new maplibregl.Popup().setText('Donor'))
        .addTo(map);

      hospitalMarkerRef.current = new maplibregl.Marker({ color: '#2563eb' })
        .setLngLat(destination)
        .setPopup(new maplibregl.Popup().setText('Hospital'))
        .addTo(map);

      const bounds = lineStringBounds(coordinates);
      if (bounds) map.fitBounds(bounds, { padding: 80, duration: 800 });
    };

    if (map.isStyleLoaded()) renderRoute();
    else map.once('load', renderRoute);
  }, [route]);

  async function loadRoute() {
    if (!dispatchId.trim()) {
      setError('Enter a donor dispatch UUID first.');
      return;
    }
    if (!session?.access_token) {
      setError('Sign in with a provisioned LIFE-LINK account first.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/donor-dispatches/${encodeURIComponent(dispatchId.trim())}/route`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }

      setRoute(payload);
    } catch (err) {
      setRoute(null);
      setError(err.message || 'Route request failed.');
    } finally {
      setLoading(false);
    }
  }

  async function simulateLocation() {
    if (!route || !session?.access_token) return;

    setSimulating(true);
    setError('');

    try {
      const from = route.origin;
      const to = route.destination;
      const latitude = Number((from.latitude + (to.latitude - from.latitude) * 0.2).toFixed(6));
      const longitude = Number((from.longitude + (to.longitude - from.longitude) * 0.2).toFixed(6));

      const response = await fetch(
        `/api/donor-dispatches/${encodeURIComponent(dispatchId.trim())}/location`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ latitude, longitude })
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }

      await loadRoute();
    } catch (err) {
      setError(err.message || 'GPS simulation failed.');
    } finally {
      setSimulating(false);
    }
  }

  const status = route?.status || '—';

  return (
    <div className="tracking-test-page">
      <div className="tracking-test-header">
        <div>
          <span className="role-badge badge-ADMIN">DEV / TEST ONLY</span>
          <h1>Donor Route Testing Console</h1>
          <p>MapLibre + OSRM integration harness for LIFE-LINK tracking.</p>
        </div>
        <div className="tracking-test-session">
          <strong>{userProfile?.email || 'Not authenticated'}</strong>
          <span>{userProfile?.role || '—'}</span>
        </div>
      </div>

      <div className="tracking-test-controls glass-panel">
        <label className="form-label" htmlFor="dispatch-id">Donor Dispatch UUID</label>
        <div className="tracking-test-input-row">
          <input
            id="dispatch-id"
            className="form-input"
            value={dispatchId}
            onChange={(event) => setDispatchId(event.target.value)}
            placeholder="Paste an ACCEPTED / EN_ROUTE dispatch UUID"
          />
          <button className="btn btn-primary" onClick={loadRoute} disabled={loading}>
            {loading ? 'Loading…' : 'Load Route'}
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <div className="tracking-test-grid">
        <section className="glass-panel tracking-map-card">
          <div className="tracking-map" ref={mapContainer} />
        </section>

        <aside className="glass-panel tracking-metrics">
          <div className="tracking-status">
            <span>Status</span>
            <strong>{status}</strong>
          </div>

          <div className="tracking-metric">
            <span>Distance</span>
            <strong>{route ? `${route.distanceKm} km` : '—'}</strong>
          </div>
          <div className="tracking-metric">
            <span>ETA</span>
            <strong>{route ? `${route.etaMinutes} min` : '—'}</strong>
          </div>
          <div className="tracking-metric">
            <span>Duration</span>
            <strong>{route ? `${Math.round(route.durationSeconds / 60)} min` : '—'}</strong>
          </div>
          <div className="tracking-metric">
            <span>Provider</span>
            <strong>{route?.routingProvider || '—'}</strong>
          </div>

          <div className="tracking-coordinates">
            <span>Donor</span>
            <code>{route ? `${route.origin.latitude}, ${route.origin.longitude}` : '—'}</code>
            <span>Hospital</span>
            <code>{route ? `${route.destination.latitude}, ${route.destination.longitude}` : '—'}</code>
          </div>

          <button
            className="btn btn-secondary tracking-full-button"
            onClick={simulateLocation}
            disabled={!route || simulating}
          >
            {simulating ? 'Simulating…' : 'Simulate GPS Movement'}
          </button>
        </aside>
      </div>

      <section className="glass-panel tracking-json">
        <h2>Raw Route Response</h2>
        <pre>{route ? JSON.stringify(route, null, 2) : 'Load a dispatch to inspect the OSRM response.'}</pre>
      </section>
    </div>
  );
}

export default TrackingTestPage;
