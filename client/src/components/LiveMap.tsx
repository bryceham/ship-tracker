import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { fetchLiveMap, fetchLiveMapHistory } from '../lib/api';
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

interface Position {
    vesselId: number;
    latitude: number;
    longitude: number;
    heading: number;
    speed: number;
    timestamp: string;
}

interface HistoryData {
    positions: Position[];
    vessels: Record<number, {
        id: number;
        name: string;
        vesselType: string;
        length: number;
        width: number;
    }>;
}

const getVesselOpacity = (lastSeenAt: string) => {
    const now = new Date();
    const lastSeen = new Date(lastSeenAt);
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;

    if (diffMinutes < 10) return 1.0;
    if (diffMinutes < 30) return 0.7;
    return 0.4;
};

// Color mapping for vessel types
const getVesselColor = (type: string) => {
    const t = type?.toLowerCase() || '';

    // Tugs / Special Craft
    if (t.includes('tug') || t.includes('52') || t.includes('31') || t.includes('32')) return '#f97316'; // Orange

    // Cargo / Bulk Carriers
    if (t.includes('cargo') || t.includes('bulk') || (parseInt(t) >= 70 && parseInt(t) <= 79)) return '#22c55e'; // Green

    // Tankers
    if (t.includes('tanker') || (parseInt(t) >= 80 && parseInt(t) <= 89)) return '#ef4444'; // Red

    // Passenger
    if (t.includes('passenger') || (parseInt(t) >= 60 && parseInt(t) <= 69)) return '#eab308'; // Yellow

    // Fishing
    if (t.includes('fishing') || t.includes('30')) return '#a855f7'; // Purple

    // Pleasure / Yacht
    if (t.includes('pleasure') || t.includes('yacht') || t.includes('36') || t.includes('37')) return '#ec4899'; // Pink

    // Default / Other
    return '#94a3b8'; // Slate 400
};

