import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchedule, fetchRemoved } from '../lib/api';
import { format, formatDistanceToNow } from 'date-fns';
import { berthTypes, type BerthName } from '../components/berths';
import { ArrowRight, Anchor, Clock } from 'lucide-react';

export function PublicStatus() {
    const { data: schedule, isLoading, error } = useQuery({
        queryKey: ['schedule'],
        queryFn: async () => {
            const data = await fetchSchedule();
            return data.sort((a: any, b: any) =>
                new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
            );
        },
        refetchInterval: 30000,
    });

    const { data: removed } = useQuery({
        queryKey: ['removed'],
        queryFn: fetchRemoved,
        refetchInterval: 30000,
    });

    if (isLoading) return (
        <div className="min-h-screen bg-slate-950 text-white p-6 font-sans">
            <header className="mb-8 border-b border-slate-800 pb-4 flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-white mb-2">PORT STATUS</h1>
                    <p className="text-slate-400 text-xl">Newcastle Harbour Live Feed</p>
                </div>
                <div className="text-right">
                    <div className="h-9 w-24 bg-slate-800/50 rounded animate-pulse mb-1"></div>
                    <div className="h-6 w-32 bg-slate-800/50 rounded animate-pulse"></div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                        <div>
                            <div className="h-5 w-24 bg-slate-800/50 rounded animate-pulse mb-2"></div>
                            <div className="h-12 w-16 bg-slate-800/50 rounded animate-pulse"></div>
                        </div>
                        <div className="h-16 w-16 bg-slate-800/50 rounded-xl animate-pulse"></div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-200">
                        <Anchor className="w-6 h-6" />
                        Currently at Berth
                    </h2>
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-24 bg-slate-800/40 border border-slate-800 rounded-xl animate-pulse"></div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-200">
                        <Clock className="w-6 h-6" />
                        Next Arrivals
                    </h2>
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-24 bg-slate-800/40 border border-slate-800 rounded-xl animate-pulse"></div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
    if (error) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400 text-2xl">System Offline</div>;

    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const vesselsInPort = schedule.filter((s: any) =>
        s.movementType === 'Departure' &&
        new Date(s.scheduledTime) > now &&
        s.status === 'In Port: Yes'
    );

    const arrivals24h = schedule.filter((s: any) =>
        s.movementType === 'Arrival' &&
        new Date(s.scheduledTime) > now &&
        new Date(s.scheduledTime) < next24h
    );

    const departures24h = schedule.filter((s: any) =>
        s.movementType === 'Departure' &&
        new Date(s.scheduledTime) > now &&
        new Date(s.scheduledTime) < next24h
    );

    const nextArrivals = schedule
        .filter((s: any) => s.movementType === 'Arrival' && new Date(s.scheduledTime) > now)
        .slice(0, 5);

    return (
        <div className="min-h-screen bg-slate-950 text-white p-6 font-sans">
            <header className="mb-8 border-b border-slate-800 pb-4 flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-white mb-2">PORT STATUS</h1>
                    <p className="text-slate-400 text-xl">Newcastle Harbour Live Feed</p>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-mono font-bold text-emerald-400">
                        {format(now, 'HH:mm')}
                    </div>
                    <div className="text-slate-500 font-medium">
                        {format(now, 'EEEE, d MMMM')}
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <SummaryCard
                    title="Vessels in Port"
                    count={vesselsInPort.length}
                    icon={<Anchor className="w-8 h-8 text-blue-400" />}
                    color="bg-blue-500/10 border-blue-500/20"
                />
                <SummaryCard
                    title="Arrivals (24h)"
                    count={arrivals24h.length}
                    icon={<ArrowRight className="w-8 h-8 text-emerald-400" />}
                    color="bg-emerald-500/10 border-emerald-500/20"
                />
                <SummaryCard
                    title="Departures (24h)"
                    count={departures24h.length}
                    icon={<ArrowRight className="w-8 h-8 text-orange-400" />}
                    color="bg-orange-500/10 border-orange-500/20"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-200">
                        <Anchor className="w-6 h-6" />
                        Currently at Berth
                    </h2>
                    <div className="space-y-3">
                        {(Object.keys(berthTypes) as BerthName[]).map((berthName) => {
                            const vessel = vesselsInPort.find((v: any) => v.origin === berthName);

                            if (vessel) {
                                return <VesselCard key={vessel.id} vessel={vessel} type="in-port" />;
                            }

                            // Find next arrival for this berth
                            const nextArrival = schedule
                                .filter((s: any) =>
                                    s.movementType === 'Arrival' &&
                                    s.destination === berthName &&
                                    new Date(s.scheduledTime) > now
                                )
                                .sort((a: any, b: any) =>
                                    new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
                                )[0];

                            let durationHours = 0;
                            if (nextArrival) {
                                const departure = schedule.find((s: any) =>
                                    s.movementType === 'Departure' &&
                                    s.vesselName === nextArrival.vesselName &&
                                    new Date(s.scheduledTime) > new Date(nextArrival.scheduledTime)
                                );

                                if (departure) {
                                    const diff = new Date(departure.scheduledTime).getTime() - new Date(nextArrival.scheduledTime).getTime();
                                    durationHours = Math.round(diff / (1000 * 60 * 60));
                                }
                            }

                            return (
                                <EmptyBerthCard
                                    key={berthName}
                                    name={berthName}
                                    nextArrival={nextArrival}
                                    durationHours={durationHours}
                                />
                            );
                        })}
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-200">
                        <Clock className="w-6 h-6" />
                        Next Arrivals
                    </h2>
                    <div className="space-y-3">
                        {nextArrivals.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 bg-slate-900/50 rounded-xl">
                                No scheduled arrivals
                            </div>
                        ) : (
                            nextArrivals.map((v: any) => (
                                <VesselCard key={v.id} vessel={v} type="arrival" />
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-4 mt-8">
                <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-200">
                    <ArrowRight className="w-6 h-6 text-slate-400" />
                    Recently Departed / Removed
                </h2>
                <div className="space-y-3">
                    {!removed || removed.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 bg-slate-900/50 rounded-xl">
                            No recent movements
                        </div>
                    ) : (
                        removed.map((v: any) => (
                            <VesselCard key={v.id} vessel={v} type="removed" />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function SummaryCard({ title, count, icon, color }: any) {
    return (
        <div className={`${color} border rounded-2xl p-6 flex items-center justify-between`}>
            <div>
                <p className="text-slate-400 font-medium mb-1">{title}</p>
                <p className="text-5xl font-black">{count}</p>
            </div>
            <div className="p-4 bg-slate-900/40 rounded-xl">
                {icon}
            </div>
        </div>
    );
}

function VesselCard({ vessel, type }: any) {
    const isArrival = type === 'arrival';
    const isRemoved = type === 'removed';
    const berth = isArrival ? vessel.destination : vessel.origin;
    const shipType = berth ? berthTypes[berth as BerthName] : undefined;
    const isCoal = shipType === 'Coal 🔥';
    const scheduledTime = new Date(vessel.scheduledTime);
    const timeUntil = formatDistanceToNow(scheduledTime, { addSuffix: true });

    return (
        <div className={`
            relative overflow-hidden rounded-xl p-4 border 
            ${isCoal ? 'bg-orange-950/20 border-orange-500/20' : 'bg-slate-800/40 border-slate-700'}
        `}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-lg font-bold text-slate-200 mb-0.5">{berth}</h3>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-white">{vessel.vesselName}</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-xs text-slate-500 uppercase tracking-wider">{shipType || 'Unknown Type'}</span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-slate-500 font-medium mt-0.5">
                        {isArrival ? 'Arriving' : isRemoved ? 'Departed' : 'Departing'}
                    </div>
                    <div className={`text-xl font-bold ${isArrival ? 'text-emerald-400' : isRemoved ? 'text-slate-500' : 'text-blue-400'}`}>
                        {timeUntil}
                    </div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">
                        {isArrival ? 'ETA' : 'ETD'} {format(scheduledTime, 'HH:mm')}
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmptyBerthCard({ name, nextArrival, durationHours }: { name: string, nextArrival?: any, durationHours?: number }) {
    const type = berthTypes[name as BerthName];
    const [isOpen, setIsOpen] = React.useState(false);

    if (!nextArrival) {
        return (
            <div className="relative overflow-hidden rounded-xl p-4 border border-slate-800/60 bg-slate-900/20 flex items-center justify-between group">
                <div>
                    <h3 className="text-lg font-bold text-slate-500 group-hover:text-slate-400 transition-colors">{name}</h3>
                    <div className="text-xs text-slate-600 font-medium uppercase tracking-wider mt-0.5">{type}</div>
                </div>
                <div className="px-3 py-1 rounded-full bg-slate-900/50 border border-slate-800 text-xs text-slate-600 font-medium uppercase tracking-wider">
                    Empty
                </div>
            </div>
        );
    }

    const timeUntil = formatDistanceToNow(new Date(nextArrival.scheduledTime), { addSuffix: true });

    return (
        <div className="relative overflow-hidden rounded-xl border border-slate-800/60 bg-slate-900/20 transition-all duration-300 hover:border-slate-700/60 hover:bg-slate-900/40">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-4 flex items-center justify-between cursor-pointer text-left outline-none"
            >
                <div>
                    <h3 className={`text-lg font-bold transition-colors ${isOpen ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'}`}>{name}</h3>
                    <div className="text-xs text-slate-600 font-medium uppercase tracking-wider mt-0.5">{type}</div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`
                        px-3 py-1 rounded-full border text-xs font-medium uppercase tracking-wider transition-colors
                        ${isOpen
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-slate-900/50 border-slate-800 text-slate-600'}
                    `}>
                        {isOpen ? 'Incoming' : 'Empty'}
                    </div>
                    <div className={`text-slate-600 transition-transform duration-300 ${isOpen ? 'rotate-180 text-slate-400' : ''}`}>
                        <ArrowRight className="w-4 h-4 rotate-90" />
                    </div>
                </div>
            </button>

            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                    <div className="px-4 pb-4 pt-0">
                        <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800/50 flex items-start gap-3">
                            <div className="mt-1">
                                <Clock className="w-4 h-4 text-emerald-500" />
                            </div>
                            <div className="text-sm leading-relaxed">
                                <div className="font-medium text-slate-300">
                                    {nextArrival.vesselName}
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                    Arriving <span className="text-emerald-400 font-medium">{timeUntil}</span>
                                    <span className="mx-1.5 text-slate-700">•</span>
                                    Est. time at berth <span className="text-slate-300 font-medium">{durationHours}h</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
