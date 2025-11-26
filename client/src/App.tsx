import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Feed } from './components/Feed';
import { LiveSchedule } from './components/LiveSchedule';
import { useWebSocket } from './lib/useWebSocket';
import { Clock } from 'lucide-react';

const queryClient = new QueryClient();

function App() {
  const { countdown, isConnected, onChangesDetected } = useWebSocket();

  // Format countdown as MM:SS
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <header className="mb-8 max-w-6xl mx-auto">
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-3xl font-bold text-white">Newcastle Harbour <span className="text-primary">Schedule Monitor</span></h1>
          </div>
          <p className="text-slate-400">Tracking vessel schedule changes in real-time.</p>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} title={isConnected ? 'Connected' : 'Disconnected'} />
            {isConnected && (<><Clock className="w-4 h-4 text-slate-400" />
              <span className="text-slate-300 font-mono">
                Next update: {formatCountdown(countdown)}
              </span></>)}
          </div>
        </header>

        <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 order-1 lg:order-1">
            <Feed onChangesDetected={onChangesDetected} />
          </div>
          <div className="lg:col-span-2 order-2 lg:order-2">
            <LiveSchedule onChangesDetected={onChangesDetected} />
          </div>
        </main>
      </div >
    </QueryClientProvider >
  );
}

export default App;
