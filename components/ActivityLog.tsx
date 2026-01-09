import { useEffect, useRef } from 'react';
import type { LogEntry } from '../types/derec';

interface ActivityLogProps {
  logs: LogEntry[];
  title?: string;
}

export function ActivityLog({ logs, title = "Activity Log" }: ActivityLogProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getLevelIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'info': return 'ℹ️';
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
    }
  };

  return (
    <div className="activity-log">
      <h3>{title}</h3>
      <div className="log-entries">
        {logs.length === 0 ? (
          <div className="log-empty">No activity yet...</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.level}`}>
              <span className="log-time">{formatTime(log.timestamp)}</span>
              <span className="log-icon">{getLevelIcon(log.level)}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
