
import React, { useState, useEffect } from 'react';
import { globalStore, AppStateItem } from '../lib/store';
import { PublishState } from '../types';
import { runCurate, patchItem } from '../lib/api';
import { formatPence, publicPrice } from '../lib/cart-pricing';
import type { PricingQuote } from '../api/_lib/pricing';
import { displayWatchPhotos, type WatchPhoto } from '../lib/watch-photos';
import { PhotoReview } from './PhotoReview';
import { WatchPhoto as PhotoTile } from './WatchPhoto';

const AdminInventory: React.FC = () => {
  const [items, setItems] = useState<AppStateItem[]>([]);
  const [processingState, setProcessingState] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ item: AppStateItem; title: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoApproval, setPhotoApproval] = useState<WatchPhoto[] | null>(null);
  const [view, setView] = useState<'candidates' | 'published' | 'all'>('candidates');
  const visible = items.filter(item => view === 'all' || (view === 'published'
    ? item.publishStatus === PublishState.PUBLISHED
    : item.status === 'ACTIVE' && item.publishStatus !== PublishState.PUBLISHED));
  useEffect(() => {
    const init = async () => {
      try { await globalStore.refresh({ admin: true }); }
      catch { setError('Inventory could not be loaded. Check the connection and try again.'); }
    };
    init();
    setItems(globalStore.getItems());
    return globalStore.subscribe(() => setItems(globalStore.getItems()));
  }, []);

  const handleExecuteWorkflow = async (item: AppStateItem) => {
    const id = item.id;
    try {
      setError(null);
      setProcessingState(prev => ({ ...prev, [id]: 'Generating draft…' }));
      await runCurate(id);
      await globalStore.refresh({ admin: true });

      setProcessingState(prev => ({ ...prev, [id]: null }));
    } catch (err) {
      console.error(err);
      setError('The draft could not be generated. Please try again.');
      setProcessingState(prev => ({ ...prev, [id]: null }));
    }
  };

  const handleWithdraw = (id: string) => {
    patchItem(id, { publishStatus: PublishState.UNPUBLISHED })
      .then(() => globalStore.refresh({ admin: true }))
      .catch(() => setError('The listing could not be withdrawn. Please try again.'));
  };

  function openReview(item: AppStateItem) {
    setError(null);
    setPhotoApproval(null);
    setReview({ item, title: item.titleBoutique || item.titleRaw, description: item.description || '' });
  }

  const saveReview = async (publish: boolean) => {
    if (!review || !review.title.trim() || !review.description.trim()) return;
    if (publish && (review.item.status !== 'ACTIVE' || !photoApproval)) return;
    setSaving(true);
    setError(null);
    try {
      await patchItem(review.item.id, {
        titleBoutique: review.title.trim(), description: review.description.trim(),
        publishStatus: publish ? PublishState.PUBLISHED : PublishState.DRAFT,
        ...(publish && photoApproval ? { photoReview: photoApproval } : {}),
      });
      await globalStore.refresh({ admin: true });
      setReview(null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : '';
      setError(['PHOTO_REVIEW_REQUIRED', 'LISTING_CHANGED'].includes(code)
        ? 'The source photos or availability changed. Refresh the inventory and review the current listing.'
        : 'Your changes could not be saved. The review is still open.');
    } finally { setSaving(false); }
  };

  return (
    <div className="p-8 space-y-6 bg-stone-100 min-h-screen">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 uppercase tracking-tight">Curation Queue</h1>
          <p className="text-stone-500 text-sm">Compare source photos and costs to find watches worth presenting better.</p>
        </div>
        <label className="text-sm text-stone-700">Show
          <select value={view} onChange={event => setView(event.target.value as typeof view)}
            className="ml-2 border border-stone-300 bg-white p-2">
            <option value="candidates">Active candidates</option>
            <option value="published">Published watches</option>
            <option value="all">All watches</option>
          </select>
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="min-w-full divide-y divide-stone-200">
          <thead className="bg-stone-50">
            <tr>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Discovery</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Boutique Identity</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Score</th>
              <th className="px-6 py-3 text-left text-[10px] font-bold uppercase text-stone-400">Costs & retail price</th>
              <th className="px-6 py-3 text-right text-[10px] font-bold uppercase text-stone-400">Workflow</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 text-sm bg-white">
            {!visible.length && <tr><td colSpan={5} className="px-6 py-8 text-stone-500">No watches in this view.</td></tr>}
            {visible.map((item) => (
              <tr key={item.id} className="hover:bg-stone-50 transition">
                <td className="px-6 py-4 max-w-xs">
                  <div className="mb-2 w-16">
                    <PhotoTile photo={displayWatchPhotos(item.imageUrls, item.photoReview)[0]} alt="" />
                  </div>
                  <div className="text-[11px] font-medium text-stone-400 italic line-clamp-1">"{item.titleRaw}"</div>
                  <div className="text-[9px] text-amber-600 font-bold uppercase tracking-widest mt-1">{item.sellerName}</div>
                  <div className="text-[10px] text-stone-500 mt-1">Source status: {item.status}</div>
                </td>
                <td className="px-6 py-4">
                  {item.titleBoutique ? (
                    <div className="space-y-1">
                      <div className="font-bold text-stone-900">{item.titleBoutique}</div>
                      <div className="flex space-x-2">
                        <span className="text-[9px] border border-stone-200 px-1 rounded uppercase font-bold">
                          {item.publishStatus === PublishState.PUBLISHED ? 'Published' : 'Draft — review needed'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-stone-500 italic text-[11px]">Awaiting draft</div>
                  )}
                </td>
                <td className="px-6 py-4">
                   <span className="font-mono font-bold text-amber-600">{item.score > 0 ? item.score : 'Not scored'}</span>
                </td>
                <td className="px-6 py-4 text-stone-900"><InventoryPricing item={item} /></td>
                <td className="px-6 py-4 text-right">
                  {item.publishStatus !== PublishState.PUBLISHED ? (
                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() => openReview(item)}
                        disabled={!!processingState[item.id]}
                        className="border border-stone-900 px-4 py-2 rounded text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                      >{item.status !== 'ACTIVE' ? 'Review listing' : item.titleBoutique && item.description ? 'Review & publish' : 'Write & review listing'}</button>
                    <button 
                      onClick={() => handleExecuteWorkflow(item)}
                      disabled={!!processingState[item.id]}
                      className="bg-stone-900 text-white px-4 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition shadow-md disabled:opacity-50 min-w-[140px]"
                    >
                      {processingState[item.id] || (item.titleBoutique ? 'Regenerate draft' : 'Generate draft')}
                    </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                    <button type="button" onClick={() => openReview(item)}
                      className="border border-stone-900 px-4 py-2 rounded text-[10px] font-bold uppercase tracking-widest">
                      Review photos
                    </button>
                    <button 
                      onClick={() => handleWithdraw(item.id)}
                      className="text-stone-300 hover:text-red-600 text-[10px] font-bold uppercase tracking-widest transition"
                    >
                      Withdraw
                    </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {review && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4">
            <h2 id="review-title" className="text-xl font-semibold">Review listing</h2>
            <p className="text-sm text-stone-600">Bring the watch’s overlooked features forward using verified details. Check the title, condition, reference and any claims against the seller’s listing.</p>
            {review.item.status !== 'ACTIVE' && <p className="text-sm text-amber-800">This source listing is not active. You can save a draft, but it cannot be published.</p>}
            <a href={review.item.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">Open source listing</a>
            <div className="border border-stone-200 p-4"><InventoryPricing item={review.item} /></div>
            <PhotoReview photos={displayWatchPhotos(review.item.imageUrls, review.item.photoReview)}
              onApproval={setPhotoApproval} disabled={saving} />
            <label className="block text-sm">Title
              <input value={review.title} onChange={e => setReview({ ...review, title: e.target.value })} className="block w-full border border-stone-300 p-2 mt-1" />
            </label>
            <label className="block text-sm">Description
              <textarea value={review.description} onChange={e => setReview({ ...review, description: e.target.value })} rows={10} className="block w-full border border-stone-300 p-2 mt-1" />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-3">
              {review.item.status === 'ACTIVE' && <button disabled={saving || !photoApproval || !review.title.trim() || !review.description.trim()} onClick={() => saveReview(true)} className="bg-stone-900 text-white px-4 py-2 rounded disabled:opacity-50">
                {review.item.publishStatus === PublishState.PUBLISHED ? 'Save reviewed listing' : 'Publish reviewed listing'}
              </button>}
              {review.item.publishStatus !== PublishState.PUBLISHED && <button disabled={saving || !review.title.trim() || !review.description.trim()} onClick={() => saveReview(false)} className="border border-stone-300 px-4 py-2 rounded disabled:opacity-50">Save draft</button>}
              <button disabled={saving} onClick={() => setReview(null)} className="px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InventoryPricing: React.FC<{ item: AppStateItem }> = ({ item }) => {
  const pricing = (item as AppStateItem & { pricing?: PricingQuote | null }).pricing;
  const cost = (value: number) => Number.isFinite(value) ? formatPence(Math.round(value * 100)) : 'Unavailable';
  return <div className="space-y-1 text-xs min-w-[210px]">
    <p>Source item: {cost(item.priceGbp)}</p>
    <p>Source postage: {cost(item.shippingGbp)}</p>
    {publicPrice(item) && pricing ? <>
      <p>Delivery allowance: {formatPence(pricing.deliveryAllowancePence)}</p>
      <p>Target gross margin: {(pricing.marginBps / 100).toFixed(2)}%</p>
      <p className="font-semibold text-sm">Retail: {formatPence(pricing.retailPricePence)}</p>
      <p>UK delivery included</p>
      <p>Estimated payment fee: {formatPence(pricing.estimatedFeePence)}</p>
      <p>Est. contribution after fee: {formatPence(pricing.estimatedContributionPence)}</p>
      <p className="text-[10px] text-stone-500">Fee allowance only; no customer surcharge. Other business costs are not deducted.</p>
    </> : <p className="text-amber-800">Retail price unavailable — review source costs and pricing settings.</p>}
  </div>;
};

export default AdminInventory;
