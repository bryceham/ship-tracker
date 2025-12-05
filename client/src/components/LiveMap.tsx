import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { fetchLiveMap } from '../lib/api';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

interface Vessel {
    id: number;
    name: string;
    vesselType: string;
    latitude: number;
    longitude: number;
    heading?: number;
    cog?: number;
    lastSeenAt: string;
    isInsideHarbour: boolean;
    trail?: { latitude: number; longitude: number }[];
    length?: number;
    width?: number;
    speed?: number; // Speed in knots
}

const getVesselOpacity = (lastSeenAt: string) => {
    const now = new Date();
    const lastSeen = new Date(lastSeenAt);
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;

    if (diffMinutes < 10) return 1.0;
    if (diffMinutes < 30) return 0.7;
    return 0.4;
};

const createVesselIcon = (vessel: Vessel, zoom: number) => {
    const isTug = vessel.vesselType?.toLowerCase().includes('tug') || vessel.vesselType?.toLowerCase().includes('52');
    const color = isTug ? '#f97316' : '#3b82f6'; // Orange for tugs, Blue for others
    const rotation = vessel.heading || vessel.cog || 0;
    const opacity = getVesselOpacity(vessel.lastSeenAt);

    // Dynamic scaling based on zoom
    // Base scale at zoom 13 is 0.08 (approx 1px = 12m)
    // As zoom decreases, scale should decrease to keep "real world" size
    // As zoom increases, scale should increase
    const zoomDiff = zoom - 13;
    const scaleFactor = Math.pow(2, zoomDiff);
    const currentScale = 0.08 * scaleFactor;

    const length = vessel.length || 24;
    const width = vessel.width || 8;

    // Calculate dimensions in pixels
    // We enforce a minimum size so they don't disappear completely when zoomed out
    const minLength = 8;
    const minWidth = 4;

    const pixelLength = Math.max(minLength, length * currentScale);
    const pixelWidth = Math.max(minWidth, width * currentScale);

    // Make the container square based on the largest dimension to allow safe rotation
    const maxSize = Math.max(pixelLength, pixelWidth) * 1.5;

    let path = '';
    if (isTug) {
        // Boxy shape for tugs
        path = `M0,0 L${pixelWidth},0 L${pixelWidth},${pixelLength} L0,${pixelLength} Z`;
    } else {
        // Pointed shape for ships
        const bowLength = pixelLength * 0.25;
        path = `M0,${pixelLength} L${pixelWidth},${pixelLength} L${pixelWidth},${bowLength} L${pixelWidth / 2},0 L0,${bowLength} Z`;
    }

    const svg = `
        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixelWidth} ${pixelLength}"
                style="width: ${pixelWidth}px; height: ${pixelLength}px; transform: rotate(${rotation}deg); opacity: ${opacity};"
                fill="${color}" stroke="white" stroke-width="1">
                <path d="${path}" />
            </svg>
        </div>
    `;

    return L.divIcon({
        html: svg,
        className: '',
        iconSize: [maxSize, maxSize],
        iconAnchor: [maxSize / 2, maxSize / 2],
    });
};

// Component to handle map interactions/updates
function MapController({ selectedVessel, onZoomChange }: { selectedVessel: Vessel | null, onZoomChange: (zoom: number) => void }) {
    const map = useMap();

    useMapEvents({
        zoomend: () => {
            onZoomChange(map.getZoom());
        }
    });

    useEffect(() => {
        if (selectedVessel) {
            map.flyTo([selectedVessel.latitude, selectedVessel.longitude], 14);
        }
    }, [selectedVessel, map]);

    return null;
}

// Distance calculation (Haversine approximation for short distances)
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function getTugStatus(tug: Vessel, allVessels: Vessel[]) {
    // If speed is missing, assume stationary if no recent updates
    const speed = tug.speed || 0;

    if (speed < 0.5) {
        if (tug.isInsideHarbour) return { status: 'At Berth', color: 'text-slate-400' };
        return { status: 'Stationary (Offshore)', color: 'text-slate-400' };
    }

    // Check for escorting
    // Find closest non-tug vessel THAT IS ALSO MOVING
    // We filter out stationary ships to avoid false positives when moving past a berth
    const ships = allVessels.filter(v =>
        !v.vesselType.toLowerCase().includes('tug') &&
        !v.vesselType.toLowerCase().includes('52') &&
        v.id !== tug.id &&
        (v.speed || 0) > 0.5
    );

    let closestShip: Vessel | null = null;
    let minDist = Infinity;

    for (const ship of ships) {
        const dist = getDistance(tug.latitude, tug.longitude, ship.latitude, ship.longitude);
        if (dist < minDist) {
            minDist = dist;
            closestShip = ship;
        }
    }

    // If close to a ship (< 300m) and moving, assume escorting
    if (closestShip && minDist < 300) {
        return { status: `Escorting ${closestShip.name}`, color: 'text-green-400' };
    }

    return { status: 'Moving', color: 'text-blue-400' };
}

