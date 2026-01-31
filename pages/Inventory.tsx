
import React, { useState } from 'react';
import { Category, PublishState } from '../types';

const Inventory: React.FC = () => {
  const [filter, setFilter] = useState({ category: 'ALL', status: 'ALL' });
  const [items, setItems] = useState([
    {
      id: '1',
      title: 'Rolex Submariner 126610LN 2023 Full Set',
      category: Category.WATCH,
      price: 9850,
      score: 98,
      status: PublishState.PUBLISHED,
      seller: 'LuxuryTimeUK',
      feedback: '99.8%'
    },
    {
      id: '2',
      title: 'Chanel Classic Flap Bag Medium Black Lambskin',
      category: Category.HANDBAG,
      price: 6400,
      score: 95,
      status: PublishState.UNPUBLISHED,
      seller: 'PremiumDesigner',
      feedback: '100%'
    },
    {
      id: '3',
      title: 'Cartier Love Bracelet 18k Yellow Gold Size 17',
      category: Category.JEWELLERY,
      price: 4200,
      score: 92,
      status: PublishState.PUBLISHED,
      seller: 'MayfairJewels',
      feedback: '99.5%'
    }
  ]);

  const togglePublish = (id: string) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          status: item.status === PublishState.PUBLISHED ? PublishState.UNPUBLISHED : PublishState.PUBLISHED
        };
      }
      return item;
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Candidate Inventory</h1>
          <p className="text-slate-500">Manage ingested eBay listings and publish them to the storefront</p>
        </div>
        <div className="flex space-x-4">
          <select 
            className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={filter.category}
            onChange={(e) => setFilter({...filter, category: e.target.value})}
          >
            <option value="ALL">All Categories</option>
            <option value={Category.WATCH}>Watches</option>
            <option value={Category.HANDBAG}>Handbags</option>
            <option value={Category.JEWELLERY}>Jewellery</option>
          </select>
          <select 
            className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={filter.status}
            onChange={(e) => setFilter({...filter, status: e.target.value})}
          >
            <option value="ALL">All Status</option>
            <option value={PublishState.PUBLISHED}>Published</option>
            <option value={PublishState.UNPUBLISHED}>Unpublished</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Item Details</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Price (Source)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Stability Score</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Seller</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-slate-900">{item.title}</div>
                  <div className="text-xs text-slate-500 truncate max-w-xs">ID: {item.id}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 text-xs font-medium rounded-md bg-slate-100 text-slate-700">
                    {item.category}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                  £{item.price.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <span className={`text-sm font-bold ${item.score > 90 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {item.score}
                    </span>
                    <div className="ml-2 w-16 bg-slate-100 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${item.score}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-slate-900">{item.seller}</div>
                  <div className="text-xs text-slate-400">{item.feedback} Positive</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    item.status === PublishState.PUBLISHED 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button 
                    onClick={() => togglePublish(item.id)}
                    className={`ml-4 ${
                      item.status === PublishState.PUBLISHED ? 'text-red-600 hover:text-red-900' : 'text-indigo-600 hover:text-indigo-900'
                    }`}
                  >
                    {item.status === PublishState.PUBLISHED ? 'Unpublish' : 'Publish'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Inventory;
