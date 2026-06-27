import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Link } from 'wouter';
import { Feed } from './components/Feed';
import { LiveSchedule } from './components/LiveSchedule';
import { PublicStatus } from './pages/PublicStatus';
import { NewDashboard } from './pages/NewDashboard';
import { VesselHistory } from './pages/VesselHistory';
import { ErrorBoundary } from './components/ErrorBoundary';

const queryClient = new QueryClient();

function Dashboard() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="mb-8 max-w-6xl mx-auto flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Newcastle Harbour <span className="text-primary">Schedule Monitor</span></h1>
          <p className="text-slate-400">Tracking vessel schedule changes in real-time.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/new">
            <a className="text-sm text-cyan-400 hover:text-cyan-300 font-bold transition-colors">
              Try New Dashboard Layout →
            </a>
          </Link>
          <span className="text-slate-700">|</span>
          <Link href="/status">
            <a className="text-sm text-slate-500 hover:text-primary transition-colors">
              View Public Status Page →
            </a>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 order-1 lg:order-1">
          <Feed />
        </div>
        <div className="lg:col-span-2 order-2 lg:order-2">
          <LiveSchedule />
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/status" component={PublicStatus} />
          <Route path="/new" component={NewDashboard} />
          <Route path="/vessel/:name">
            {(params) => <VesselHistory params={params} />}
          </Route>
        </Switch>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
