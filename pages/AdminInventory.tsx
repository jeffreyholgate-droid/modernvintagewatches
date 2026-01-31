
import React, { useState, useEffect } from 'react';
import { globalStore, AppStateItem } from '../lib/store';
import { PublishState } from '../types';
import { runCurate, patchItem } from '../lib/api';

const AdminInventory: React.FC = () => {
  const [items, setItems] = useState<AppStateItem[]>([]);
  const [processingState, setProcessingState] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const init = async () => {
      try { await globalStore.refresh({ admin: true }); } catch {}
    };
    init();
    setItems(globalStore.getItems());
    return globalStore.subscribe(() => setItems(globalStore.getItems()));
  }, []);

  const handleExecuteWorkflow = async (item: AppStateItem) => {
    const id = item.id;
    try {
      setProcessingState(prev => ({ ...prev, [id]: 'AI NORMALIZING...' }));
      setProcessingState(prev => ({ ...prev, [id]: 'AGENT WORKING...' }));
      await runCurate(id);
      await globalStore.refresh({ admin: true });

      setProcessingState(prev => ({ ...prev, [id]: null }));
    } catch (err) {
      console.error(err);
      setProcessingState(prev => ({ ...prev, [id]: 'AI ERROR - RETRYING...' }));
      setTimeout(() => setProcessingState(prev => ({ ...prev, [id]: null })), 2000);
    }
  };

  const handleWithdraw = (id: string) => {
    patchItem(id, { publishStatus: PublishState.UNPUBLISHED })
      .then(() => globalStore.refresh({ admin: true }))
      .catch(() => {});
  };

  return (
    <div className="p-8 space-y-6 bg-stone-100 min-h-screen">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 uppercase tracking-tight">Curation Queue</h1>
          <p className="text-stone-500 text-sm">Reviewing {items.length} Discoveries</p>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-stone-200">
          <thead className="bg-stone-50">
            <tr>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Discovery</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Boutique Identity</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Score</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Price</th>
              <th className="px-6 py-3 text-right text-[10px] font-bold uppercase text-stone-400">Workflow</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 text-sm bg-white">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-stone-50 transition">
                <td className="px-6 py-4 max-w-xs">
                  <div className="text-[11px] font-medium text-stone-400 italic line-clamp-1">"{item.titleRaw}"</div>
                  <div className="text-[9px] text-amber-600 font-bold uppercase tracking-widest mt-1">{item.sellerName}</div>
                </td>
                <td className="px-6 py-4">
                  {item.publishStatus === PublishState.PUBLISHED ? (
                    <div className="space-y-1">
                      <div className="font-bold text-stone-900">{item.titleBoutique}</div>
                      <div className="flex space-x-2">
                        <span className="text-[8px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-1 rounded uppercase font-bold">Verified</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-stone-300 italic text-[11px]">Awaiting Agent Normalization...</div>
                  )}
                </td>
                <td className="px-6 py-4">
                   <span className="font-mono font-bold text-amber-600">{item.score}</span>
                </td>
                <td className="px-6 py-4 font-medium text-stone-900">£{item.priceGbp.toLocaleString()}</td>
                <td className="px-6 py-4 text-right">
                  {item.publishStatus !== PublishState.PUBLISHED ? (
                    <button 
                      onClick={() => handleExecuteWorkflow(item)}
                      disabled={!!processingState[item.id]}
                      className="bg-stone-900 text-white px-4 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition shadow-md disabled:opacity-50 min-w-[140px]"
                    >
                      {processingState[item.id] || 'Execute AI Workflow'}
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleWithdraw(item.id)}
                      className="text-stone-300 hover:text-red-600 text-[10px] font-bold uppercase tracking-widest transition"
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminInventory;
