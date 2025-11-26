import { useQuery } from '@tanstack/react-query';
import { fetchSchedule } from '../lib/api';
import { format } from 'date-fns';

export function LiveSchedule() {
    const { data: schedule, isLoading, error } = useQuery({
        queryKey: ['schedule'],
        queryFn: async () => {
            const data = await fetchSchedule();
            return data.sort((a: any, b: any) =>
                new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
            );
        },
        refetchInterval: 60000, // Refresh every minute
    });

    if (isLoading) return <div className="p-4">Loading schedule...</div>;
    if (error) return <div className="p-4 text-red-400">Error loading schedule</div>;

    return (
        <div className="bg-surface rounded-lg shadow-lg overflow-hidden">
            <div className="p-4 border-b border-slate-700">
                <h2 className="text-xl font-bold text-white">Live Schedule</h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300 min-w-[800px]">
                    <thead className="bg-slate-900/50 text-xs uppercase text-slate-400">
                        <tr>
                            <th className="px-4 py-3">Vessel</th>
                            <th className="px-4 py-3">Movement</th>
                            <th className="px-4 py-3">Time</th>
                            <th className="px-4 py-3">Origin</th>
                            <th className="px-4 py-3">Destination</th>
                            <th className="px-4 py-3">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {schedule.map((row: any) => (
                            <tr key={row.id} className="hover:bg-slate-700/50">
                                <td className="px-4 py-3 font-medium text-white">{row.vesselName}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${row.movementType === 'Arrival' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'
                                        }`}>
                                        {row.movementType}
                                    </span>
                                </td>
                                <td className="px-4 py-3">{format(new Date(row.scheduledTime), 'MMM d, HH:mm')}</td>
                                <td className="px-4 py-3">{row.origin}</td>
                                <td className="px-4 py-3">{row.destination}</td>
                                <td className="px-4 py-3">{row.status}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
