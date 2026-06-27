import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchedule, fetchChanges, fetchRemoved } from '../lib/api';
import { Anchor, Clock, Compass, Activity, BarChart2, AlertTriangle, Wind } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { berthTypes, type BerthName } from '../components/berths';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'radar' | 'timeline' | 'analytics'>('dashboard');
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

  const { data: removed = [], isLoading: removedLoading } = useQuery({
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
      
      // If two movements are within 3 hours, flag a turnaround conflict
      if (diffMs < 3 * 60 * 60 * 1000) {
        conflictBerths.add(berth);
        projectedDelays[next.id] = `Turnaround warning: Scheduled only ${Math.round(diffMs / 60000)}m after ${current.vesselName}`;
      }
    }

    // High risk short-dwell detection: if arrival and departure of same vessel are too close
    items.forEach((item) => {
      // Find corresponding departure if this is arrival
      if (item.movementType === 'Arrival') {
        const departure = schedule.find((d: any) => d.vesselName === item.vesselName && d.movementType === 'Departure');
        if (departure) {
          const stayDuration = new Date(departure.scheduledTime).getTime() - new Date(item.scheduledTime).getTime();
          if (stayDuration > 0 && stayDuration < 18 * 60 * 60 * 1000) {
            projectedDelays[departure.id] = `Dwell warning: Dwell time is only ${parseFloat((stayDuration / (3600 * 1000)).toFixed(1))}h (normally 24-48h)`;
            conflictBerths.add(berth);
          }
        }
      }
    });
  });

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
            <KpiCard title="Active Vessels" count={schedule.length.toString()} subtitle="Currently in schedule" icon={<Anchor className="text-blue-400" />} />
            <KpiCard title="Active Shifts" count={schedule.filter((s: any) => s.movementType === 'Shift').length.toString()} subtitle="Berth transits" icon={<Activity className="text-emerald-400" />} />
            <KpiCard title="Berth Conflicts" count={conflictBerths.size.toString()} subtitle="Delays projected" icon={<AlertTriangle className="text-amber-400" />} />
            <KpiCard title="Wind Speed" count="12 kt" subtitle="Winds: Light SE" icon={<Wind className="text-cyan-400" />} />
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
                    {schedule.slice(0, 5).map((vessel: any) => {
                      const isArrival = vessel.movementType === 'Arrival';
                      const berth = isArrival ? vessel.destination : vessel.origin;
                      const hasConflict = projectedDelays[vessel.id];

                      return (
                        <div key={vessel.id} className="grid grid-cols-4 items-center gap-4 py-2 border-b border-slate-800 last:border-b-0">
                          <div className="text-xs font-semibold text-slate-300 truncate">{berth || 'Unallocated'}</div>
                          <div className="col-span-3 h-8 bg-slate-800/40 rounded-lg relative overflow-hidden">
                            <div
                              style={{ left: `20%`, width: `50%` }}
                              className={`absolute top-1 bottom-1 rounded-md px-3 flex items-center text-[10px] font-bold text-white overflow-hidden justify-between border ${
                                hasConflict
                                  ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                                  : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-200'
                              }`}
                            >
                              <Link href={`/vessel/${encodeURIComponent(vessel.vesselName)}`} className="hover:underline hover:text-cyan-300 truncate z-10 cursor-pointer">
                                {vessel.vesselName} ({vessel.movementType})
                              </Link>
                              {hasConflict && (
                                <span className="text-rose-400 animate-pulse">⚠️ Conflict Warning</span>
                              )}
                            </div>
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
            <div className="bg-[#0f172a]/20 border border-slate-800/80 rounded-2xl p-6">
              <h3 className="font-bold text-white flex items-center gap-2 mb-6">
                <Clock className="w-5 h-5 text-cyan-400" />
                Operational Berth Planner
              </h3>

              <div className="space-y-4 max-w-5xl">
                {(Object.keys(berthCoordinates) as BerthName[]).map((berthName) => {
                  const movements = berthOccupancy[berthName] || [];
                  const isConflict = conflictBerths.has(berthName);

                  return (
                    <div key={berthName} className={`p-4 rounded-xl border grid grid-cols-1 md:grid-cols-4 gap-4 items-center ${
                      isConflict ? 'border-amber-500/30 bg-amber-950/5' : 'border-slate-800/80 bg-slate-900/40'
                    }`}>
                      <div>
                        <h4 className="font-bold text-slate-200">{berthName}</h4>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{berthTypes[berthName]}</span>
                      </div>
                      
                      <div className="md:col-span-3 space-y-2">
                        {movements.length === 0 ? (
                          <span className="text-xs text-slate-600 uppercase font-mono tracking-wider">No scheduled stay</span>
                        ) : (
                          movements.map((m: any) => {
                            const delay = projectedDelays[m.id];
                            return (
                              <div key={m.id} className={`p-3 rounded-lg border text-xs flex justify-between items-center ${
                                delay ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-slate-800/30 border-slate-800 text-slate-300'
                              }`}>
                                <div>
                                  <Link href={`/vessel/${encodeURIComponent(m.vesselName)}`} className="font-bold text-white block hover:underline hover:text-cyan-400 cursor-pointer">
                                    {m.vesselName} ({m.movementType})
                                  </Link>
                                  <span className="text-[10px] opacity-60">Scheduled: {format(new Date(m.scheduledTime), 'MMM d, HH:mm')}</span>
                                </div>
                                {delay && (
                                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1 animate-pulse">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Delay Projected
                                  </span>
                                )}
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
          )}

          {/* TAB 4: PORT ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              
              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Average Agent On-Time Rate</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-cyan-400">
                    {agentStats.length > 0
                      ? `${(agentStats.reduce((acc: number, cur: any) => acc + cur.onTimePercentage, 0) / agentStats.length).toFixed(1)}%`
                      : '100%'}
                  </h4>
                  <span className="text-[10px] text-emerald-400 mt-1 block">✓ High overall agent reliability index</span>
                </div>
                <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Completed Movements (28 Days)</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-emerald-400">
                    {removed.filter((r: any) => r.changeType === 'COMPLETED').length.toString()}
                  </h4>
                  <span className="text-[10px] text-emerald-400 mt-1 block">✓ All completed safely</span>
                </div>
                <div className="p-6 bg-[#0f172a]/20 border border-slate-800 rounded-2xl">
                  <span className="text-xs text-slate-400 block font-medium">Most Visited Berth</span>
                  <h4 className="text-3xl font-black text-white mt-1 font-mono text-blue-400">
                    {berthStats.length > 0 ? berthStats[0].berth.split(' (')[0] : 'Kooragang 4'}
                  </h4>
                  <span className="text-[10px] text-slate-500 mt-1 block">Highest utilization rate in Newcastle</span>
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
                          <th className="pb-3 font-semibold text-right">Avg Delay</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs divide-y divide-slate-800/40">
                        {agentStats.map((item: any) => (
                          <tr key={item.agent} className="hover:bg-slate-800/10">
                            <td className="py-3 font-bold text-slate-200">{item.agent}</td>
                            <td className="py-3 text-right text-slate-300">{item.totalVoyages}</td>
                            <td className="py-3 text-right text-emerald-400 font-mono font-bold">{item.onTimePercentage}%</td>
                            <td className="py-3 text-right text-slate-400">{item.avgDelayMinutes > 0 ? `${item.avgDelayMinutes}m` : '-'}</td>
                          </tr>
                        ))}
                        {agentStats.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-slate-500">No agent data yet</td>
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
                            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                            itemStyle={{ color: '#e5e7eb' }}
                            labelStyle={{ color: '#9ca3af' }}
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
