import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
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
}

const createVesselIcon = (vessel: Vessel) => {
    const isTug = vessel.vesselType?.toLowerCase().includes('tug');
    const color = isTug ? '#f97316' : '#3b82f6'; // Orange for tugs, Blue for others
    const rotation = vessel.heading || vessel.cog || 0;

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" style="transform: rotate(${rotation}deg); width: 100%; height: 100%;">
            <path d="M12 2L4.5 20.29C4.21 21.01 4.93 21.75 5.66 21.5L12 19.25L18.34 21.5C19.07 21.75 19.79 21.01 19.5 20.29L12 2Z" />
        </svg>
    `;

    return L.divIcon({
        html: svg,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });
};

export function LiveMap() {
    const [vessels, setVessels] = useState<Vessel[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await fetchLiveMap();
                setVessels(data);
            } catch (error) {
                console.error('Failed to load live map data:', error);
            } finally {
                setLoading(false);
            }
        };

        loadData();
        const interval = setInterval(loadData, 10000); // Refresh every 10 seconds

        return () => clearInterval(interval);
    }, []);

    if (loading && vessels.length === 0) {
        return <div className="h-[600px] flex items-center justify-center bg-slate-900 text-slate-400">Loading map...</div>;
    }

    // Default center: Newcastle Harbour
    const center: [number, number] = [-32.916, 151.796];

    return (
        <div className="h-[600px] w-full rounded-lg overflow-hidden border border-slate-800 shadow-lg relative z-0">
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {vessels.map((vessel) => (
                    <div key={vessel.id}>
                        {vessel.trail && vessel.trail.length > 1 && (
                            <Polyline
                                positions={vessel.trail.map(p => [p.latitude, p.longitude])}
                                pathOptions={{
                                    color: vessel.vesselType?.toLowerCase().includes('tug') ? '#f97316' : '#3b82f6',
                                    weight: 2,
                                    opacity: 0.5,
                                    dashArray: '5, 5'
                                }}
                            />
                        )}
                        {vessel.latitude && vessel.longitude && (
                            <Marker
                                position={[vessel.latitude, vessel.longitude]}
                                icon={createVesselIcon(vessel)}
                            >
                                <Popup>
                                    <div className="text-slate-900">
                                        <strong className="block text-lg">{vessel.name}</strong>
                                        <span className="text-sm text-slate-600">{vessel.vesselType}</span>
                                        <div className="mt-1 text-xs text-slate-500">
                                            Heading: {vessel.heading || vessel.cog || 'N/A'}°
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                            Last seen: {new Date(vessel.lastSeenAt).toLocaleTimeString()}
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        )}
                    </div>
                ))}
            </MapContainer>
        </div>
    );
}
