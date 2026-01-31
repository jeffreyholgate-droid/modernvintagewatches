
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const ProductDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<null | 'OK' | 'FAILED'>(null);

  // Mock product data
  const product = {
    title: 'Rolex Submariner Date 41mm - 126610LN',
    price: 11250,
    category: 'WATCH',
    description: 'The Rolex Submariner is the quintessential divers watch, the benchmark in its category. This 2023 model features the updated 41mm case and the legendary calibre 3235 movement.',
    bullets: [
      'Authenticity Guaranteed by our experts',
      'UK Sourced from single private owner',
      'Full Set: Original box, warranty card, and tags',
      'Immaculate condition, lightly worn'
    ],
    specs: {
      Brand: 'Rolex',
      Model: 'Submariner Date',
      Reference: '126610LN',
      Year: '2023',
      Material: 'Oystersteel',
      Diameter: '41mm'
    }
  };

  const handleCheckout = async () => {
    setIsVerifying(true);
    setVerifyStatus(null);
    
    // Simulate server-side verification with source eBay listing
    setTimeout(() => {
      setIsVerifying(false);
      setVerifyStatus('OK');
      setTimeout(() => alert("Proceeding to secure checkout! (Mock)"), 500);
    }, 2000);
  };

  return (
    <div className="space-y-8">
      <button 
        onClick={() => navigate(-1)}
        className="text-slate-500 hover:text-slate-800 flex items-center text-sm font-medium"
      >
        <i className="fa-solid fa-arrow-left mr-2"></i> Back to listings
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="space-y-4">
          <div className="aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-white">
            <img 
              src="https://picsum.photos/id/175/800/800" 
              className="w-full h-full object-cover"
              alt="Product"
            />
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="aspect-square rounded-lg overflow-hidden border border-slate-200">
                <img src={`https://picsum.photos/id/${170+i}/200/200`} className="w-full h-full object-cover" alt="Thumb" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <span className="text-indigo-600 font-bold text-xs uppercase tracking-widest">{product.category}</span>
            <h1 className="text-3xl font-bold text-slate-900 mt-2">{product.title}</h1>
            <p className="text-2xl font-bold text-slate-900 mt-4">£{product.price.toLocaleString()}</p>
          </div>

          <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
            <h3 className="font-semibold text-slate-900 mb-4">Verification Check</h3>
            <button 
              onClick={handleCheckout}
              disabled={isVerifying}
              className={`w-full py-4 rounded-xl font-bold text-white transition shadow-lg ${
                isVerifying ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98]'
              }`}
            >
              {isVerifying ? (
                <><i className="fa-solid fa-spinner animate-spin mr-2"></i> Verifying Availability...</>
              ) : (
                'Secure Purchase'
              )}
            </button>
            {verifyStatus === 'OK' && (
              <p className="mt-3 text-center text-xs text-green-600 font-medium">
                <i className="fa-solid fa-check-circle mr-1"></i> Listing verified active on eBay
              </p>
            )}
            <p className="mt-4 text-center text-xs text-slate-500">
              <i className="fa-solid fa-shield-halved mr-1"></i> Guaranteed safe by Agent Reseller UK
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Description</h3>
            <p className="text-slate-600 leading-relaxed text-sm">
              {product.description}
            </p>
            <ul className="space-y-2">
              {product.bullets.map((b, i) => (
                <li key={i} className="flex items-start text-sm text-slate-600">
                  <i className="fa-solid fa-check text-green-500 mt-1 mr-3 flex-shrink-0"></i>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Technical Details</h3>
            <div className="grid grid-cols-2 gap-y-3 gap-x-8">
              {Object.entries(product.specs).map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-slate-900 font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
