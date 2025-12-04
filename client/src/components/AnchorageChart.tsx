import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchAnchorageStats } from '../lib/api';

interface AnchorageStat {
    date: string;
    avgDuration: number;
    count: number;
}

export function AnchorageChart() {
    const { data: stats, isLoading } = useQuery<AnchorageStat[]>({
        queryKey: ['anchorage-stats'],
        queryFn: fetchAnchorageStats
    });

    if (isLoading) return <div className="h-64 animate-pulse bg-slate-800/50 rounded-xl" />;
    if (!stats || stats.length === 0) return null;

    return (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 backdrop-blur-sm">
            <h3 className="text-lg font-semibold text-slate-200 mb-6 flex items-center gap-2">
                <span className="w-2 h-8 bg-blue-500 rounded-full" />
                Average Anchorage Wait Time (Minutes)
            </h3>
            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis
                            dataKey="date"
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                                const date = new Date(value);
                                return `${date.getDate()}/${date.getMonth() + 1}`;
                            }}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            unit="m"
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                            cursor={{ fill: '#334155', opacity: 0.2 }}
                            formatter={(value: number) => [`${Math.round(value / 60)}h ${value % 60}m`, 'Avg Wait']}
                        />
                        <Bar
                            dataKey="avgDuration"
                            fill="#3b82f6"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={50}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
