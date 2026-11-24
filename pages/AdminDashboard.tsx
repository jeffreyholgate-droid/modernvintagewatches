
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { globalStore } from '../lib/store';
import { PublishState } from '../types';
import { runIngest as apiRunIngest } from '../lib/api';

const AdminDashboard: React.FC = () => {
  const [isIngesting, setIsIngesting] = useState(false);
  const [logs, setLogs] = useState<Array<{ message: string; time: string }>>([]);
  const [inventoryState, setInventoryState] = useState<'loading' | 'ready' | 'error'>('loading');

  const [counts, setCounts] = useState({ published: 0, discovery: 0, drafts: 0, reserved: 0 });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        await globalStore.refresh({ admin: true });
        if (alive) setInventoryState('ready');
      } catch {
        if (alive) setInventoryState('error');
      }
    };
    refresh();
    const unsubscribe = globalStore.subscribe(() => {
      if (!alive) return;
      const all = globalStore.getItems();
      setCounts({
        published: all.filter(i => i.publishStatus === PublishState.PUBLISHED).length,
        discovery: all.filter(i => i.publishStatus !== PublishState.PUBLISHED).length,
        drafts: all.filter(i => i.publishStatus === PublishState.DRAFT).length,
        reserved: all.filter(i => i.status === 'RESERVED').length,
      });
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [{ message: msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
  };

  const runIngest = async () => {
    setIsIngesting(true);
    addLog('Importing eBay listings…');
    try {
      const result = await apiRunIngest();
      await globalStore.refresh({ admin: true });
      setInventoryState('ready');
      addLog(`Import complete: ${result.discovered} candidates, ${result.upserted} new listings.`);
      addLog('New photos are waiting in the Curation Queue. Open Oak Study to process and approve each photograph before publishing.');
    } catch (e: any) {
      setInventoryState('error');
      addLog(`Import failed: ${e?.data?.error || 'check the connection and Audit Logs'}`);
    }
    setIsIngesting(false);
  };

  return (
    <div className="bg-[#0c0a09] p-10 space-y-10 min-h-screen text-stone-300">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-serif italic text-white tracking-tighter">Command Center</h1>
          <p className="text-stone-500 text-[10px] font-bold uppercase tracking-[0.2em]">Inventory: <span className={inventoryState === 'error' ? 'text-amber-400' : 'text-stone-300'}>{inventoryState === 'loading' ? 'Loading' : inventoryState === 'error' ? 'Unavailable — check database connection' : 'Loaded'}</span></p>
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
            Prepare your collection for review:
            <span className="text-stone-300 font-bold ml-1">(1) Click 'Trigger Sourcing Agent'</span> to find raw listings. 
            <span className="text-stone-300 font-bold ml-1">(2) Open the Curation Queue</span> to generate a description draft.
            <span className="text-stone-300 font-bold ml-1">(3) Review and publish</span> each listing after checking the source and description.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <StatCard label="Published" value={inventoryState === 'ready' ? counts.published : '—'} sub="Listings" icon="fa-gem" color="text-gold" />
        <StatCard label="Unpublished" value={inventoryState === 'ready' ? counts.discovery : '—'} sub="Listings" icon="fa-bolt-lightning" color="text-stone-400" />
        <StatCard label="Drafts" value={inventoryState === 'ready' ? counts.drafts : '—'} sub="Awaiting review" icon="fa-brain" color="text-white" />
        <StatCard label="Reserved" value={inventoryState === 'ready' ? counts.reserved : '—'} sub="Awaiting payment outcome" icon="fa-lock" color="text-stone-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 bg-stone-900/30 p-8 rounded-2xl border border-stone-800/50">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-stone-500 mb-8">Order review</h3>
          <p className="text-sm leading-relaxed">Checkout is restricted to test payments during recovery. Recorded payments wait for sourcing review; no eBay purchase or dispatch happens automatically.</p>
          <Link to="/admin/orders" className="inline-block mt-6 text-sm underline">View recorded orders</Link>
        </div>

        <div className="lg:col-span-5 bg-black border border-stone-800 p-8 rounded-2xl shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gold/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
          <div className="flex justify-between items-center mb-8 border-b border-stone-900 pb-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.4em] text-gold">This session</h3>
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
                <p className="text-stone-500">No import started in this session.</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex space-x-3 p-2 rounded text-stone-400 border-l border-stone-800 pl-3">
                <span className="opacity-40">[{log.time}]</span>
                <span className="tracking-tight">{log.message}</span>
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
