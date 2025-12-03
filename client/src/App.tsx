
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Link } from 'wouter';
import { Feed } from './components/Feed';
import { LiveSchedule } from './components/LiveSchedule';
import { PublicStatus } from './pages/PublicStatus';

const queryClient = new QueryClient();

function Dashboard() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="mb-8 max-w-6xl mx-auto flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Newcastle Harbour <span className="text-primary">Schedule Monitor</span></h1>
          <p className="text-slate-400">Tracking vessel schedule changes in real-time.</p>
        </div>
        <Link href="/status">
          <a className="text-sm text-slate-500 hover:text-primary transition-colors">
            View Public Status Page →
          </a>
        </Link>
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
    <QueryClientProvider client={queryClient}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/status" component={PublicStatus} />
      </Switch>
    </QueryClientProvider>
  );
}

export default App;
