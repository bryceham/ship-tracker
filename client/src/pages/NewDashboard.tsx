import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchedule, fetchChanges, fetchRemoved, fetchDriftStats, fetchBerthUtilization } from '../lib/api';
import { Anchor, Clock, Compass, Activity, BarChart2, AlertTriangle, History, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { berthTypes, type BerthName } from '../components/berths';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ScatterChart, Scatter, ReferenceLine, Cell } from 'recharts';
import { Feed } from '../components/Feed';

// Coordinates of berths on our SVG map layout
const berthCoordinates: Record<string, { x: number; y: number }> = {
  "Kooragang 4 (K4)": { x: 220, y: 130 },
  "Kooragang 5 (K5)": { x: 260, y: 135 },
  "Kooragang 6 (K6)": { x: 300, y: 140 },
  "Kooragang 7 (K7)": { x: 340, y: 145 },
  "Kooragang 8 (K8)": { x: 380, y: 150 },
  "Kooragang 9 (K9)": { x: 420, y: 155 },
  "Kooragang 10 (K10)": { x: 460, y: 160 },
  "Dyke 4 (D4)": { x: 350, y: 180 },
  "Dyke 5 (D5)": { x: 380, y: 185 },
  "East Basin 1 (E1)": { x: 520, y: 200 },
  "East Basin 2 (E2)": { x: 550, y: 205 },
  "West Basin 3 (W3)": { x: 580, y: 210 },
  "West Basin 4 (W4)": { x: 610, y: 215 },
  "Channel Berth (CH)": { x: 640, y: 220 },
  "Dyke 1 (D1)": { x: 670, y: 225 },
  "Dyke 2 (D2)": { x: 700, y: 230 },
  "Mayfield 4 (M4)": { x: 280, y: 100 },
  "Mayfield 5 (M5)": { x: 310, y: 105 },
  "Mayfield 7 (M7)": { x: 340, y: 110 },
  "Kooragang 2 (K2)": { x: 370, y: 115 },
  "Kooragang 3 (K3)": { x: 400, y: 120 },
};

