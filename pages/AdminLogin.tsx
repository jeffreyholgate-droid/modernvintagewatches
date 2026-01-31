import React, { useState } from 'react';
import { login } from '../lib/api';

const AdminLogin: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      await login(password);
      setStatus('Logged in');
      onSuccess?.();
    } catch (err: any) {
      setStatus(err?.data?.error ? `Error: ${err.data.error}` : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0a09] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-stone-900/40 border border-stone-800 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-serif italic text-white tracking-tighter">Admin Access</h1>
        <p className="mt-2 text-stone-500 text-xs uppercase tracking-[0.2em]">Chronos Command Center</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400">Admin Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-black/40 border border-stone-800 rounded-xl px-4 py-3 text-white outline-none focus:border-gold"
            placeholder="••••••••"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 px-6 py-3 bg-white text-black rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-all duration-500 shadow-xl disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Enter'}
          </button>
          {status && <div className="text-xs text-stone-500 mt-3">{status}</div>}
        </form>

        <div className="mt-8 text-[10px] text-stone-600 leading-relaxed">
          <p>For production: set <span className="text-stone-400">ADMIN_PASSWORD</span> and <span className="text-stone-400">ADMIN_JWT_SECRET</span> as environment variables.</p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
