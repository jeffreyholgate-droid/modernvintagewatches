
import React from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import AdminDashboard from './pages/AdminDashboard';
import AdminInventory from './pages/AdminInventory';
import PublicStore from './pages/PublicStore';
import PublicItem from './pages/PublicItem';
import SettingsPage from './pages/Settings';
import SyncStatus from './pages/SyncStatus';
import AdminLogin from './pages/AdminLogin';
import Bag from './pages/Bag';
import CheckoutSuccess from './pages/CheckoutSuccess';
import CheckoutCancel from './pages/CheckoutCancel';
import { hasToken } from './lib/api';
import { CartProvider, useCart } from './lib/cart';

const RequireAdmin: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const navigate = useNavigate();
  if (!hasToken()) {
    return <AdminLogin onSuccess={() => navigate('/admin')} />;
  }
  return children;
};

const Navigation = () => {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  if (isAdmin) {
    return (
      <nav className="bg-stone-950 text-white border-b border-stone-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/admin" className="flex items-center space-x-2">
                <span className="text-xl font-bold bg-amber-600 px-2 py-1 rounded tracking-tighter text-white">AGENT</span>
                <span className="font-semibold hidden sm:inline text-stone-300 uppercase text-[10px] tracking-widest ml-2">Control Panel</span>
              </Link>
              <div className="ml-10 flex items-baseline space-x-8">
                <Link to="/admin" className={`text-[10px] font-bold uppercase tracking-widest hover:text-amber-400 ${location.pathname === '/admin' ? 'text-amber-500' : 'text-stone-400'}`}>Dashboard</Link>
                <Link to="/admin/inventory" className={`text-[10px] font-bold uppercase tracking-widest hover:text-amber-400 ${location.pathname === '/admin/inventory' ? 'text-amber-500' : 'text-stone-400'}`}>Curation Queue</Link>
                <Link to="/admin/sync" className={`text-[10px] font-bold uppercase tracking-widest hover:text-amber-400 ${location.pathname === '/admin/sync' ? 'text-amber-500' : 'text-stone-400'}`}>Audit Logs</Link>
                <Link to="/admin/settings" className={`text-[10px] font-bold uppercase tracking-widest hover:text-amber-400 ${location.pathname === '/admin/settings' ? 'text-amber-500' : 'text-stone-400'}`}>Settings</Link>
              </div>
            </div>
            <Link to="/" className="flex items-center text-[9px] text-stone-400 hover:text-white border border-stone-800 px-4 py-1 rounded-full uppercase tracking-widest transition-colors">
              <i className="fa-solid fa-eye mr-2"></i> View Boutique
            </Link>
          </div>
        </div>
      </nav>
    );
  }

  return <PublicNavigation />;
};

const PublicNavigation: React.FC = () => {
  const cart = useCart();

  return (
    <nav className="bg-page border-b border-line fixed w-full top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Modern Vintage Watches
          </Link>
          <div className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted hover:text-black">Watches</Link>
            <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted hover:text-black">New Arrivals</Link>
            <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted hover:text-black">Stories</Link>
            <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted hover:text-black">About</Link>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <Link to="/admin" className="text-xs uppercase tracking-[0.25em] text-muted hover:text-black">
            Admin
          </Link>
          <Link to="/bag" className="relative text-xs uppercase tracking-[0.25em] hover:text-black">
            Bag
            <span className="ml-2 inline-flex items-center justify-center text-[10px] border border-line px-2 py-0.5 rounded-full text-muted">
              {cart.count}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
};

const App: React.FC = () => {
  return (
    <CartProvider>
      <div className="min-h-screen flex flex-col font-sans bg-page text-black">
        <Navigation />
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<PublicStore />} />
            <Route path="/item/:id" element={<PublicItem />} />
            <Route path="/bag" element={<Bag />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
            <Route path="/checkout/cancel" element={<CheckoutCancel />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/admin/inventory" element={<RequireAdmin><AdminInventory /></RequireAdmin>} />
            <Route path="/admin/sync" element={<RequireAdmin><SyncStatus /></RequireAdmin>} />
            <Route path="/admin/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          </Routes>
        </main>
        <footer className="border-t border-line py-12 text-center">
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted">© {new Date().getFullYear()} Modern Vintage Watches</p>
        </footer>
      </div>
    </CartProvider>
  );
};

export default App;
