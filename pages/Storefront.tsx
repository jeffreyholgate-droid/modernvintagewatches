
import React from 'react';
import { Link } from 'react-router-dom';
import { Category } from '../types';

const Storefront: React.FC = () => {
  const products = [
    {
      id: 'prod_1',
      title: 'Rolex Submariner Date 41mm',
      category: Category.WATCH,
      price: 11250,
      image: 'https://picsum.photos/id/175/800/800',
      specs: 'Steel, Black Dial, 2023'
    },
    {
      id: 'prod_2',
      title: 'Hermès Birkin 30 Epsom Blue',
      category: Category.HANDBAG,
      price: 18500,
      image: 'https://picsum.photos/id/42/800/800',
      specs: 'Gold Hardware, Excellent'
    },
    {
      id: 'prod_3',
      title: 'Cartier Love Ring 18k Rose Gold',
      category: Category.JEWELLERY,
      price: 1850,
      image: 'https://picsum.photos/id/160/800/800',
      specs: 'Size 52, Original Box'
    },
    {
      id: 'prod_4',
      title: 'Patek Philippe Aquanaut 5167A',
      category: Category.WATCH,
      price: 45000,
      image: 'https://picsum.photos/id/20/800/800',
      specs: 'Rubber Strap, Complete Set'
    }
  ];

  return (
    <div className="space-y-12">
      <div className="relative rounded-2xl overflow-hidden h-64 flex items-center bg-slate-900">
        <img 
          src="https://picsum.photos/id/60/1200/400" 
          className="absolute inset-0 w-full h-full object-cover opacity-50"
          alt="Hero"
        />
        <div className="relative px-8">
          <h1 className="text-4xl font-bold text-white mb-2">Curated Luxury. Guaranteed.</h1>
          <p className="text-slate-200 text-lg max-w-lg">
            Every item is sourced from verified UK private sellers and authenticated by our agent network.
          </p>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900">Featured Collections</h2>
          <div className="flex space-x-2">
            {['All', 'Watches', 'Handbags', 'Jewellery'].map(cat => (
              <button key={cat} className="px-4 py-1.5 text-sm font-medium bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition">
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {products.map(product => (
            <Link 
              key={product.id} 
              to={`/product/${product.id}`}
              className="group"
            >
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition">
                <div className="aspect-square relative overflow-hidden">
                  <img 
                    src={product.image} 
                    alt={product.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <div className="absolute top-4 left-4">
                    <span className="bg-white/90 backdrop-blur px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-800 rounded shadow-sm border border-slate-100">
                      {product.category}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-slate-800 line-clamp-1">{product.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">{product.specs}</p>
                  <div className="mt-4 flex justify-between items-center">
                    <span className="text-lg font-bold text-indigo-600">£{product.price.toLocaleString()}</span>
                    <button className="p-2 rounded-full bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition">
                      <i className="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Storefront;
