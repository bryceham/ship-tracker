import { useQuery } from '@tanstack/react-query';
import { fetchChanges } from '../lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowRight, Anchor, Clock, MapPin } from 'lucide-react';
import { berthTypes, type BerthName } from './berths';
import { useEffect } from 'react';

interface FeedProps {
    onChangesDetected: (callback: () => void) => void;
}

export function Feed({ onChangesDetected }: FeedProps) {
    const { data: changes, isLoading, error, refetch } = useQuery({
        queryKey: ['changes'],
        queryFn: fetchChanges,
        refetchInterval: 30000,
    });

    // Register callback for WebSocket change notifications
    useEffect(() => {
        const cleanup = onChangesDetected(() => {
            console.log('Feed: Changes detected, refetching...');
            refetch();
        });
        return cleanup;
    }, [onChangesDetected, refetch]);

    if (isLoading) return <div className="p-4">Loading feed...</div>;
    if (error) return <div className="p-4 text-red-400">Error loading feed</div>;

    // Filter out changes where only the status field changed
    const filteredChanges = changes?.filter((change: any) => {
        if (change.changeType !== 'UPDATE') return true;

        const prev = change.previousValue;
        if (!prev) return true;

        // Check if previousValue only contains the status field
        const prevKeys = Object.keys(prev);
        if (prevKeys.length === 1 && prevKeys[0] === 'status') {
            return false; // Filter out status-only changes
        }

        return true;
    }) || [];

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold text-white mb-4">Latest Updates</h2>
            {filteredChanges.map((change: any) => (
                <ChangeCard key={change.id} change={change} />
            ))}
        </div>
    );
}

function ChangeCard({ change }: { change: any }) {
    const isNew = change.changeType === 'NEW';
    const isRemoved = change.changeType === 'REMOVED';
    const prev = change.previousValue;

    const isArrival = change.movementType === 'Arrival';
    const isDeparture = change.movementType === 'Departure';
    const berth = isArrival ? change.destination : isDeparture ? change.origin : '';
    const shipType = berth ? berthTypes[berth as BerthName] : undefined;

    const scheduledTime = prev?.scheduledTime ? new Date(prev.scheduledTime) : (change.scheduledTime ? new Date(change.scheduledTime) : null);
    const happenedAsScheduled = isRemoved && scheduledTime && new Date(change.scrapedAt) > scheduledTime;

    // Determine card background color based on ship type
    const isCoal = shipType === 'Coal 🔥';
    const cardBgClass = isCoal ? 'bg-orange-500/20' : 'bg-surface';

    return (
        <div className={`${cardBgClass} rounded-lg p-4 shadow-lg border-l-4 ${isRemoved ? (happenedAsScheduled ? 'border-emerald-500' : 'border-red-500') : 'border-accent'}`}>
            <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg text-white flex items-center gap-2">
                    <span className="text-2xl">🚢</span> {change.vesselName}
                </h3>
                <span className="text-xs text-slate-400" title={new Date(change.scrapedAt).toLocaleString()}>
                    {formatDistanceToNow(new Date(change.scrapedAt), { addSuffix: true })}
                </span>
            </div>

            <div className="text-slate-300 text-sm space-y-2">
                {isNew ? (
                    <div className="flex items-center gap-2 text-emerald-400">
                        <span className="font-semibold">New Schedule Detected</span>
                    </div>
                ) : isRemoved ? (
                    happenedAsScheduled ? (
                        <div className="flex items-center gap-2 text-emerald-400">
                            <span className="font-semibold">
                                Vessel {change.movementType?.toLowerCase() === 'arrival' ? 'arrived' : 'departed'} as scheduled
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-red-400">
                            <span className="font-semibold">Vessel Removed from Schedule</span>
                        </div>
                    )
                ) : (
                    <div className="space-y-1">
                        {prev?.scheduledTime && (
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-500" />
                                <span className="line-through text-slate-500">
                                    {format(new Date(prev.scheduledTime), 'HH:mm (MMM d)')}
                                </span>
                                <ArrowRight className="w-3 h-3 text-slate-500" />
                                <span className="text-amber-400 font-semibold">
                                    {format(new Date(change.scheduledTime), 'HH:mm (MMM d)')}
                                </span>
                            </div>
                        )}
                        {prev?.origin && (
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-slate-500" />
                                <span className="line-through text-slate-500">{prev.origin}</span>
                                <ArrowRight className="w-3 h-3 text-slate-500" />
                                <span className="text-white">{change.origin}</span>
                            </div>
                        )}
                        {prev?.destination && (
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-slate-500" />
                                <span className="line-through text-slate-500">{prev.destination}</span>
                                <ArrowRight className="w-3 h-3 text-slate-500" />
                                <span className="text-white">{change.destination}</span>
                            </div>
                        )}
                        {prev?.status && (
                            <div className="flex items-center gap-2">
                                <Anchor className="w-4 h-4 text-slate-500" />
                                <span className="line-through text-slate-500">{prev.status}</span>
                                <ArrowRight className="w-3 h-3 text-slate-500" />
                                <span className="text-white">{change.status}</span>
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-700 flex gap-4 text-xs text-slate-400">
                    <span>{change.movementType}</span>
                    {shipType && <><span>•</span>
                        <span>{shipType}</span></>}
                </div>
            </div>
        </div>
    );
}
