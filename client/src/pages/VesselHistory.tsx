import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { fetchVesselHistory } from '../lib/api';
import { Anchor, Clock, Compass, Activity, BarChart2, AlertTriangle, ArrowLeft, ArrowRight, MapPin, Calendar, History, Ship } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { berthTypes, type BerthName } from '../components/berths';

function safeFormat(dateVal: any, formatStr: string, fallback = 'N/A') {
  if (!dateVal) return fallback;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return fallback;
  try {
    return format(d, formatStr);
  } catch (e) {
    return fallback;
  }
}

function safeFormatDistance(dateVal: any, fallback = '') {
  if (!dateVal) return fallback;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return fallback;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch (e) {
    return fallback;
  }
}

export function VesselHistory({ params }: { params: { name: string } }) {
  const vesselName = params?.name ? decodeURIComponent(params.name) : '';
  const [currentTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'stays' | 'movements' | 'changelog'>('stays');

  const { data: history, isLoading, error } = useQuery({
    queryKey: ['vessel-history', vesselName],
    queryFn: () => fetchVesselHistory(vesselName),
    enabled: !!vesselName,
  });

  // Deduplicate physical movements (getting only the latest state of each physical movement)
  const uniqueMovements = useMemo(() => {
    if (!history || !Array.isArray(history)) return [];
    
    // Sort by scrapedAt desc to ensure we evaluate the latest state of a movement first
    const sorted = [...history].sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime());
    
    const uniqueList: any[] = [];
    const processedGroups: { movementType: string; scheduledTimeHistory: Set<number> }[] = [];

    for (const record of sorted) {
      const recTime = new Date(record.scheduledTime).getTime();
      
      const matchingGroup = processedGroups.find(g =>
        g.movementType === record.movementType &&
        (g.scheduledTimeHistory.has(recTime) ||
         Array.from(g.scheduledTimeHistory).some(t => Math.abs(t - recTime) < 36 * 60 * 60 * 1000))
      );

      if (matchingGroup) {
        matchingGroup.scheduledTimeHistory.add(recTime);
        const prevVal = record.previousValue;
        if (prevVal && prevVal.scheduledTime) {
          matchingGroup.scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
        }
      } else {
        uniqueList.push(record);

        const scheduledTimeHistory = new Set<number>([recTime]);
        const prevVal = record.previousValue;
        if (prevVal && prevVal.scheduledTime) {
          scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
        }

        processedGroups.push({
          movementType: record.movementType,
          scheduledTimeHistory
        });
      }
    }
    
    // Sort unique movements by scheduledTime descending for display
    return uniqueList.sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());
  }, [history]);

  // Group movements into matched port stays
  const stays = useMemo(() => {
    if (!uniqueMovements || uniqueMovements.length === 0) return [];
    
    const arrivals = uniqueMovements.filter(m => m.movementType === 'Arrival');
    const departures = uniqueMovements.filter(m => m.movementType === 'Departure');
    
    const list: {
      id: string;
      berth: string;
      arrival?: Date;
      departure?: Date;
      dwellHours?: number;
      isOngoing: boolean;
      arrivalRecord?: any;
      departureRecord?: any;
    }[] = [];

    // Match arrivals to subsequent departures
    arrivals.forEach(arr => {
      const arrTime = new Date(arr.scheduledTime);
      
      // Find the closest departure after this arrival
      const matchingDep = departures
        .filter(d => new Date(d.scheduledTime) > arrTime)
        .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())[0];
        
      if (matchingDep) {
        const depTime = new Date(matchingDep.scheduledTime);
        const dwellMs = depTime.getTime() - arrTime.getTime();
        list.push({
          id: `stay-${arr.id}-${matchingDep.id}`,
          berth: arr.destination || 'Unknown Berth',
          arrival: arrTime,
          departure: depTime,
          dwellHours: dwellMs / (1000 * 60 * 60),
          isOngoing: arr.changeType !== 'COMPLETED' || matchingDep.changeType !== 'COMPLETED',
          arrivalRecord: arr,
          departureRecord: matchingDep
        });
      } else {
        // Ongoing stay at this berth (no matching departure found yet)
        list.push({
          id: `stay-ongoing-${arr.id}`,
          berth: arr.destination || 'Unknown Berth',
          arrival: arrTime,
          isOngoing: true,
          arrivalRecord: arr
        });
      }
    });

    // Find departures that do not have matching arrivals (e.g., initial scraping gap)
    departures.forEach(dep => {
      const depTime = new Date(dep.scheduledTime);
      
      const hasMatchingArrival = arrivals.some(arr => {
        const arrTime = new Date(arr.scheduledTime);
        if (arrTime >= depTime) return false;
        
        // Ensure there isn't a closer departure in between
        const intermediateDep = departures.some(d => {
          const dTime = new Date(d.scheduledTime);
          return dTime > arrTime && dTime < depTime;
        });
        return !intermediateDep;
      });

      if (!hasMatchingArrival) {
        list.push({
          id: `stay-orphan-dep-${dep.id}`,
          berth: dep.origin || 'Unknown Berth',
          departure: depTime,
          isOngoing: false,
          departureRecord: dep
        });
      }
    });

    // Sort stays descending by their latest timestamp (departure or arrival)
    return list.sort((a, b) => {
      const aTime = a.departure?.getTime() || a.arrival?.getTime() || 0;
      const bTime = b.departure?.getTime() || b.arrival?.getTime() || 0;
      return bTime - aTime;
    });
  }, [uniqueMovements]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Anchor className="w-10 h-10 text-cyan-400 animate-spin" />
          <p className="text-slate-400 font-mono text-sm">Retrieving vessel history logs...</p>
        </div>
      </div>
    );
  }

  if (error || !history || !Array.isArray(history)) {
    return (
      <div className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center">
        <div className="text-center p-8 bg-slate-900/40 border border-slate-800 rounded-2xl max-w-md">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Failed to load logs</h2>
          <p className="text-slate-400 text-sm mb-6">We encountered an issue retrieving movement history for this vessel.</p>
          <Link href="/new">
            <a className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" /> Return to Dashboard
            </a>
          </Link>
        </div>
      </div>
    );
  }

  // Get metadata from the latest record (first item in history)
  const latestRecord = history[0];
  const isArrival = latestRecord?.movementType === 'Arrival';
  const currentBerth = isArrival ? latestRecord?.destination : latestRecord?.origin;
  const currentShipType = currentBerth ? berthTypes[currentBerth as BerthName] : undefined;

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex font-sans">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-800 bg-[#070b19]/60 backdrop-blur-md flex flex-col p-6 hidden md:flex">
        <div className="flex items-center gap-3 mb-8">
          <Anchor className="w-8 h-8 text-cyan-400 animate-pulse" />
          <div>
            <h2 className="text-lg font-black tracking-wider text-white">PORT RADAR</h2>
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Newcastle Harbour</span>
          </div>
        </div>

        <nav className="space-y-1.5 flex-1">
          <Link href="/new">
            <a className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent">
              <Compass className="w-4 h-4" />
              Control Center
            </a>
          </Link>
          
          <Link href="/new">
            <a className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent">
              <Activity className="w-4 h-4" />
              Vessel Radar Map
            </a>
          </Link>

          <Link href="/new">
            <a className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent">
              <Clock className="w-4 h-4" />
              Berth Planner
            </a>
          </Link>

          <Link href="/new">
            <a className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent">
              <BarChart2 className="w-4 h-4" />
              Port Analytics
            </a>
          </Link>
        </nav>

        <div className="pt-6 border-t border-slate-800 text-xs text-slate-500 font-mono">
          <p>System State: Live</p>
          <p className="mt-1">Telemetry: Connected</p>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        
        {/* Header Clock / Title */}
        <header className="h-20 border-b border-slate-800/60 bg-[#030712]/40 backdrop-blur-md px-6 md:px-8 flex items-center justify-between z-10">
          <div className="flex items-center gap-4">
            <Link href="/new">
              <a className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </a>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                Vessel Profile
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Chronological history & telemetry log</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-mono font-bold text-white">{format(currentTime, 'HH:mm:ss')} AEST</div>
              <div className="text-[10px] text-slate-500">{format(currentTime, 'EEEE, dd MMM yyyy')}</div>
            </div>
          </div>
        </header>

        {/* Content Workspace scrollable */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
          
          {/* Vessel Profile Overview Header Card */}
          <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="space-y-2 relative">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest font-mono font-semibold">
                Vessel Profile
              </span>
              <h2 className="text-3xl font-extrabold text-white">{vesselName}</h2>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                {currentShipType && <span>Vessel Type: <strong className="text-slate-200">{currentShipType}</strong></span>}
                {latestRecord?.agent && <span>Agent: <strong className="text-slate-200">{latestRecord.agent}</strong></span>}
                {latestRecord?.vesselType && <span>Classification: <strong className="text-slate-200">{latestRecord.vesselType}</strong></span>}
              </div>
            </div>

            <div className="flex gap-3 relative">
              <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl min-w-[120px]">
                <span className="text-[10px] text-slate-500 block uppercase font-medium">Last Event</span>
                <span className={`text-sm font-bold block mt-1 ${
                  latestRecord?.changeType === 'COMPLETED' ? 'text-emerald-400' :
                  latestRecord?.changeType === 'REMOVED' ? 'text-rose-400' :
                  'text-cyan-400'
                }`}>
                  {latestRecord?.changeType}
                </span>
                <span className="text-[10px] text-slate-400">{safeFormatDistance(latestRecord?.scrapedAt)}</span>
              </div>
              <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl min-w-[120px]">
                <span className="text-[10px] text-slate-500 block uppercase font-medium">Stays / Movements</span>
                <span className="text-xl font-black text-white block mt-1 font-mono">{stays.length} / {uniqueMovements.length}</span>
                <span className="text-[10px] text-slate-400">{history.length} raw changes</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800/80 gap-2">
            <button
              onClick={() => setActiveTab('stays')}
              className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-bold transition-all ${
                activeTab === 'stays'
                  ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Port Stays ({stays.length})
            </button>
            <button
              onClick={() => setActiveTab('movements')}
              className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-bold transition-all ${
                activeTab === 'movements'
                  ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'
              }`}
            >
              <Ship className="w-4 h-4" />
              Movements ({uniqueMovements.length})
            </button>
            <button
              onClick={() => setActiveTab('changelog')}
              className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-bold transition-all ${
                activeTab === 'changelog'
                  ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'
              }`}
            >
              <History className="w-4 h-4" />
              Raw Change Log ({history.length})
            </button>
          </div>

          {/* Tab Content Panels */}
          {activeTab === 'stays' && (
            <div className="space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2 mb-2">
                <Calendar className="w-5 h-5 text-cyan-400" />
                Vessel Port Stay History
              </h3>

              {stays.length === 0 ? (
                <div className="text-center py-12 bg-[#0f172a]/10 border border-slate-800 rounded-xl">
                  <p className="text-slate-500 text-sm">No matched stays found for this vessel.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {stays.map(stay => (
                    <div key={stay.id} className="p-5 bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-cyan-950/20 border border-cyan-800/40 rounded-lg text-cyan-400">
                            <MapPin className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-200 text-base">{stay.berth}</h4>
                            <span className="text-xs text-slate-400">Port Stay Visit</span>
                          </div>
                        </div>

                        <div className="text-left sm:text-right">
                          {stay.dwellHours !== undefined ? (
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 font-bold text-xs">
                              <Clock className="w-3.5 h-3.5" />
                              Dwell: {stay.dwellHours.toFixed(1)} hrs
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse">
                              Ongoing stay
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="p-3 bg-slate-950/40 border border-slate-800/50 rounded-lg">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1">Arrival Telemetry</span>
                          {stay.arrival ? (
                            <div className="space-y-1">
                              <p className="font-bold text-slate-300">{safeFormat(stay.arrival, 'EEEE, MMM d, yyyy @ HH:mm')}</p>
                              {stay.arrivalRecord && (
                                <p className="text-xs text-slate-500">
                                  Status: <span className="text-emerald-400 font-semibold">{stay.arrivalRecord.changeType}</span> ({safeFormatDistance(stay.arrivalRecord.scrapedAt)})
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-slate-500 italic">No recorded arrival time (historical gap)</p>
                          )}
                        </div>

                        <div className="p-3 bg-slate-950/40 border border-slate-800/50 rounded-lg">
                          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1">Departure Telemetry</span>
                          {stay.departure ? (
                            <div className="space-y-1">
                              <p className="font-bold text-slate-300">{safeFormat(stay.departure, 'EEEE, MMM d, yyyy @ HH:mm')}</p>
                              {stay.departureRecord && (
                                <p className="text-xs text-slate-500">
                                  Status: <span className="text-emerald-400 font-semibold">{stay.departureRecord.changeType}</span> ({safeFormatDistance(stay.departureRecord.scrapedAt)})
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-slate-500 italic">Still at berth / No departure scheduled</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'movements' && (
            <div className="space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2 mb-2">
                <Ship className="w-5 h-5 text-cyan-400" />
                Physical Port Movements (Latest States)
              </h3>

              {uniqueMovements.length === 0 ? (
                <div className="text-center py-12 bg-[#0f172a]/10 border border-slate-800 rounded-xl">
                  <p className="text-slate-500 text-sm">No unique movements found.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {uniqueMovements.map(record => {
                    const isArrival = record.movementType === 'Arrival';
                    const isDeparture = record.movementType === 'Departure';
                    const isShift = record.movementType === 'Shift';
                    const isCompleted = record.changeType === 'COMPLETED';

                    return (
                      <div key={record.id} className="p-4 bg-slate-900/40 border border-slate-800/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className={`w-2.5 h-2.5 rounded-full ${
                            isArrival ? 'bg-emerald-500' : isDeparture ? 'bg-blue-500' : 'bg-purple-500'
                          }`} />
                          
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-200">{record.movementType}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                isCompleted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400'
                              }`}>
                                {record.changeType}
                              </span>
                            </div>

                            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                              {isArrival && (
                                <>Destination: <strong className="text-slate-300">{record.destination || 'N/A'}</strong></>
                              )}
                              {isDeparture && (
                                <>Origin: <strong className="text-slate-300">{record.origin || 'N/A'}</strong></>
                              )}
                              {isShift && (
                                <>Shift: <strong className="text-slate-300">{record.origin} → {record.destination}</strong></>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-start md:items-end gap-3 text-xs sm:text-right font-mono">
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase font-sans">Scheduled Time</span>
                            <span className="text-slate-300 font-bold">{safeFormat(record.scheduledTime, 'yyyy-MM-dd HH:mm')}</span>
                          </div>
                          <div className="hidden sm:block text-slate-600">|</div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase font-sans">Telemetry Scraped</span>
                            <span className="text-slate-400">{safeFormat(record.scrapedAt, 'yyyy-MM-dd HH:mm')}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'changelog' && (
            <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6">
              <h3 className="font-bold text-white flex items-center gap-2 mb-6">
                <Clock className="w-5 h-5 text-cyan-400" />
                Vessel Port History Timeline (Raw Logs)
              </h3>

              {history.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-500 text-sm">No recorded history logs for this vessel.</p>
                </div>
              ) : (
                <div className="relative border-l-2 border-slate-800/80 ml-4 pl-8 space-y-8">
                  {history.map((record: any) => {
                    const isNew = record.changeType === 'NEW';
                    const isCompleted = record.changeType === 'COMPLETED';
                    const isRemoved = record.changeType === 'REMOVED';
                    const isUpdate = record.changeType === 'UPDATE';
                    const prev = record.previousValue;

                    let eventColor = 'bg-slate-700';
                    let borderEventColor = 'border-slate-800';
                    if (isCompleted) {
                      eventColor = 'bg-emerald-500';
                      borderEventColor = 'border-emerald-500/20';
                    } else if (isRemoved) {
                      eventColor = 'bg-rose-500';
                      borderEventColor = 'border-rose-500/20';
                    } else if (isNew) {
                      eventColor = 'bg-cyan-500';
                      borderEventColor = 'border-cyan-500/20';
                    } else if (isUpdate) {
                      eventColor = 'bg-amber-500';
                      borderEventColor = 'border-amber-500/20';
                    }

                    return (
                      <div key={record.id} className="relative group">
                        
                        {/* Timeline Dot */}
                        <span className="absolute -left-[41px] top-1.5 flex h-4 w-4 rounded-full border-4 border-[#030712] justify-center items-center">
                          <span className={`h-2 w-2 rounded-full ${eventColor}`} />
                        </span>

                        {/* Event Card */}
                        <div className={`p-5 rounded-xl border bg-slate-900/40 ${borderEventColor} space-y-3`}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                isCompleted ? 'bg-emerald-500/10 text-emerald-400' :
                                isRemoved ? 'bg-rose-500/10 text-rose-400' :
                                isNew ? 'bg-cyan-500/10 text-cyan-400' :
                                'bg-amber-500/10 text-amber-400'
                              }`}>
                                {record.changeType}
                              </span>
                              <span className="text-xs font-semibold text-slate-300">
                                {record.movementType}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 font-mono">
                              Scraped: {safeFormat(record.scrapedAt, 'dd MMM yyyy, HH:mm:ss')} ({safeFormatDistance(record.scrapedAt)})
                            </span>
                          </div>

                          {/* Scheduled time info */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                              <span className="text-slate-500 block uppercase tracking-wider font-semibold mb-1">Scheduled Date & Time</span>
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" />
                                {isUpdate && prev?.scheduledTime ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="line-through text-slate-500">
                                      {safeFormat(prev.scheduledTime, 'MMM d, HH:mm')}
                                    </span>
                                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                    <span className="text-amber-400 font-bold">
                                      {safeFormat(record.scheduledTime, 'MMM d, HH:mm')}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-slate-200 font-bold">
                                    {safeFormat(record.scheduledTime, 'EEEE, MMM d, HH:mm')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                              <span className="text-slate-500 block uppercase tracking-wider font-semibold mb-1">Berth Allocation</span>
                              <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                {record.movementType === 'Arrival' ? (
                                  <div>
                                    <span className="text-slate-400 mr-2">Destination:</span>
                                    {isUpdate && prev?.destination ? (
                                      <span className="flex items-center gap-2 inline-flex">
                                        <span className="line-through text-slate-500">{prev.destination}</span>
                                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                        <span className="text-amber-400 font-bold">{record.destination}</span>
                                      </span>
                                    ) : (
                                      <span className="text-slate-200 font-bold">{record.destination || 'N/A'}</span>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <span className="text-slate-400 mr-2">Origin:</span>
                                    {isUpdate && prev?.origin ? (
                                      <span className="flex items-center gap-2 inline-flex">
                                        <span className="line-through text-slate-500">{prev.origin}</span>
                                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                        <span className="text-amber-400 font-bold">{record.origin}</span>
                                      </span>
                                    ) : (
                                      <span className="text-slate-200 font-bold">{record.origin || 'N/A'}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Extra metadata if updated or detailed */}
                          {(record.expectedTime || record.status || record.agent) && (
                            <div className="pt-2 border-t border-slate-800/40 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                              {record.agent && (
                                <span>Agent: <strong className="text-slate-300">{record.agent}</strong></span>
                              )}
                              {record.status && (
                                <span>Status: <strong className="text-slate-300">{record.status}</strong></span>
                              )}
                              {record.expectedTime && (
                                <span>Expected: <strong className="text-slate-300">{safeFormat(record.expectedTime, 'MMM d, HH:mm')}</strong></span>
                              )}
                            </div>
                          )}

                          {/* Diff update helper details */}
                          {isUpdate && prev && Object.keys(prev).length > 0 && (
                            <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg text-xs leading-relaxed">
                              <span className="font-bold text-amber-400 block mb-1">Detected Schedule Modifications:</span>
                              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                {Object.entries(prev).map(([key, val]: [string, any]) => {
                                  if (key === 'scheduledTime' || key === 'origin' || key === 'destination') return null; // already visually represented above
                                  return (
                                    <li key={key}>
                                      Field <strong className="text-slate-300">{key}</strong> changed from <span className="line-through">{JSON.stringify(val)}</span> to <strong className="text-slate-200">{JSON.stringify((record as any)[key])}</strong>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
