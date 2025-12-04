import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface DailyStat {
    date: string;
    count: number;
}

export function DailyMovementsChart() {
    const { data: stats, isLoading } = useQuery<DailyStat[]>({
        queryKey: ['daily-movements'],
        queryFn: async () => {
            const res = await fetch('/api/stats/daily-movements');
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        },
    });

    if (isLoading) return <div className="h-64 w-full animate-pulse bg-gray-100/10 rounded-lg" />;
    if (!stats) return null;

    return (
        <div className="w-full h-64 p-4 bg-white/5 rounded-lg border border-white/10">
            <h3 className="text-lg font-medium text-white mb-4">Daily Removed Movements (Last 28 Days)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" vertical={false} />
                    <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        fontSize={12}
                        tickFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    />
                    <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                        itemStyle={{ color: '#e5e7eb' }}
                        labelStyle={{ color: '#9ca3af' }}
                        labelFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    />
                    <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} name="Removed Movements" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
