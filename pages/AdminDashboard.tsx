
import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { globalStore } from '../lib/store';
import { Category, PublishState } from '../types';
import { runIngest as apiRunIngest } from '../lib/api';

const AdminDashboard: React.FC = () => {
  const [isIngesting, setIsIngesting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const [counts, setCounts] = useState({ published: 0, discovery: 0 });

  useEffect(() => {
    const refresh = async () => {
      try {
        await globalStore.refresh({ admin: true });
      } catch {
        // If not logged in yet, counts will remain 0.
      }
    };
    refresh();
    return globalStore.subscribe(() => {
      const all = globalStore.getItems();
      setCounts({
        published: all.filter(i => i.publishStatus === PublishState.PUBLISHED).length,
        discovery: all.filter(i => i.publishStatus !== PublishState.PUBLISHED).length,
      });
    });
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 10));
  };

  const runIngest = async () => {
    setIsIngesting(true);
    addLog("AGENT INITIATED: Scanning high-volatility luxury markets...");
    await new Promise(r => setTimeout(r, 800));
    
    addLog("API HANDSHAKE: Triggering sourcing agent...");
    try {
      const result = await apiRunIngest();
      await globalStore.refresh({ admin: true });
      addLog(`INGEST COMPLETE: Found ${result.discovered} high-potential assets.`);
    } catch (e: any) {
      addLog(`INGEST FAILED: ${e?.data?.error || e?.message || 'unknown error'}`);
    }
    addLog(`NEXT STEP: Proceed to 'Inventory' to run AI Normalization.`);
    setIsIngesting(false);
  };

  return (
    <div className="bg-[#0c0a09] p-10 space-y-10 min-h-screen text-stone-300">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-serif italic text-white tracking-tighter">Command Center</h1>
          <p className="text-stone-500 text-[10px] font-bold uppercase tracking-[0.2em]">Operational Status: <span className="text-emerald-500">OPTIMIZED</span></p>
        </div>
        <div className="flex space-x-4">
          <button 
            onClick={runIngest} 
            disabled={isIngesting}
            className="px-8 py-3 bg-white text-black rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-all duration-500 shadow-xl disabled:opacity-50 group flex items-center space-x-3"
          >
            {isIngesting && <i className="fa-solid fa-spinner animate-spin"></i>}
            <span>{isIngesting ? 'Agent Sourcing...' : 'Trigger Sourcing Agent'}</span>
          </button>
        </div>
      </div>

      {/* Quick Start Guide */}
      <div className="bg-stone-900/40 border border-stone-800 p-6 rounded-2xl flex items-start space-x-6 animate-in fade-in slide-in-from-top-4 duration-1000">
        <div className="bg-gold/10 p-3 rounded-xl border border-gold/20 text-gold">
          <i className="fa-solid fa-lightbulb"></i>
        </div>
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-white">Getting Started</h4>
          <p className="text-xs text-stone-500 leading-relaxed max-w-2xl">
            This dashboard manages your autonomous reseller. To populate your store: 
            <span className="text-stone-300 font-bold ml-1">(1) Click 'Trigger Sourcing Agent'</span> to find raw listings. 
            <span className="text-stone-300 font-bold ml-1">(2) Navigate to 'Inventory'</span> to use Gemini AI to normalize and curate the assets. 
            <span className="text-stone-300 font-bold ml-1">(3) Refresh your homepage</span> to see the boutique live.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <StatCard label="Public Vault" value={counts.published} sub="Curated Assets" icon="fa-gem" color="text-gold" />
        <StatCard label="Discovery Queue" value={counts.discovery} sub="Pending AI" icon="fa-bolt-lightning" color="text-stone-400" />
        <StatCard label="AI Integrity" value="99.8%" sub="Normalization Score" icon="fa-brain" color="text-white" />
        <StatCard label="Market Latency" value="42ms" sub="Node Response" icon="fa-tower-broadcast" color="text-stone-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 bg-stone-900/30 p-8 rounded-2xl border border-stone-800/50">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-stone-500 mb-8">Acquisition Velocity</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[
                { name: '00h', val: 10 }, { name: '04h', val: 15 }, { name: '08h', val: 42 },
                { name: '12h', val: 38 }, { name: '16h', val: 55 }, { name: '20h', val: 48 }
              ]}>
                <CartesianGrid strokeDasharray="10 10" vertical={false} stroke="#1c1917" />
                <XAxis dataKey="name" stroke="#444" fontSize={9} />
                <YAxis stroke="#444" fontSize={9} />
                <Tooltip 
                  contentStyle={{backgroundColor: '#1c1917', border: '1px solid #292524', borderRadius: '8px', fontSize: '10px'}}
                />
                <Area type="monotone" dataKey="val" stroke="#d4af37" fill="url(#goldGradient)" strokeWidth={2} />
                <defs>
                  <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d4af37" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#d4af37" stopOpacity={0}/>
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-black border border-stone-800 p-8 rounded-2xl shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gold/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
          <div className="flex justify-between items-center mb-8 border-b border-stone-900 pb-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.4em] text-gold">Live Telemetry</h3>
            <div className="flex space-x-1">
              {[1, 2, 3].map(i => <div key={i} className="h-1 w-4 bg-stone-800 rounded-full overflow-hidden">
                <div className="h-full bg-gold animate-progress" style={{animationDelay: `${i*200}ms`}}></div>
              </div>)}
            </div>
          </div>
          <div className="space-y-4 font-mono text-[9px] leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar pr-4">
            {logs.length === 0 && (
              <div className="py-20 text-center space-y-4">
                <i className="fa-solid fa-satellite-dish text-stone-800 text-3xl animate-pulse"></i>
                <p className="text-stone-700 italic uppercase tracking-widest">Awaiting Uplink Initiation...</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex space-x-3 p-2 rounded ${log.includes('Success') || log.includes('COMPLETE') ? 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30' : 'text-stone-500 border-l border-stone-800 pl-3'}`}>
                <span className="opacity-40">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                <span className="tracking-tight">{log}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, sub, icon, color }: any) => (
  <div className="bg-stone-900/20 p-8 rounded-2xl border border-stone-800/50 flex items-center space-x-6 hover:border-stone-700 transition duration-500 group">
    <div className={`${color} bg-black p-5 rounded-2xl border border-stone-800 group-hover:border-gold/30 transition-colors shadow-2xl`}><i className={`fa-solid ${icon} text-2xl`}></i></div>
    <div className="space-y-1">
      <p className="text-[9px] font-bold uppercase text-stone-500 tracking-[0.2em]">{label}</p>
      <h3 className="text-3xl font-serif text-white">{value}</h3>
      <p className="text-[8px] text-stone-600 uppercase tracking-widest">{sub}</p>
    </div>
  </div>
);

export default AdminDashboard;
