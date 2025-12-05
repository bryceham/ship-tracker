import { Link } from 'wouter';
import { LiveMap } from '../components/LiveMap';

export function LiveMapPage() {
    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <header className="mb-8 max-w-6xl mx-auto flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Live Vessel Map</h1>
                    <p className="text-slate-400">Real-time positions of vessels in and around Newcastle Harbour.</p>
                </div>
                <div className="flex gap-4">
                    <Link href="/">
                        <a className="text-sm text-slate-500 hover:text-primary transition-colors">
                            ← Back to Dashboard
                        </a>
                    </Link>
                </div>
            </header>

            <main className="max-w-6xl mx-auto">
                <LiveMap />
            </main>
        </div>
    );
}
