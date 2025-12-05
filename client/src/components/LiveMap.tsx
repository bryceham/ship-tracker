import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { fetchLiveMap } from '../lib/api';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon in React Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Vessel {
    id: number;
    name: string;
    vesselType: string;
    latitude: number;
    longitude: number;
    lastSeenAt: string;
    isInsideHarbour: boolean;
}

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
                    vessel.latitude && vessel.longitude && (
                        <Marker key={vessel.id} position={[vessel.latitude, vessel.longitude]}>
                            <Popup>
                                <div className="text-slate-900">
                                    <strong className="block text-lg">{vessel.name}</strong>
                                    <span className="text-sm text-slate-600">{vessel.vesselType}</span>
                                    <div className="mt-1 text-xs text-slate-500">
                                        Last seen: {new Date(vessel.lastSeenAt).toLocaleTimeString()}
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    )
                ))}
            </MapContainer>
        </div>
    );
}
