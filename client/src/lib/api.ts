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
