
import React, { useEffect, useState } from 'react';
import { fetchLogs } from '../lib/api';

const SyncStatus: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const l = await fetchLogs(50);
        setLogs(l);
      } catch (e: any) {
        setError(e?.data?.error ? `Error: ${e.data.error}` : 'Error loading logs');
      }
    })();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Job Logs & History</h1>
        <p className="text-slate-500">Audit trail of all automated background tasks</p>
      </div>

      {error && <div className="text-xs text-slate-500">{error}</div>}

      <div className="space-y-4">
        {logs.map((log, idx) => {
          const ok = String(log.level || '').toUpperCase() !== 'ERROR';
          return (
          <div key={log.id ?? log.ts ?? idx} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start">
            <div className={`mt-1 p-2 rounded-lg ${ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              <i className={`fa-solid ${ok ? 'fa-check' : 'fa-triangle-exclamation'}`}></i>
            </div>
            <div className="ml-4 flex-grow">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-slate-900">{log.level || 'LOG'}</h4>
                  <p className="text-sm text-slate-600 mt-1">{log.message}</p>
                </div>
                <span className="text-xs font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded">{log.ts ? new Date(log.ts).toLocaleString() : ''}</span>
              </div>
              <div className="mt-4 flex items-center text-xs text-slate-400">
                <span className="mr-4"><i className="fa-solid fa-list-ol mr-1"></i> Entry #{idx + 1}</span>
                <span><i className="fa-solid fa-tag mr-1"></i> Mode: API</span>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default SyncStatus;
