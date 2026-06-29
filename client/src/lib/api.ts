const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export async function fetchSchedule() {
    const res = await fetch(`${API_URL}/schedule`);
    if (!res.ok) throw new Error('Failed to fetch schedule');
    return res.json();
}

export async function fetchChanges() {
    const res = await fetch(`${API_URL}/changes`);
    if (!res.ok) throw new Error('Failed to fetch changes');
    return res.json();
}

export async function fetchRemoved() {
    const res = await fetch(`${API_URL}/removed`);
    if (!res.ok) throw new Error('Failed to fetch removed vessels');
    return res.json();
}

export async function fetchVesselHistory(vesselName: string) {
    const res = await fetch(`${API_URL}/vessel/${encodeURIComponent(vesselName)}/history`);
    if (!res.ok) throw new Error('Failed to fetch vessel history');
    return res.json();
}

export async function fetchDriftStats() {
    const res = await fetch(`${API_URL}/stats/drift`);
    if (!res.ok) throw new Error('Failed to fetch drift stats');
    return res.json();
}

export async function fetchBerthUtilization() {
    const res = await fetch(`${API_URL}/stats/berth-utilization`);
    if (!res.ok) throw new Error('Failed to fetch berth utilization stats');
    return res.json();
}