export function NewDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [tideHeight, setTideHeight] = useState(0.8);
  const [tideState, setTideState] = useState<'Rising' | 'Falling'>('Rising');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'radar' | 'timeline' | 'analytics' | 'feed'>('dashboard');
  const [selectedVessel, setSelectedVessel] = useState<any | null>(null);

  // TanStack Query calls for real schedule and changes
  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ['schedule'],
    queryFn: fetchSchedule,
    refetchInterval: 30000,
  });

  const { data: changes = [], isLoading: changesLoading } = useQuery({
    queryKey: ['changes'],
    queryFn: fetchChanges,
    refetchInterval: 30000,
  });

  const { data: _removed = [], isLoading: removedLoading } = useQuery({
    queryKey: ['removed'],
    queryFn: fetchRemoved,
    refetchInterval: 30000,
  });

  const { data: stats = [] } = useQuery({
    queryKey: ['daily-movements'],
    queryFn: async () => {
      const res = await fetch('/api/stats/daily-movements');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
  });

  const { data: agentStats = [] } = useQuery({
    queryKey: ['agent-stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats/agents');
      if (!res.ok) throw new Error('Failed to fetch agent stats');
      return res.json();
    },
  });

  const { data: berthStats = [] } = useQuery({
    queryKey: ['berth-stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats/berths');
      if (!res.ok) throw new Error('Failed to fetch berth stats');
      return res.json();
    },
  });

  const { data: driftStats = { averageDriftMinutes: 0, maxDriftMinutes: 0, totalRescheduledMovements: 0, driftByVessel: [], driftByAgent: [] } } = useQuery({
    queryKey: ['drift-stats'],
    queryFn: fetchDriftStats,
    refetchInterval: 30000,
  });

  const { data: berthUtilization = [] } = useQuery({
    queryKey: ['berth-utilization'],
    queryFn: fetchBerthUtilization,
    refetchInterval: 30000,
  });


  // Clock & simulated tide updates
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
      const tideRad = (hours * Math.PI) / 6;
      const height = 0.8 + 1.0 * Math.sin(tideRad);
      setTideHeight(parseFloat(height.toFixed(2)));

      const isRising = Math.cos(tideRad) > 0;
      setTideState(isRising ? 'Rising' : 'Falling');
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Map berth stats for easy lookup
  const berthStatsMap = React.useMemo(() => {
    const map: Record<string, any> = {};
    if (Array.isArray(berthStats)) {
      berthStats.forEach((stat: any) => {
        map[stat.berth] = stat;
      });
    }
    return map;
  }, [berthStats]);

  if (scheduleLoading || changesLoading || removedLoading) {
    return (
      <div className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <Anchor className="w-12 h-12 text-cyan-400 animate-spin" />
          <p className="text-sm font-semibold tracking-wider text-slate-400">Loading Control Room Dashboard...</p>
        </div>
      </div>
    );
  }

  // Group active vessels by berth & calculate conflicts
  const berthOccupancy: Record<string, any[]> = {};
  schedule.forEach((item: any) => {
    const isArrival = item.movementType === 'Arrival';
    const berth = isArrival ? item.destination : item.origin;
    if (berth) {
      if (!berthOccupancy[berth]) berthOccupancy[berth] = [];
      berthOccupancy[berth].push(item);
    }
  });

  // Conflict Detection: highlight berths with multiple movements close in time
  const conflictBerths = new Set<string>();
  const projectedDelays: Record<number, string> = {};

  Object.entries(berthOccupancy).forEach(([berth, items]) => {
    items.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i];
      const next = items[i + 1];
      const diffMs = new Date(next.scheduledTime).getTime() - new Date(current.scheduledTime).getTime();
      
      // Look up typical min turnaround for this berth (defaulting to 3 hours/180 mins)
      const stats = berthStatsMap[berth];
      const minTurnaroundMins = stats?.typicalMinTurnaroundMinutes ?? 180;
      const minTurnaroundMs = minTurnaroundMins * 60 * 1000;
      
      // Flag conflict if movements are closer than the typical minimum turnaround
      if (diffMs < minTurnaroundMs) {
        conflictBerths.add(berth);
        projectedDelays[next.id] = `Turnaround warning: Scheduled only ${Math.round(diffMs / 60000)}m after ${current.vesselName} (typical min is ${minTurnaroundMins}m)`;
      }
    }

    // High risk short-dwell detection: if arrival and departure of same vessel are too close
    items.forEach((item) => {
      // Find corresponding departure if this is arrival
      if (item.movementType === 'Arrival') {
        const departure = schedule.find((d: any) => d.vesselName === item.vesselName && d.movementType === 'Departure');
        if (departure) {
          const stayDuration = new Date(departure.scheduledTime).getTime() - new Date(item.scheduledTime).getTime();
          const stats = berthStatsMap[berth];
          // Use historical average dwell hours as a reference (fallback to 24h)
          const refDwellHours = stats?.avgDwellHours ?? 24;
          const warningThresholdMs = (refDwellHours * 0.5) * 60 * 60 * 1000; // Warning if less than 50% of typical average dwell

          if (stayDuration > 0 && stayDuration < warningThresholdMs) {
            projectedDelays[departure.id] = `Dwell warning: Dwell time is only ${parseFloat((stayDuration / (3600 * 1000)).toFixed(1))}h (normally ~${refDwellHours}h)`;
            conflictBerths.add(berth);
          }
        }
      }
    });
  });

  // Group movements into stays/visits
  interface VesselVisit {
    id: string | number;
    vesselName: string;
    berth: string;
    arrivalTime: Date;
    departureTime: Date;
    arrivalRecord: any;
    departureRecord: any;
    isEstimated: boolean;
    isShift: boolean;
  }

  const berthVisits: Record<string, VesselVisit[]> = {};
  
  // Initialize for all known berths
  Object.keys(berthCoordinates).forEach(berth => {
    berthVisits[berth] = [];
  });

  // Group by berth
  const movementsByBerth: Record<string, any[]> = {};
  schedule.forEach((item: any) => {
    const isArrival = item.movementType === 'Arrival';
    const berth = isArrival ? item.destination : item.origin;
    if (berth && berthVisits[berth]) {
      if (!movementsByBerth[berth]) movementsByBerth[berth] = [];
      movementsByBerth[berth].push(item);
    }
  });

  Object.entries(movementsByBerth).forEach(([berth, items]) => {
    items.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
    
    const processedIds = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (processedIds.has(item.id)) continue;

      const stats = berthStatsMap[berth];
      const estDwellHours = stats?.avgDwellHours ?? 18;

      if (item.movementType === 'Arrival') {
        // Find corresponding departure
        const depIndex = items.findIndex((d, idx) => idx > i && d.vesselName === item.vesselName && d.movementType === 'Departure');
        if (depIndex !== -1) {
          const departure = items[depIndex];
          berthVisits[berth].push({
            id: `visit-${item.id}-${departure.id}`,
            vesselName: item.vesselName,
            berth,
            arrivalTime: new Date(item.scheduledTime),
            departureTime: new Date(departure.scheduledTime),
            arrivalRecord: item,
            departureRecord: departure,
            isEstimated: false,
            isShift: false,
          });
          processedIds.add(item.id);
          processedIds.add(departure.id);
        } else {
          // No corresponding departure: estimate stay based on typical berth dwell time
          const arrTime = new Date(item.scheduledTime);
          const depTime = new Date(arrTime.getTime() + estDwellHours * 60 * 60 * 1000);
          berthVisits[berth].push({
            id: `visit-${item.id}-est`,
            vesselName: item.vesselName,
            berth,
            arrivalTime: arrTime,
            departureTime: depTime,
            arrivalRecord: item,
            departureRecord: null,
            isEstimated: true,
            isShift: false,
          });
          processedIds.add(item.id);
        }
      } else if (item.movementType === 'Departure') {
        // Departure without prior arrival in the list: estimate arrival based on typical berth dwell time
        const depTime = new Date(item.scheduledTime);
        const arrTime = new Date(depTime.getTime() - estDwellHours * 60 * 60 * 1000);
        berthVisits[berth].push({
          id: `visit-${item.id}-est`,
          vesselName: item.vesselName,
          berth,
          arrivalTime: arrTime,
          departureTime: depTime,
          arrivalRecord: null,
          departureRecord: item,
          isEstimated: true,
          isShift: false,
        });
        processedIds.add(item.id);
      } else {
        // Shift or Shift-destination
        const schedTime = new Date(item.scheduledTime);
        berthVisits[berth].push({
          id: `visit-${item.id}-shift`,
          vesselName: item.vesselName,
          berth,
          arrivalTime: new Date(schedTime.getTime() - 2 * 60 * 60 * 1000),
          departureTime: new Date(schedTime.getTime() + 2 * 60 * 60 * 1000),
          arrivalRecord: item,
          departureRecord: null,
          isEstimated: true,
          isShift: true,
        });
        processedIds.add(item.id);
      }
    }
  });

  const getTimelineCoords = (arrivalTime: Date, departureTime: Date) => {
    const tStart = new Date(currentTime.getTime() - 12 * 60 * 60 * 1000).getTime();
    const tEnd = new Date(currentTime.getTime() + 36 * 60 * 60 * 1000).getTime();
    const totalDuration = tEnd - tStart;

    const startMs = arrivalTime.getTime();
    const endMs = departureTime.getTime();

    // Calculate left offset percentage
    let left = ((startMs - tStart) / totalDuration) * 100;
    // Calculate width percentage
    let width = ((endMs - startMs) / totalDuration) * 100;

    // Clamp values so they don't bleed out of the timeline box
    if (left < 0) {
      width = width + left; // decrease width by how much it's cut off on the left
      left = 0;
    }
    if (left + width > 100) {
      width = 100 - left;
    }

    // Return visible boolean, left and width
    return {
      visible: width > 0 && left < 100,
      left: `${left}%`,
      width: `${width}%`
    };
  };

  const getTimelineRulerTicks = () => {
    const ticks = [];
    const tStart = new Date(currentTime.getTime() - 12 * 60 * 60 * 1000);
    // Round to nearest 6 hour interval to align nicely
    const startHour = Math.floor(tStart.getHours() / 6) * 6;
    const rulerStart = new Date(tStart.getFullYear(), tStart.getMonth(), tStart.getDate(), startHour);

    for (let i = 0; i <= 48; i += 6) {
      const tickDate = new Date(rulerStart.getTime() + i * 60 * 60 * 1000);
      const tStartMs = new Date(currentTime.getTime() - 12 * 60 * 60 * 1000).getTime();
      const tEndMs = new Date(currentTime.getTime() + 36 * 60 * 60 * 1000).getTime();
      const pct = ((tickDate.getTime() - tStartMs) / (tEndMs - tStartMs)) * 100;
      if (pct >= 0 && pct <= 100) {
        ticks.push({
          label: format(tickDate, 'ccc HH:mm'),
          percent: pct
        });
      }
    }
    return ticks;
  };

  // Calculations for KPI summary cards
  const next24h = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);

  const vesselsInPortCount = schedule.filter((s: any) =>
    s.movementType === 'Departure' &&
    new Date(s.scheduledTime) > currentTime &&
    s.status === 'In Port: Yes'
  ).length;

  const arrivals24hCount = schedule.filter((s: any) =>
    s.movementType === 'Arrival' &&
    new Date(s.scheduledTime) > currentTime &&
    new Date(s.scheduledTime) < next24h
  ).length;

  const departures24hCount = schedule.filter((s: any) =>
    s.movementType === 'Departure' &&
    new Date(s.scheduledTime) > currentTime &&
    new Date(s.scheduledTime) < next24h
  ).length;

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex font-sans">
      
      {/* 1. Left Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-800 bg-[#070b19]/60 backdrop-blur-md flex flex-col p-6 hidden md:flex">
        <div className="flex items-center gap-3 mb-8">
          <Anchor className="w-8 h-8 text-cyan-400 animate-pulse" />
          <div>
            <h2 className="text-lg font-black tracking-wider text-white">PORT RADAR</h2>
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Newcastle Harbour</span>
          </div>
        </div>

        <nav className="space-y-1.5 flex-1">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
              activeTab === 'dashboard' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-cyan-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
            }`}
          >
            <Compass className="w-4 h-4" />
            Control Center
          </button>

          <button 
            onClick={() => setActiveTab('feed')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
              activeTab === 'feed' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-cyan-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
            }`}
          >
            <History className="w-4 h-4" />
            Schedule Feed
          </button>
          
          <button 
            onClick={() => setActiveTab('radar')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
              activeTab === 'radar' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-cyan-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
            }`}
          >
            <Activity className="w-4 h-4" />
            Vessel Radar Map
          </button>

          <button 
            onClick={() => setActiveTab('timeline')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
              activeTab === 'timeline' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-cyan-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
            }`}
          >
            <Clock className="w-4 h-4" />
            Berth Planner
          </button>

          <button 
            onClick={() => setActiveTab('analytics')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
              activeTab === 'analytics' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-cyan-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 border border-transparent'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            Port Analytics
          </button>
        </nav>

        <div className="pt-6 border-t border-slate-800 text-xs text-slate-500 font-mono">
          <p>System State: Live</p>
          <p className="mt-1">Telemetry: Connected</p>
        </div>
      </aside>

      {/* Main Workspace Workspace */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        
        {/* Header Clock / Title */}
        <header className="h-20 border-b border-slate-800/60 bg-[#030712]/40 backdrop-blur-md px-6 md:px-8 flex items-center justify-between z-10">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Newcastle Port Control <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest font-mono">SAUCS v2</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Real-time maritime operational dashboard</p>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-mono font-bold text-white">{format(currentTime, 'HH:mm:ss')} AEST</div>
              <div className="text-[10px] text-slate-500">{format(currentTime, 'EEEE, dd MMM yyyy')}</div>
            </div>
            <a href="/" className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
              ← Back to Old Site
            </a>
          </div>
        </header>

        {/* Content Workspace scrollable */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
          
          {/* KPI Analytics Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Vessels in Port" count={vesselsInPortCount.toString()} subtitle="Active vessels at berth" icon={<Anchor className="text-blue-400" />} />
            <KpiCard title="Arrivals (24h)" count={arrivals24hCount.toString()} subtitle="Incoming voyages" icon={<ArrowRight className="text-emerald-400" />} />
            <KpiCard title="Departures (24h)" count={departures24hCount.toString()} subtitle="Outgoing voyages" icon={<ArrowRight className="text-orange-400" />} />
            <KpiCard title="Berth Conflicts" count={conflictBerths.size.toString()} subtitle="Delays/turnarounds projected" icon={<AlertTriangle className="text-amber-400" />} />
          </div>

          {/* TAB 1: CONTROL CENTER */}
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left 2/3: Live Map & Gantt Timeline */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Vessel Radar Map */}
                <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Compass className="w-5 h-5 text-cyan-400" />
                      Vessel Radar Map
                    </h3>
                    <span className="text-xs text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700">Stockton Channel</span>
                  </div>

                  <div className="w-full h-80 bg-[#070b19]/60 rounded-xl relative overflow-hidden flex items-center justify-center border border-slate-800">
                    <svg className="w-full h-full opacity-60" viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M 50 150 Q 300 200 400 120 T 750 220 L 800 250 L 800 400 L 0 400 Z" fill="#0c1d3a" />
                      
                      {/* Draw Berth Rectangles */}
                      {Object.entries(berthCoordinates).map(([name, coords]) => (
                        <rect 
                          key={name}
                          x={coords.x}
                          y={coords.y}
                          width="24"
                          height="6"
                          fill={conflictBerths.has(name) ? "#f59e0b" : "#3b82f6"}
                          className="opacity-70"
                          rx="1"
                        />
                      ))}
                    </svg>

                    {/* Plot Real Vessels on the Map dynamically */}
                    {schedule.slice(0, 15).map((vessel: any) => {
                      const isArrival = vessel.movementType === 'Arrival';
                      const berth = isArrival ? vessel.destination : vessel.origin;
                      const coords = berth ? berthCoordinates[berth] : null;

                      if (!coords) return null;

                      // Stagger slightly if multiple vessels are at same coordinates
                      const xOffset = vessel.movementType === 'Arrival' ? 10 : -10;
                      const hasConflict = projectedDelays[vessel.id];

                      return (
                        <div 
                          key={vessel.id}
                          style={{ left: `${coords.x + xOffset}px`, top: `${coords.y - 10}px` }}
                          className="absolute group cursor-pointer"
                          onClick={() => setSelectedVessel(vessel)}
                        >
                          <span className="relative flex h-3 w-3">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                              hasConflict ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}></span>
                            <span className={`relative inline-flex rounded-full h-3 w-3 ${
                              hasConflict ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}></span>
                          </span>
                          
                          <div className="absolute left-6 -top-2 bg-[#0b1329] border border-slate-700 text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                            {vessel.vesselName} ({vessel.movementType})
                          </div>
                        </div>
                      );
                    })}

                    <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl text-xs flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span>Plotting real operational telemetry</span>
                    </div>
                  </div>
                </div>

                {/* Berth Timeline (Gantt Overview) */}
                <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Clock className="w-5 h-5 text-cyan-400" />
                      Berth Allocation Timeline
                    </h3>
                  </div>

                  <div className="space-y-3 bg-[#070b19]/60 rounded-xl p-4 border border-slate-800">
                    {/* Gantt Timeline Header Ruler */}
                    <div className="grid grid-cols-4 items-center gap-4 border-b border-slate-800 pb-2 mb-2">
                      <div className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">Berth</div>
                      <div className="col-span-3 h-5 relative">
                        {getTimelineRulerTicks().map((tick, idx) => (
                          <div
                            key={idx}
                            style={{ left: `${tick.percent}%` }}
                            className="absolute -top-1 transform -translate-x-1/2 flex flex-col items-center"
                          >
                            <span className="text-[8px] text-slate-500 font-mono">{tick.label.split(' ')[1]}</span>
                            <div className="w-px h-1 bg-slate-850" />
                          </div>
                        ))}
                      </div>
                    </div>

                    {Object.entries(berthVisits)
                      .filter(([_, visits]) => visits.length > 0)
                      .slice(0, 5)
                      .map(([berth, visits]) => {
                        return (
                          <div key={berth} className="grid grid-cols-4 items-center gap-4 py-2 border-b border-slate-800/40 last:border-b-0">
                            <div className="text-[10px] font-bold text-slate-400 truncate" title={berth}>
                              {berth.replace('Kooragang', 'K').replace('East Basin', 'EB').replace('West Basin', 'WB').replace('Mayfield', 'M')}
                            </div>
                            <div className="col-span-3 h-8 bg-slate-950/40 rounded-lg relative border border-slate-850/60">
                              
                              {/* Background hour grid lines */}
                              {getTimelineRulerTicks().map((tick, idx) => (
                                <div
                                  key={idx}
                                  style={{ left: `${tick.percent}%` }}
                                  className="absolute top-0 bottom-0 w-px bg-slate-800/20"
                                />
                              ))}

                              {visits.map((visit) => {
                                const coords = getTimelineCoords(visit.arrivalTime, visit.departureTime);
                                if (!coords.visible) return null;

                                const hasConflict = (visit.arrivalRecord && projectedDelays[visit.arrivalRecord.id]) ||
                                                    (visit.departureRecord && projectedDelays[visit.departureRecord.id]);

                                const delayText = (visit.arrivalRecord && projectedDelays[visit.arrivalRecord.id]) ||
                                                  (visit.departureRecord && projectedDelays[visit.departureRecord.id]);

                                return (
                                  <div
                                    key={visit.id}
                                    style={{ left: coords.left, width: coords.width }}
                                    className={`absolute top-1 bottom-1 rounded px-2 flex items-center text-[9px] font-bold text-white hover:z-20 justify-between border group/bar cursor-pointer ${
                                      hasConflict
                                        ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                                        : visit.isEstimated
                                          ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
                                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                                    }`}
                                  >
                                    <Link href={`/vessel/${encodeURIComponent(visit.vesselName)}`} className="hover:underline hover:text-cyan-300 truncate z-10 cursor-pointer">
                                      {visit.vesselName}
                                    </Link>

                                    {/* Tooltip on Hover */}
                                    <div className="hidden group-hover/bar:block absolute left-1/2 bottom-full mb-2 transform -translate-x-1/2 bg-slate-950 border border-slate-800 text-slate-200 text-[9px] p-2.5 rounded-lg shadow-xl w-52 z-30 pointer-events-none leading-normal font-sans font-medium">
                                      <div className="font-bold border-b border-slate-800 pb-1 mb-1 text-white flex justify-between">
                                        <span>{visit.vesselName}</span>
                                        {visit.isEstimated && <span className="text-cyan-400 text-[8px] font-normal uppercase">Estimated</span>}
                                      </div>
                                      <div className="space-y-0.5">
                                        <div>Arr: <span className="text-slate-400">{format(visit.arrivalTime, 'MMM d, HH:mm')}</span></div>
                                        <div>Dep: <span className="text-slate-400">{format(visit.departureTime, 'MMM d, HH:mm')}</span></div>
                                        {hasConflict && (
                                          <div className="text-rose-400 font-bold border-t border-rose-950/50 pt-1 mt-1">
                                            ⚠️ {delayText}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Right 1/3: Tide Gauge & Live Changes Feed */}
              <div className="space-y-6">
                
                {/* Simulated Tide Monitor Widget */}
                <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 relative overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Activity className="w-5 h-5 text-cyan-400" />
                      Tide Gauge Sensor
                    </h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                      tideState === 'Rising' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}>
                      {tideState}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <div className="text-4xl font-black text-white font-mono">{tideHeight.toFixed(2)}m</div>
                      <div className="text-xs text-slate-400 mt-1">Stockton Bridge (Live)</div>
                    </div>
                  </div>

                  <div className="h-16 bg-[#070b19]/60 rounded-xl relative overflow-hidden border border-slate-800 flex items-center justify-center">
                    <div 
                      style={{ height: `${Math.min(100, Math.max(0, ((tideHeight + 0.2) / 2.0) * 100))}%` }}
                      className="absolute bottom-0 left-0 right-0 bg-cyan-600/30 border-t border-cyan-400 transition-all duration-1000 ease-in-out"
                    />
                    <span className="relative text-xs text-cyan-300 font-mono font-bold z-10">
                      Water Level Status: {tideHeight > 1.0 ? 'High Water' : tideHeight < 0.3 ? 'Low Water' : 'Slack Water'}
                    </span>
                  </div>
                </div>

                {/* Live Change Log */}
                <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 flex flex-col">
                  <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    Live Schedule Feed
                  </h3>

                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                    {changes.slice(0, 10).map((change: any) => {
                      const isNew = change.changeType === 'NEW';
                      const isCompleted = change.changeType === 'COMPLETED';
                      const isRemoved = change.changeType === 'REMOVED';

                      return (
                        <div key={change.id} className={`p-3 rounded-lg border text-xs leading-normal ${
                          isCompleted ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300' :
                          isRemoved ? 'bg-rose-950/20 border-rose-500/20 text-rose-300' :
                          'bg-slate-900/60 border-slate-800 text-slate-300'
                        }`}>
                          <div className="font-bold flex justify-between">
                            <Link href={`/vessel/${encodeURIComponent(change.vesselName)}`} className="hover:underline hover:text-cyan-400 cursor-pointer">
                              {change.vesselName}
                            </Link>
                            <span className="opacity-60">{format(new Date(change.scrapedAt), 'HH:mm')}</span>
                          </div>
                          <div className="mt-1 font-mono">
                            {isNew ? 'New movement scheduled' : isCompleted ? 'Movement completed' : isRemoved ? 'Schedule removed/cancelled' : 'Schedule updated'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: DETAILED VESSEL RADAR MAP */}
          {activeTab === 'radar' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 relative">
                <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                  <Compass className="w-5 h-5 text-cyan-400" />
                  Full Screen Vessel Radar Map
                </h3>

                <div className="w-full h-[500px] bg-[#070b19]/60 rounded-xl relative overflow-hidden flex items-center justify-center border border-slate-800">
                  <svg className="w-full h-full opacity-60" viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M 50 150 Q 300 200 400 120 T 750 220 L 800 250 L 800 400 L 0 400 Z" fill="#0c1d3a" />
                    {Object.entries(berthCoordinates).map(([name, coords]) => (
                      <g key={name}>
                        <rect x={coords.x} y={coords.y} width="24" height="6" fill="#3b82f6" className="opacity-70" rx="1" />
                        <text x={coords.x} y={coords.y - 4} fill="#64748b" fontSize="6" className="font-mono">{name.replace('Kooragang', 'K')}</text>
                      </g>
                    ))}
                  </svg>

                  {schedule.map((vessel: any) => {
                    const isArrival = vessel.movementType === 'Arrival';
                    const berth = isArrival ? vessel.destination : vessel.origin;
                    const coords = berth ? berthCoordinates[berth] : null;

                    if (!coords) return null;

                    return (
                      <div 
                        key={vessel.id}
                        style={{ left: `${coords.x}px`, top: `${coords.y - 12}px` }}
                        className="absolute group cursor-pointer"
                        onClick={() => setSelectedVessel(vessel)}
                      >
                        <span className="relative flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Selected Vessel details */}
              <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6">
                <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                  <Anchor className="w-5 h-5 text-cyan-400" />
                  Vessel Details
                </h3>

                {selectedVessel ? (
                  <div className="space-y-4">
                    <div>
                      <span className="text-xs text-slate-500 uppercase tracking-widest block">Vessel Name</span>
                      <h4>
                        <Link href={`/vessel/${encodeURIComponent(selectedVessel.vesselName)}`} className="text-xl font-bold text-white hover:underline hover:text-cyan-400 cursor-pointer">
                          {selectedVessel.vesselName}
                        </Link>
                      </h4>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-slate-500 uppercase tracking-widest block">Movement</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          selectedVessel.movementType === 'Arrival' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'
                        }`}>{selectedVessel.movementType}</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 uppercase tracking-widest block">Status</span>
                        <span className="text-sm font-semibold text-slate-300">{selectedVessel.status || 'Scheduled'}</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-800 pt-4">
                      <span className="text-xs text-slate-500 uppercase tracking-widest block">Allocated Berth</span>
                      <span className="text-sm font-semibold text-slate-200">{selectedVessel.movementType === 'Arrival' ? selectedVessel.destination : selectedVessel.origin}</span>
                    </div>

                    <div className="border-t border-slate-800 pt-4">
                      <span className="text-xs text-slate-500 uppercase tracking-widest block">Scheduled Time</span>
                      <span className="text-sm font-semibold text-slate-200">{format(new Date(selectedVessel.scheduledTime), 'MMM d, HH:mm')}</span>
                    </div>

                    {projectedDelays[selectedVessel.id] && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-2 text-xs text-amber-400 leading-normal">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">Projected Schedule Risk</div>
                          <div className="mt-1">{projectedDelays[selectedVessel.id]}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Select a vessel dot on the map to inspect live schedule projections.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DEDICATED BERTH PLANNER TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-6">
              
              {/* Header and Legend */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    Operational Berth Planner
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">48-hour timeline view of vessel stays, arrivals, departures, and transits.</p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[10px] bg-slate-900/40 p-2.5 border border-slate-800 rounded-xl">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500/15 border border-emerald-500/30" /> <span className="text-slate-300">Scheduled Visit</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-cyan-500/10 border border-cyan-500/20" /> <span className="text-slate-300">Estimated Stay</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-amber-500/10 border border-amber-500/30" /> <span className="text-slate-300">Transit/Shift</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-rose-500/20 border border-rose-500" /> <span className="text-rose-400">Schedule Conflict</span></div>
                </div>
              </div>

              {/* Scrollable Timeline Grid */}
              <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-[#070b19]/60 backdrop-blur-md">
                <div className="min-w-[1200px] flex flex-col">
                  
                  {/* Timeline Header Row (Ruler) */}
                  <div className="flex border-b border-slate-800/80 h-10 items-center">
                    <div className="w-48 flex-shrink-0 bg-slate-900/60 border-r border-slate-800 p-3 font-bold text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                      Berth ID
                    </div>
                    <div className="flex-1 relative h-full">
                      {getTimelineRulerTicks().map((tick, idx) => (
                        <div
                          key={idx}
                          style={{ left: `${tick.percent}%` }}
                          className="absolute bottom-0 transform -translate-x-1/2 flex flex-col items-center"
                        >
                          <span className="text-[8px] text-slate-400 font-mono font-semibold mb-1">{tick.label}</span>
                          <div className="w-px h-1.5 bg-slate-700" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Berth Tracks */}
                  <div className="divide-y divide-slate-800/40">
                    {(Object.keys(berthCoordinates) as BerthName[]).map((berthName) => {
                      const visits = berthVisits[berthName] || [];
                      const isConflict = conflictBerths.has(berthName);

                      return (
                        <div key={berthName} className="flex h-14 hover:bg-slate-900/10">
                          {/* Berth Label */}
                          <div className={`w-48 flex-shrink-0 border-r border-slate-800 p-3 flex flex-col justify-center ${
                            isConflict ? 'bg-amber-500/5' : 'bg-slate-900/20'
                          }`}>
                            <span className="text-xs font-bold text-slate-200 truncate">{berthName}</span>
                            <span className="text-[9px] text-slate-500 tracking-wider mt-0.5">{berthTypes[berthName]}</span>
                          </div>

                          {/* Timeline Track */}
                          <div className="flex-1 relative bg-slate-950/10">
                            {/* Vertical hour grid lines */}
                            {getTimelineRulerTicks().map((tick, idx) => (
                              <div
                                key={idx}
                                style={{ left: `${tick.percent}%` }}
                                className="absolute top-0 bottom-0 w-px bg-slate-850/30"
                              />
                            ))}

                            {/* Plotted visits */}
                            {visits.length === 0 ? (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[9px] text-slate-700 uppercase font-mono tracking-widest">Vacant</span>
                              </div>
                            ) : (
                              visits.map((visit) => {
                                const coords = getTimelineCoords(visit.arrivalTime, visit.departureTime);
                                if (!coords.visible) return null;

                                const hasConflict = (visit.arrivalRecord && projectedDelays[visit.arrivalRecord.id]) ||
                                                    (visit.departureRecord && projectedDelays[visit.departureRecord.id]);

                                const delayText = (visit.arrivalRecord && projectedDelays[visit.arrivalRecord.id]) ||
                                                  (visit.departureRecord && projectedDelays[visit.departureRecord.id]);

                                return (
                                  <div
                                    key={visit.id}
                                    style={{ left: coords.left, width: coords.width }}
                                    className={`absolute top-2 bottom-2 rounded-lg px-3 flex items-center text-[10px] font-bold text-white hover:z-20 justify-between border shadow-sm transition-all group/bar cursor-pointer ${
                                      hasConflict
                                        ? 'bg-rose-500/20 border-rose-500 text-rose-300 hover:bg-rose-500/30'
                                        : visit.isShift
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                                          : visit.isEstimated
                                            ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/20'
                                            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/25'
                                    }`}
                                  >
                                    <Link href={`/vessel/${encodeURIComponent(visit.vesselName)}`} className="hover:underline truncate z-10 mr-1">
                                      {visit.vesselName}
                                    </Link>
                                    {visit.isEstimated && (
                                      <span className="text-[8px] opacity-40 font-mono flex-shrink-0">EST</span>
                                    )}
                                    {hasConflict && (
                                      <span className="text-rose-400 text-[10px] flex-shrink-0">⚠️</span>
                                    )}

                                    {/* Tooltip on Hover */}
                                    <div className="hidden group-hover/bar:block absolute left-1/2 bottom-full mb-2 transform -translate-x-1/2 bg-slate-950 border border-slate-800 text-slate-200 text-[10px] p-3 rounded-xl shadow-xl w-60 z-30 pointer-events-none leading-normal">
                                      <div className="font-bold border-b border-slate-800 pb-1 mb-1.5 text-white flex justify-between">
                                        <span>{visit.vesselName}</span>
                                        {visit.isEstimated && <span className="text-cyan-400 text-[9px] font-normal uppercase">Estimated Stay</span>}
                                      </div>
                                      <div className="space-y-1">
                                        <div>Arrival: <span className="text-slate-400">{format(visit.arrivalTime, 'MMM d, HH:mm')}</span></div>
                                        <div>Departure: <span className="text-slate-400">{format(visit.departureTime, 'MMM d, HH:mm')}</span></div>
                                        {delayText && (
                                          <div className="text-rose-400 font-medium border-t border-rose-950/50 pt-1 mt-1">
                                            ⚠️ {delayText}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PORT ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              
              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Average Agent On-Time Rate</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-cyan-400">
                    {agentStats.length > 0
                      ? `${(agentStats.reduce((acc: number, cur: any) => acc + cur.onTimePercentage, 0) / agentStats.length).toFixed(1)}%`
                      : '100%'}
                  </h4>
                  <span className="text-[10px] text-emerald-400 mt-1 block">✓ High overall agent reliability</span>
                </div>
                <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Average Schedule Drift</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-amber-400">
                    {driftStats.averageDriftMinutes > 0 ? `${driftStats.averageDriftMinutes}m` : '0m'}
                  </h4>
                  <span className="text-[10px] text-slate-500 mt-1 block">Average timeline adjustment</span>
                </div>
                <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Max Single Delay</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-rose-400">
                    {driftStats.maxDriftMinutes > 0 ? `${parseFloat((driftStats.maxDriftMinutes / 60).toFixed(1))}h` : '0h'}
                  </h4>
                  <span className="text-[10px] text-slate-500 mt-1 block">Worst scheduled delay deviation</span>
                </div>
                <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Most Active Berth</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-blue-400">
                    {berthStats.length > 0 ? berthStats[0].berth.split(' (')[0] : 'Kooragang 4'}
                  </h4>
                  <span className="text-[10px] text-slate-500 mt-1 block">Highest volume in last 28 days</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Agent Performance Leaderboard */}
                <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
                  <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                    <BarChart2 className="w-5 h-5 text-cyan-400" />
                    Agent Reliability Index
                  </h3>
                  
                  <div className="overflow-y-auto max-h-[300px] pr-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500 tracking-wider">
                          <th className="pb-3 font-semibold">Agent</th>
                          <th className="pb-3 font-semibold text-right">Voyages</th>
                          <th className="pb-3 font-semibold text-right">On-Time</th>
                          <th className="pb-3 font-semibold text-right">Avg Arr.</th>
                          <th className="pb-3 font-semibold text-right">Avg Dep.</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs divide-y divide-slate-800/40">
                        {agentStats.map((item: any) => (
                          <tr key={item.agent} className="hover:bg-slate-800/10">
                            <td className="py-3 font-bold text-slate-200">{item.agent}</td>
                            <td className="py-3 text-right text-slate-300">{item.totalVoyages}</td>
                            <td className="py-3 text-right text-emerald-400 font-mono font-bold">{item.onTimePercentage}%</td>
                            <td className="py-3 text-right text-slate-400">{item.avgArrivalDelayMinutes > 0 ? `${item.avgArrivalDelayMinutes}m` : '-'}</td>
                            <td className="py-3 text-right text-slate-400">{item.avgDepartureDelayMinutes > 0 ? `${item.avgDepartureDelayMinutes}m` : '-'}</td>
                          </tr>
                        ))}
                        {agentStats.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-slate-500">No agent data yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Berth Dwell & Delay Chart */}
                <div className="lg:col-span-2 p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                  <h3 className="font-bold text-white flex items-center gap-2 mb-6">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    Average Vessel Dwell Time by Berth (Hours)
                  </h3>

                  <div className="w-full h-80">
                    {berthStats.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={berthStats.slice(0, 10)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" vertical={false} />
                          <XAxis
                            dataKey="berth"
                            stroke="#9ca3af"
                            fontSize={10}
                            tickFormatter={(value: string) => value.split(' (')[0].replace('Kooragang', 'K')}
                          />
                          <YAxis stroke="#9ca3af" fontSize={11} unit="h" />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-[#1e293b] border border-slate-700 p-3 rounded-lg shadow-xl text-xs space-y-1">
                                    <p className="font-bold text-slate-200">{label}</p>
                                    <p className="text-cyan-400">Avg Dwell: <span className="font-mono font-bold text-white">{data.avgDwellHours}h</span></p>
                                    <p className="text-amber-400">Typical Min Turnaround: <span className="font-mono font-bold text-white">{(data.typicalMinTurnaroundMinutes / 60).toFixed(1)}h</span> ({data.typicalMinTurnaroundMinutes}m)</p>
                                    <p className="text-slate-400">Avg Turnaround: <span className="font-mono font-bold text-white">{(data.avgTurnaroundMinutes / 60).toFixed(1)}h</span> ({data.avgTurnaroundMinutes}m)</p>
                                    <p className="text-slate-500 text-[10px] pt-1 border-t border-slate-800">Based on {data.totalMovements} movements</p>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Bar dataKey="avgDwellHours" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Avg Dwell Duration" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-500 text-xs">No berth dwell data available</div>
                    )}
                  </div>
                </div>

              </div>

              {/* SECTION: Berth Utilization & Agent Drift Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Berth Utilization Heatmap/Bar Chart */}
                <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                  <h3 className="font-bold text-white flex items-center gap-2 mb-6">
                    <Activity className="w-5 h-5 text-cyan-400" />
                    Berth Occupancy & Utilization Rate (7-Day Rolling)
                  </h3>

                  <div className="w-full h-80">
                    {berthUtilization.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={berthUtilization.slice(0, 10)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" vertical={false} />
                          <XAxis
                            dataKey="berth"
                            stroke="#9ca3af"
                            fontSize={10}
                            tickFormatter={(value: string) => value.split(' (')[0].replace('Kooragang', 'K').replace('East Basin', 'EB').replace('West Basin', 'WB').replace('Mayfield', 'M')}
                          />
                          <YAxis stroke="#9ca3af" fontSize={11} unit="%" />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                            itemStyle={{ color: '#e5e7eb' }}
                            labelStyle={{ color: '#9ca3af' }}
                          />
                          <Bar dataKey="utilizationPercentage" fill="#10b981" radius={[4, 4, 0, 0]} name="Utilization %" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-500 text-xs">No utilization data available</div>
                    )}
                  </div>
                </div>

                {/* Agent Schedule Drift Leaderboard */}
                <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
                  <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-cyan-400" />
                    Schedule Volatility by Agent (Last 30 Days)
                  </h3>
                  
                  <div className="overflow-y-auto max-h-[320px] pr-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500 tracking-wider">
                          <th className="pb-3 font-semibold">Agent</th>
                          <th className="pb-3 font-semibold text-right">Reschedules</th>
                          <th className="pb-3 font-semibold text-right">Avg Arr. Drift</th>
                          <th className="pb-3 font-semibold text-right">Avg Dep. Drift</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs divide-y divide-slate-800/40">
                        {driftStats.driftByAgent.map((item: any) => (
                          <tr key={item.agent} className="hover:bg-slate-800/10">
                            <td className="py-3 font-bold text-slate-200">{item.agent}</td>
                            <td className="py-3 text-right text-slate-300">{item.reschedules}</td>
                            <td className="py-3 text-right text-amber-400 font-mono font-bold">
                              {item.avgArrivalDriftMinutes > 0 ? `${item.avgArrivalDriftMinutes}m` : '-'}
                            </td>
                            <td className="py-3 text-right text-amber-400 font-mono font-bold">
                              {item.avgDepartureDriftMinutes > 0 ? `${item.avgDepartureDriftMinutes}m` : '-'}
                            </td>
                          </tr>
                        ))}
                        {driftStats.driftByAgent.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-slate-500">No volatility data yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* SECTION: Voyage Drift Distribution Scatter Plot */}
              <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                <h3 className="font-bold text-white flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-cyan-400" />
                  Voyage Schedule Drift Distribution (Completed Voyages)
                </h3>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <p className="text-xs text-slate-400">
                    Each dot represents one completed voyage. Dots above 0h indicate arrivals/departures that completed late (delays); dots below 0h indicate early completions.
                  </p>
                  <div className="flex items-center gap-3 text-[10px] bg-slate-900/60 p-2 border border-slate-800 rounded-lg">
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" /> <span className="text-slate-300">Arrival</span></div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-[#f97316]" /> <span className="text-slate-300">Departure</span></div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-[#a855f7]" /> <span className="text-slate-300">Shift</span></div>
                  </div>
                </div>

                <div className="w-full h-80">
                  {driftStats.completedVoyages && driftStats.completedVoyages.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                        <XAxis 
                          dataKey="completedAtMs" 
                          type="number"
                          domain={['auto', 'auto']}
                          name="Completed Date" 
                          stroke="#9ca3af" 
                          fontSize={11}
                          tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        />
                        <YAxis 
                          dataKey="driftHours" 
                          name="Total Drift" 
                          unit="h" 
                          stroke="#9ca3af" 
                          fontSize={11}
                        />
                        <ReferenceLine y={0} stroke="#475569" strokeDasharray="5 5" />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#9ca3af' }}
                          itemStyle={{ color: '#e5e7eb' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              const isDelay = data.driftHours > 0;
                              const isEarly = data.driftHours < 0;
                              const movementColorsMap: Record<string, string> = {
                                Arrival: '#3b82f6',
                                Departure: '#f97316',
                                Shift: '#a855f7'
                              };
                              const color = movementColorsMap[data.movementType] || '#38bdf8';
                              return (
                                <div className="bg-[#111827] border border-slate-700 p-3 rounded-lg text-xs leading-normal font-sans shadow-xl">
                                  <div className="font-bold text-slate-200 flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                    {data.vesselName} ({data.movementType})
                                  </div>
                                  <div className="text-[10px] text-slate-500 mt-0.5">Completed: {new Date(data.completedAt).toLocaleString()}</div>
                                  <div className={`mt-2 font-bold font-mono ${isDelay ? 'text-rose-400' : isEarly ? 'text-emerald-400' : 'text-slate-300'}`}>
                                    {isDelay ? `⚠️ Delayed by ${data.driftHours} hours` : isEarly ? `✓ Early by ${Math.abs(data.driftHours)} hours` : 'On Time'}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter 
                          name="Voyages" 
                          data={driftStats.completedVoyages.map((v: any) => ({ ...v, completedAtMs: new Date(v.completedAt).getTime() }))} 
                          className="cursor-pointer"
                        >
                          {driftStats.completedVoyages.map((entry: any, index: number) => {
                            const movementColorsMap: Record<string, string> = {
                              Arrival: '#3b82f6',
                              Departure: '#f97316',
                              Shift: '#a855f7'
                            };
                            return (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={movementColorsMap[entry.movementType] || '#38bdf8'} 
                              />
                            );
                          })}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-xs">No completed voyage drift distribution data available</div>
                  )}
                </div>
              </div>

              {/* Daily Throughput Chart */}
              <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                <h3 className="font-bold text-white flex items-center gap-2 mb-6">
                  <BarChart2 className="w-5 h-5 text-cyan-400" />
                  Daily Port Throughput & Completions (Last 28 Days)
                </h3>

                <div className="w-full h-80">
                  {stats.length > 0 ? (
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
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Completed Movements" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-xs">No analytics data available</div>
                  )}
                </div>
              </div>

            </div>
          )}


          {activeTab === 'feed' && (
            <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 max-w-4xl mx-auto">
              <Feed />
            </div>
          )}

        </main>
      </div>

    </div>
  );
}

function KpiCard({ title, count, subtitle, icon }: { title: string; count: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6 flex items-center justify-between hover:border-slate-700/80 transition-colors">
      <div>
        <span className="text-xs text-slate-400 font-medium">{title}</span>
        <h4 className="text-3xl font-black text-white mt-1 font-mono">{count}</h4>
        <span className="text-[10px] text-slate-500 block mt-1">{subtitle}</span>
      </div>
      <div className="p-3 bg-slate-900/60 rounded-xl">
        {icon}
      </div>
    </div>
  );
}
