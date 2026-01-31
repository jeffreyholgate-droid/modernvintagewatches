
import React, { useEffect, useState } from 'react';
import { Category } from '../types';
import { fetchSettings, saveSettings } from '../lib/api';

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState({
    priceMin: { [Category.WATCH]: 1500, [Category.HANDBAG]: 1500, [Category.JEWELLERY]: 1500 },
    priceMax: { [Category.WATCH]: 15000, [Category.HANDBAG]: 12000, [Category.JEWELLERY]: 10000 },
    publishTarget: 80,
    marginPercent: { [Category.WATCH]: 15, [Category.HANDBAG]: 20, [Category.JEWELLERY]: 25 },
    sellerMinFeedback: 99,
    sellerMinScore: 200,
    vatMode: 'MARGIN_SCHEME',
    blockKeywords: 'replica, fake, copy, aftermarket, custom, diamond set, ice, lab, moissanite'
  });

  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchSettings();
        setSettings(s);
      } catch (e: any) {
        setStatus(e?.data?.error ? `Error: ${e.data.error}` : '');
      }
    })();
  }, []);

  const handleSave = () => {
    (async () => {
      setStatus('Saving...');
      try {
        await saveSettings(settings);
        setStatus('Saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (e: any) {
        setStatus(e?.data?.error ? `Error: ${e.data.error}` : 'Error saving');
      }
    })();
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Settings</h1>
          <p className="text-slate-500">Configure global business rules and automation thresholds</p>
        </div>
        <button 
          onClick={handleSave}
          className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition"
        >
          Save Changes
        </button>
      </div>

      {status && (
        <div className="text-xs text-slate-500">{status}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Sourcing Limits */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-semibold border-b pb-4"><i className="fa-solid fa-filter mr-2"></i> Sourcing Limits</h3>
          
          {Object.values(Category).map(cat => (
            <div key={cat} className="space-y-3">
              <label className="text-sm font-bold text-slate-700">{cat} PRICE BAND (£)</label>
              <div className="flex space-x-4">
                <input 
                  type="number" 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
                  placeholder="Min"
                  value={settings.priceMin[cat]}
                  onChange={e => setSettings({
                    ...settings, 
                    priceMin: { ...settings.priceMin, [cat]: parseInt(e.target.value) }
                  })}
                />
                <input 
                  type="number" 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
                  placeholder="Max"
                  value={settings.priceMax[cat]}
                  onChange={e => setSettings({
                    ...settings, 
                    priceMax: { ...settings.priceMax, [cat]: parseInt(e.target.value) }
                  })}
                />
              </div>
            </div>
          ))}

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">PUBLISH TARGET (Items)</label>
            <input 
              type="number" 
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
              value={settings.publishTarget}
              onChange={e => setSettings({...settings, publishTarget: parseInt(e.target.value)})}
            />
          </div>
        </div>

        {/* Commercial Rules */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-semibold border-b pb-4"><i className="fa-solid fa-coins mr-2"></i> Commercial Rules</h3>
          
          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-700">VAT MODE</label>
            <div className="flex space-x-2">
              <button 
                onClick={() => setSettings({...settings, vatMode: 'STANDARD'})}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border ${settings.vatMode === 'STANDARD' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
              >
                Standard
              </button>
              <button 
                onClick={() => setSettings({...settings, vatMode: 'MARGIN_SCHEME'})}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border ${settings.vatMode === 'MARGIN_SCHEME' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
              >
                Margin Scheme
              </button>
            </div>
            <p className="text-[10px] text-slate-400 italic">Margin scheme calculates VAT as (Margin / 6) for internal reporting.</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-700">MARGINS (%)</label>
            <div className="grid grid-cols-3 gap-4">
              {Object.values(Category).map(cat => (
                <div key={cat}>
                  <p className="text-[10px] text-slate-500 mb-1">{cat}</p>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
                    value={settings.marginPercent[cat]}
                    onChange={e => setSettings({
                      ...settings, 
                      marginPercent: { ...settings.marginPercent, [cat]: parseInt(e.target.value) }
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-4">
            <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider">Safety Block Keywords</h4>
            <textarea 
              className="w-full bg-red-50/30 border border-red-100 rounded-lg p-3 text-sm font-mono"
              rows={3}
              value={settings.blockKeywords}
              onChange={e => setSettings({...settings, blockKeywords: e.target.value})}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
