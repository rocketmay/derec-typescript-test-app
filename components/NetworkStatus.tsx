import { useState, useEffect } from 'react';
import type { PairedHelper, HelperId } from '../types/derec';
import { OFFLINE_THRESHOLD_MS } from '../types/derec';

interface NetworkStatusProps {
  isOwner: boolean;
  connectedHelpers: Map<HelperId, boolean>;
  pairedHelpers?: PairedHelper[];
  ownerConnected?: boolean;
  ownerLastSeen?: number;
}

function formatLastSeen(lastSeen?: number): string {
  if (!lastSeen) return '';
  
  const seconds = Math.floor((Date.now() - lastSeen) / 1000);
  
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function isOnline(lastSeen?: number): boolean {
  if (!lastSeen) return false;
  return (Date.now() - lastSeen) < OFFLINE_THRESHOLD_MS;
}

export function NetworkStatus({ isOwner, connectedHelpers, pairedHelpers, ownerConnected }: NetworkStatusProps) {
  const helpers: HelperId[] = [1, 2, 3];
  
  // Force re-render every second to update "last seen" times
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isOwner) {
      const interval = setInterval(() => setTick(t => t + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [isOwner]);

  // Helper view - only show owner status
  if (!isOwner) {
    return (
      <div className="network-status">
        <h3>Network Status</h3>
        <div className="participants">
          <div className="participant owner">
            <div className="participant-icon">👤</div>
            <div className="participant-info">
              <span className="participant-name">Owner</span>
              <span className={`participant-status ${ownerConnected ? 'online' : 'offline'}`}>
                {ownerConnected ? 'Connected' : 'Waiting...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Owner view - show all helpers
  return (
    <div className="network-status">
      <h3>Network Status</h3>
      <div className="participants">
        <div className="participant owner is-self">
          <div className="participant-icon">👤</div>
          <div className="participant-info">
            <span className="participant-name">Owner</span>
            <span className="participant-status online">You</span>
          </div>
        </div>

        {helpers.map(id => {
          const paired = pairedHelpers?.find(h => h.id === id);
          const helperIsOnline = paired ? isOnline(paired.lastSeen) : false;
          const lastSeenText = formatLastSeen(paired?.lastSeen);
          
          let statusText = 'Offline';
          let statusClass = 'offline';
          
          if (paired?.paired) {
            if (helperIsOnline) {
              if (paired.verificationStatus === 'valid') {
                statusText = lastSeenText ? `Verified · ${lastSeenText}` : 'Verified';
                statusClass = 'online';
              } else if (paired.verificationStatus === 'pending') {
                statusText = 'Verifying...';
                statusClass = 'pending';
              } else if (paired.verificationStatus === 'invalid') {
                statusText = 'Invalid share!';
                statusClass = 'error';
              } else if (paired.verificationStatus === 'no-share') {
                statusText = 'Share lost!';
                statusClass = 'warning';
              } else {
                statusText = lastSeenText ? `Paired · ${lastSeenText}` : 'Paired';
                statusClass = 'online';
              }
            } else {
              statusText = lastSeenText ? `Offline · ${lastSeenText}` : 'Offline';
              statusClass = 'offline';
            }
          } else if (connectedHelpers.get(id)) {
            statusText = 'Online';
            statusClass = 'online';
          }
          
          return (
            <div key={id} className="participant helper">
              <div className="participant-icon">🛡️</div>
              <div className="participant-info">
                <span className="participant-name">Helper {id}</span>
                <span className={`participant-status ${statusClass}`}>
                  {statusText}
                </span>
              </div>
              {paired?.hasShare && paired.verificationStatus === 'valid' && (
                <div className="share-indicator" title="Has verified share">📦</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}