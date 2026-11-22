
import React, { useEffect, useState } from 'react';
import { Category } from '../types';
import { fetchSettings, saveSettings } from '../lib/api';

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState({
    priceMin: { [Category.WATCH]: 1500, [Category.HANDBAG]: 1500, [Category.JEWELLERY]: 1500 },
    priceMax: { [Category.WATCH]: 15000, [Category.HANDBAG]: 12000, [Category.JEWELLERY]: 10000 },
    publishTarget: 80,
    marginPercent: { [Category.WATCH]: 20, [Category.HANDBAG]: 20, [Category.JEWELLERY]: 20 },
    sellerMinFeedback: 99,
    sellerMinScore: 200,
    vatMode: 'NOT_REGISTERED',
    pricingPolicy: { version: 'mvw-pricing-v1', deliveryAllowancePence: 5000, feeAllowanceBps: 350, feeFixedPence: 20, roundingPence: 500, vatMode: 'NOT_REGISTERED' },
    blockKeywords: 'replica, fake, copy, aftermarket, custom, diamond set, ice, lab, moissanite'
  });

  const [status, setStatus] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchSettings();
        if (!s?.pricingPolicy) throw new Error('PRICING_SETTINGS_UNAVAILABLE');
        setSettings(s);
        setLoaded(true);
      } catch (e: any) {
        setStatus('Settings could not be loaded. Reload this page before making changes.');
      }
    })();
  }, []);

  const handleSave = () => {
    if (!loaded || saving) return;
    (async () => {
      setSaving(true);
      setStatus('Saving...');
      try {
        await saveSettings(settings);
        setStatus('Saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (e: any) {
        setStatus(e?.data?.error ? `Error: ${e.data.error}` : 'Error saving');
      } finally { setSaving(false); }
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
          disabled={!loaded || saving}
          className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
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
            <label className="text-sm font-bold text-slate-700">VAT STATUS</label>
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">Not VAT registered</p>
            <p className="text-xs text-slate-500">No VAT is added to the customer price.</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-700">TARGET GROSS MARGIN (%)</label>
            <p className="text-xs text-slate-500">Retail price = (source item + source postage + delivery allowance) ÷ (1 − target margin), rounded up. This is a margin on the retail price, not a markup on cost.</p>
            <div className="grid grid-cols-3 gap-4">
              {Object.values(Category).map(cat => (
                <div key={cat}>
                  <p className="text-[10px] text-slate-500 mb-1">{cat}</p>
                  <input 
                    type="number" 
                    min={5}
                    max={60}
                    step={0.01}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
                    value={settings.marginPercent[cat]}
                    onChange={e => setSettings({
                      ...settings, 
                      marginPercent: { ...settings.marginPercent, [cat]: Number(e.target.value) }
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">UK DELIVERY ALLOWANCE PER WATCH (£)
              <input type="number" min={0} max={250} step={0.01} value={settings.pricingPolicy.deliveryAllowancePence / 100}
                onChange={e => setSettings({ ...settings, pricingPolicy: { ...settings.pricingPolicy, deliveryAllowancePence: Math.round(Number(e.target.value) * 100) } })}
                className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm" />
            </label>
            <p className="text-xs text-slate-500">Included in the retail price. This is an internal cost allowance, not a separate checkout charge.</p>
            <label className="block text-sm font-bold text-slate-700">ROUND RETAIL PRICE UP TO
              <select value={settings.pricingPolicy.roundingPence}
                onChange={e => setSettings({ ...settings, pricingPolicy: { ...settings.pricingPolicy, roundingPence: Number(e.target.value) } })}
                className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm">
                <option value={100}>Next £1</option><option value={500}>Next £5</option><option value={1000}>Next £10</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm font-bold text-slate-700">FEE ALLOWANCE (%)
                <input type="number" min={0} max={10} step={0.01} value={settings.pricingPolicy.feeAllowanceBps / 100}
                  onChange={e => setSettings({ ...settings, pricingPolicy: { ...settings.pricingPolicy, feeAllowanceBps: Math.round(Number(e.target.value) * 100) } })}
                  className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm" />
              </label>
              <label className="text-sm font-bold text-slate-700">FIXED FEE (£)
                <input type="number" min={0} max={5} step={0.01} value={settings.pricingPolicy.feeFixedPence / 100}
                  onChange={e => setSettings({ ...settings, pricingPolicy: { ...settings.pricingPolicy, feeFixedPence: Math.round(Number(e.target.value) * 100) } })}
                  className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm" />
              </label>
            </div>
            <p className="text-xs text-slate-500">Payment fees are estimates for internal contribution reporting. They do not add a customer surcharge or guarantee the actual processor fee.</p>
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