export function LiveMap() {
    const [vessels, setVessels] = useState<Vessel[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
    const [currentZoom, setCurrentZoom] = useState(13);

    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await fetchLiveMap() as Vessel[];
                setVessels(data);

                // Update selected vessel data if it exists
                if (selectedVessel) {
                    const updated = data.find(v => v.id === selectedVessel.id);
                    if (updated) setSelectedVessel(updated);
                }
            } catch (error) {
                console.error('Failed to load live map data:', error);
            } finally {
                setLoading(false);
            }
        };

        loadData();
        const interval = setInterval(loadData, 5000); // Refresh every 5 seconds

        return () => clearInterval(interval);
    }, [selectedVessel?.id]);

    if (loading && vessels.length === 0) {
        return <div className="h-[600px] flex items-center justify-center bg-slate-900 text-slate-400">Loading map...</div>;
    }

    // Default center: Newcastle Harbour
    const center: [number, number] = [-32.916, 151.796];

    // Filter Tugs
    const tugs = vessels.filter(v => v.vesselType?.toLowerCase().includes('tug') || v.vesselType?.toLowerCase().includes('52'));

    return (
        <div className="flex flex-col gap-6">
            <div className="h-[600px] w-full rounded-lg overflow-hidden border border-slate-800 shadow-lg relative z-0">
                <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%', background: '#1e293b' }}>
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />

                    <MapController selectedVessel={selectedVessel} onZoomChange={setCurrentZoom} />

                    {vessels.map((vessel) => (
                        <div key={vessel.id}>
                            {vessel.trail && vessel.trail.length > 1 && (
                                <Polyline
                                    positions={vessel.trail.map(p => [p.latitude, p.longitude])}
                                    pathOptions={{
                                        color: vessel.vesselType?.toLowerCase().includes('52') ? '#f97316' : '#3b82f6',
                                        weight: selectedVessel?.id === vessel.id ? 3 : 1,
                                        opacity: selectedVessel?.id === vessel.id ? 0.8 : 0.3,
                                        dashArray: '5, 5'
                                    }}
                                />
                            )}
                            {vessel.latitude && vessel.longitude && (
                                <Marker
                                    position={[vessel.latitude, vessel.longitude]}
                                    icon={createVesselIcon(vessel, currentZoom)}
                                    eventHandlers={{
                                        click: () => setSelectedVessel(vessel),
                                    }}
                                />
                            )}
                        </div>
                    ))}
                </MapContainer>

                {/* Vessel Details Bottom Sheet */}
                {selectedVessel && (
                    <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur border border-slate-700 p-4 rounded-lg shadow-xl z-[1000] animate-in slide-in-from-bottom-10 fade-in duration-300">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    {selectedVessel.name}
                                    <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                                        {selectedVessel.vesselType}
                                    </span>
                                </h3>
                                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <span className="block text-slate-500 text-xs">Dimensions</span>
                                        <span className="text-slate-300">{selectedVessel.length || '?'}m x {selectedVessel.width || '?'}m</span>
                                    </div>
                                    <div>
                                        <span className="block text-slate-500 text-xs">Heading</span>
                                        <span className="text-slate-300">{selectedVessel.heading || selectedVessel.cog || 'N/A'}°</span>
                                    </div>
                                    <div>
                                        <span className="block text-slate-500 text-xs">Speed</span>
                                        <span className="text-slate-300">{selectedVessel.speed ? `${selectedVessel.speed.toFixed(1)} kn` : 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="block text-slate-500 text-xs">Status</span>
                                        <span className={selectedVessel.isInsideHarbour ? "text-green-400" : "text-blue-400"}>
                                            {selectedVessel.isInsideHarbour ? 'In Harbour' : 'Outside'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedVessel(null);
                                }}
                                className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Tug Status Section */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                    Tug Fleet Status
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {tugs.map(tug => {
                        const { status, color } = getTugStatus(tug, vessels);
                        return (
                            <div key={tug.id}
                                className="bg-slate-900 border border-slate-800 p-4 rounded-md hover:border-slate-700 transition-colors cursor-pointer"
                                onClick={() => setSelectedVessel(tug)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-semibold text-slate-200">{tug.name}</h3>
                                    <span className="text-xs text-slate-500">{new Date(tug.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <span className={`font-medium ${color}`}>
                                        {status}
                                    </span>
                                </div>
                                {tug.speed !== undefined && tug.speed > 0.1 && (
                                    <div className="mt-2 text-xs text-slate-500">
                                        Speed: {tug.speed.toFixed(1)} kn
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {tugs.length === 0 && (
                        <div className="col-span-full text-center text-slate-500 py-4">
                            No tugs currently active.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
