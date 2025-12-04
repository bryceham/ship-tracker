import { useQuery } from '@tanstack/react-query';
import { fetchTrips } from '../lib/api';
import { format } from 'date-fns';
import { ArrowLeft, Ship } from 'lucide-react';
import { Link } from 'wouter';

interface Trip {
    id: number;
    vesselName: string;
    status: string;
    scheduledArrival: string | null;
    actualArrivalHeads: string | null;
    actualBerthed: string | null;
    actualDepartedBerth: string | null;
    actualDepartureHeads: string | null;
}

export function Trips() {
    const { data: trips, isLoading } = useQuery<Trip[]>({
        queryKey: ['trips'],
        queryFn: fetchTrips,
        refetchInterval: 30000
    });

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return format(new Date(dateStr), 'dd MMM HH:mm');
    };

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <header className="mb-8 max-w-6xl mx-auto flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Vessel Trip Logs</h1>
                    <p className="text-slate-400">Detailed history of vessel movements and events.</p>
                </div>
                <Link href="/">
                    <a className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </a>
                </Link>
            </header>

            <main className="max-w-6xl mx-auto">
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-900/50 text-slate-400 uppercase font-medium">
                                <tr>
                                    <th className="px-6 py-4">Vessel</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Scheduled Arrival</th>
                                    <th className="px-6 py-4">Entered Heads</th>
                                    <th className="px-6 py-4">Berthed</th>
                                    <th className="px-6 py-4">Departed Berth</th>
                                    <th className="px-6 py-4">Left Heads</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                                            Loading trips...
                                        </td>
                                    </tr>
                                ) : trips?.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                                            No trips recorded yet.
                                        </td>
                                    </tr>
                                ) : (
                                    trips?.map((trip) => (
                                        <tr key={trip.id} className="hover:bg-slate-700/30 transition-colors">
                                            <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                                                <Ship className="w-4 h-4 text-blue-400" />
                                                {trip.vesselName}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                                                    ${trip.status === 'INBOUND' ? 'bg-blue-500/10 text-blue-400' :
                                                        trip.status === 'ALONGSIDE' ? 'bg-green-500/10 text-green-400' :
                                                            trip.status === 'OUTBOUND' ? 'bg-orange-500/10 text-orange-400' :
                                                                'bg-slate-500/10 text-slate-400'}`}>
                                                    {trip.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-400">{formatDate(trip.scheduledArrival)}</td>
                                            <td className="px-6 py-4 text-slate-400">{formatDate(trip.actualArrivalHeads)}</td>
                                            <td className="px-6 py-4 text-slate-400">{formatDate(trip.actualBerthed)}</td>
                                            <td className="px-6 py-4 text-slate-400">{formatDate(trip.actualDepartedBerth)}</td>
                                            <td className="px-6 py-4 text-slate-400">{formatDate(trip.actualDepartureHeads)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
}
