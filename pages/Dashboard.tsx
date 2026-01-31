
import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, AreaChart, Area 
} from 'recharts';

const mockChartData = [
  { name: 'Mon', items: 12 },
  { name: 'Tue', items: 19 },
  { name: 'Wed', items: 15 },
  { name: 'Thu', items: 22 },
  { name: 'Fri', items: 30 },
  { name: 'Sat', items: 25 },
  { name: 'Sun', items: 32 },
];

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    published: 84,
    pool: 412,
    lastSync: '15 mins ago',
    errors: 0,
    estimatedVat: 1245.50
  });

  const [isLoading, setIsLoading] = useState(false);

  const runJob = async (type: string) => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      alert(`${type} job triggered successfully!`);
    }, 1500);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Dashboard</h1>
          <p className="text-slate-500">Real-time monitoring of reselling operations</p>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={() => runJob('Ingest')}
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition shadow-sm disabled:opacity-50"
          >
            <i className={`fa-solid fa-download mr-2 ${isLoading ? 'animate-spin' : ''}`}></i>
            Run Ingest
          </button>
          <button 
            onClick={() => runJob('Sync')}
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition shadow-sm disabled:opacity-50"
          >
            <i className={`fa-solid fa-sync mr-2 ${isLoading ? 'animate-spin' : ''}`}></i>
            Run Sync
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Published Products" value={stats.published} subValue="84% of target" icon="fa-box" color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="Approved Pool" value={stats.pool} subValue="+12 today" icon="fa-database" color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard label="Last Sync" value={stats.lastSync} subValue="Status: OK" icon="fa-clock" color="text-amber-600" bg="bg-amber-50" />
        <StatCard label="Est. VAT (Margin)" value={`£${stats.estimatedVat.toLocaleString()}`} subValue="Accrued this month" icon="fa-calculator" color="text-slate-600" bg="bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-semibold mb-6">Inventory Growth</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockChartData}>
                <defs>
                  <linearGradient id="colorItems" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="items" stroke="#4f46e5" fillOpacity={1} fill="url(#colorItems)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-semibold mb-6">Category Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'Watches', count: 35 },
                { name: 'Handbags', count: 28 },
                { name: 'Jewellery', count: 21 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, subValue, icon, color, bg }: any) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start space-x-4">
    <div className={`${bg} ${color} p-3 rounded-lg`}>
      <i className={`fa-solid ${icon} text-xl`}></i>
    </div>
    <div>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <h3 className="text-2xl font-bold text-slate-900 mt-1">{value}</h3>
      <p className="text-xs text-slate-400 mt-1">{subValue}</p>
    </div>
  </div>
);

export default Dashboard;