const createVesselIcon = (vessel: Vessel, zoom: number) => {
    const isTug = vessel.vesselType?.toLowerCase().includes('tug') || vessel.vesselType?.toLowerCase().includes('52');
    const color = getVesselColor(vessel.vesselType);
    const rotation = vessel.heading || vessel.cog || 0;
    const opacity = getVesselOpacity(vessel.lastSeenAt);

    // Hybrid Sizing Strategy
    // Zoom < 14: Fixed size markers (easier to see/navigate)
    // Zoom >= 14: Real-world physical size (accurate for berthing)
    const ZOOM_THRESHOLD = 14;

    let pixelLength, pixelWidth, path;
    let containerSize;

    if (zoom < ZOOM_THRESHOLD) {
        // FIXED SIZE MODE
        const size = 12; // Base size in pixels
        pixelLength = size;
        pixelWidth = size * 0.7;

        // Simple directional arrow for everything when zoomed out
        path = `M0,${pixelLength} L${pixelWidth / 2},0 L${pixelWidth},${pixelLength} L${pixelWidth / 2},${pixelLength * 0.75} Z`;

        containerSize = size * 2; // Enough room for rotation
    } else {
        // REAL WORLD SIZE MODE
        // Calculate meters per pixel at this latitude (approx -33 for Newcastle)
        // Formula: 156543.03392 * cos(lat * PI / 180) / 2^zoom
        // cos(-33) approx 0.838
        const metersPerPixel = 131183 / Math.pow(2, zoom);

        const realLength = vessel.length || 24;
        const realWidth = vessel.width || 8;

        pixelLength = realLength / metersPerPixel;
        pixelWidth = realWidth / metersPerPixel;

        // Ensure it's at least visible if data is missing
        pixelLength = Math.max(10, pixelLength);
        pixelWidth = Math.max(4, pixelWidth);

        if (isTug) {
            // Boxy shape for tugs
            path = `M0,0 L${pixelWidth},0 L${pixelWidth},${pixelLength} L0,${pixelLength} Z`;
        } else {
            // Detailed ship shape
            const bowLength = pixelLength * 0.2;
            path = `M0,${pixelLength} L${pixelWidth},${pixelLength} L${pixelWidth},${bowLength} L${pixelWidth / 2},0 L0,${bowLength} Z`;
        }

        containerSize = Math.max(pixelLength, pixelWidth) * 1.5;
    }

    const svg = `
        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixelWidth} ${pixelLength}"
                style="width: ${pixelWidth}px; height: ${pixelLength}px; transform: rotate(${rotation}deg); opacity: ${opacity};"
                fill="${color}" stroke="white" stroke-width="${zoom < ZOOM_THRESHOLD ? 1.5 : 1}">
                <path d="${path}" />
            </svg>
        </div>
    `;

    return L.divIcon({
        html: svg,
        className: '',
        iconSize: [containerSize, containerSize],
        iconAnchor: [containerSize / 2, containerSize / 2],
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

    // History Mode State
    const [historyMode, setHistoryMode] = useState(false);
    const [sliderValue, setSliderValue] = useState(Date.now());
    const [historyData, setHistoryData] = useState<HistoryData | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [displayedVessels, setDisplayedVessels] = useState<Vessel[]>([]);

    useEffect(() => {
        const loadData = async () => {
            if (historyMode) return; // Don't poll live data in history mode

            try {
                const data = await fetchLiveMap() as Vessel[];
                setVessels(data);
                setDisplayedVessels(data);
                setSliderValue(Date.now());

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
    }, [selectedVessel?.id, historyMode]);

    const handleTimeChange = async (timestamp: number) => {
        setSliderValue(timestamp);
        const isLive = timestamp >= Date.now() - 60000; // Within 1 minute of now

        if (isLive) {
            setHistoryMode(false);
            setDisplayedVessels(vessels);
            return;
        }

        setHistoryMode(true);

        if (!historyData && !isLoadingHistory) {
            setIsLoadingHistory(true);
            try {
                const data = await fetchLiveMapHistory();
                // Pre-sort positions by timestamp if not already
                data.positions.sort((a: Position, b: Position) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                setHistoryData(data);
                updateDisplayedVesselsFromHistory(timestamp, data);
            } catch (e) {
                console.error("Failed to load history", e);
                setHistoryMode(false); // Fallback
            } finally {
                setIsLoadingHistory(false);
            }
        } else if (historyData) {
            updateDisplayedVesselsFromHistory(timestamp, historyData);
        }
    };

    const updateDisplayedVesselsFromHistory = (timestamp: number, data: HistoryData) => {
        // For each vessel, find the latest position <= timestamp
        const vesselsAtTime: Vessel[] = [];

        // Iterate backwards from the end or use binary search. 
        // Since we have all positions, let's just group them by vessel first? 
        // Or just iterate all positions? iterating 70k items might be slow if done on every slider move.
        // Optimization: The positions are sorted by timestamp.
        // We can find the index where timestamp > target.

        // Let's do a simple approach first: Group positions by vesselId once when loading history.
        // But for now, let's just iterate.

        // Better: Pre-group positions by vesselId in state when data is loaded.
        // But to keep it simple for this step, let's just do a naive filter.
        // Actually, naive filter on 70k items is bad for 60fps slider.
        // Let's assume we optimize later or rely on the fact that we only have a few vessels.

        // Let's try to be slightly smart.
        // We need the *latest* position for each vessel that is <= timestamp.

        const relevantPositions = new Map<number, Position>();

        // Since positions are sorted by time ASC, we can iterate and update the map
        // until we hit a position > timestamp.
        for (const pos of data.positions) {
            const t = new Date(pos.timestamp).getTime();
            if (t > timestamp) break;
            relevantPositions.set(pos.vesselId, pos);
        }

        relevantPositions.forEach((pos, vesselId) => {
            // Check if position is not too old (e.g. 2 hours)
            const t = new Date(pos.timestamp).getTime();
            if (timestamp - t > 2 * 60 * 60 * 1000) return;

            const meta = data.vessels[vesselId];
            if (!meta) return;

            vesselsAtTime.push({
                id: vesselId,
                name: meta.name,
                vesselType: meta.vesselType,
                latitude: pos.latitude,
                longitude: pos.longitude,
                heading: pos.heading,
                speed: pos.speed,
                lastSeenAt: pos.timestamp,
                isInsideHarbour: false, // We'd need to calculate this or store it
                length: meta.length,
                width: meta.width,
                trail: [] // No trails in history mode for now
            });
        });

        setDisplayedVessels(vesselsAtTime);
    };

    if (loading && vessels.length === 0) {
        return <div className="h-[600px] flex items-center justify-center bg-slate-900 text-slate-400">Loading map...</div>;
    }

    // Default center: Newcastle Harbour
    const center: [number, number] = [-32.916, 151.796];

    // Filter Tugs
    const tugs = displayedVessels.filter(v => v.vesselType?.toLowerCase().includes('tug') || v.vesselType?.toLowerCase().includes('52'));

    return (
        <div className="flex flex-col gap-6">
            <div className="h-[600px] w-full rounded-lg overflow-hidden border border-slate-800 shadow-lg relative z-0 flex flex-col">
                <div className="flex-1 relative">
                    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%', background: '#1e293b' }}>
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        />

                        <MapController selectedVessel={selectedVessel} onZoomChange={setCurrentZoom} />

                        {displayedVessels.map((vessel) => (
                            <div key={vessel.id}>
                                {vessel.trail && vessel.trail.length > 1 && (
                                    <Polyline
                                        positions={vessel.trail.map(p => [p.latitude, p.longitude])}
                                        pathOptions={{
                                            color: getVesselColor(vessel.vesselType),
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

                    {/* Legend Overlay */}
                    <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur border border-slate-700 p-3 rounded-lg shadow-xl z-[1000] text-xs">
                        <h4 className="font-bold text-slate-300 mb-2">Vessel Types</h4>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                                <span className="text-slate-400">Cargo</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                                <span className="text-slate-400">Tanker</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                                <span className="text-slate-400">Tug / Special</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                                <span className="text-slate-400">Passenger</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                                <span className="text-slate-400">Fishing</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-pink-500"></span>
                                <span className="text-slate-400">Pleasure</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-slate-400"></span>
                                <span className="text-slate-400">Other</span>
                            </div>
                        </div>
                    </div>

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
                                    <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
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
                                            <span className="block text-slate-500 text-xs">Last Seen</span>
                                            <span className="text-slate-300">{new Date(selectedVessel.lastSeenAt).toLocaleTimeString()}</span>
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

                {/* Time Slider Control */}
                <div className="bg-slate-900 border-t border-slate-800 p-4 flex items-center gap-4">
                    <button
                        className={`p-2 rounded-full ${!historyMode ? 'bg-green-500/20 text-green-400' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                        onClick={() => handleTimeChange(Date.now())}
                        title="Go Live"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                    </button>

                    <div className="flex-1 flex flex-col gap-1">
                        <div className="flex justify-between text-xs text-slate-400 font-mono">
                            <span>-24h</span>
                            <span className={historyMode ? 'text-blue-400 font-bold' : 'text-green-400 font-bold'}>
                                {historyMode ? new Date(sliderValue).toLocaleString() : 'LIVE'}
                            </span>
                            <span>Now</span>
                        </div>
                        <input
                            type="range"
                            min={Date.now() - 24 * 60 * 60 * 1000}
                            max={Date.now()}
                            step={60 * 1000} // 1 minute steps
                            value={sliderValue}
                            onChange={(e) => handleTimeChange(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Tug Status Section */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                    Tug Fleet Status
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {tugs.map(tug => {
                        const { status, color } = getTugStatus(tug, displayedVessels);
                        return (
                            <div key={tug.id}
                                className="bg-slate-900 border border-slate-800 p-4 rounded-md hover:border-slate-700 transition-colors cursor-pointer"
                                onClick={() => setSelectedVessel(tug)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-semibold text-slate-200">{tug.name}</h3>
                                    <span className="text-xs text-slate-500">Last seen: {new Date(tug.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
