import { useState, useCallback, useEffect } from 'react';
import type { 
  HelperId, 
  StoredShare,
  DeRecMessage
} from '../types/derec';
import { OFFLINE_THRESHOLD_MS } from '../types/derec';
import { 
  useBroadcastChannel, 
  useActivityLog,
  uint8ArrayToBase64,
  base64ToUint8Array 
} from '../hooks/useBroadcastChannel';
import { ActivityLog } from './ActivityLog';
import { NetworkStatus } from './NetworkStatus';

interface DeRecLib {
  ts_generate_share_response: (
    secretId: Uint8Array,
    channelId: bigint,
    shareContent: Uint8Array,
    request: Uint8Array
  ) => Uint8Array;
  ts_generate_verification_response: (
    secretId: Uint8Array,
    channelId: bigint,
    shareContent: Uint8Array,
    request: Uint8Array
  ) => Uint8Array;
}

interface HelperViewProps {
  helperId: HelperId;
  derecLib: DeRecLib | null;
  onBack: () => void;
}

export function HelperView({ helperId, derecLib, onBack }: HelperViewProps) {
  const { logs, addLog } = useActivityLog();
  const [ownerConnected, setOwnerConnected] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [storedShares, setStoredShares] = useState<StoredShare[]>([]);
  const [ownerLastSeen, setOwnerLastSeen] = useState<number | undefined>(undefined);

  const participantId = `helper-${helperId}`;

  const handleMessage = useCallback((message: DeRecMessage) => {
    switch (message.type) {
      case 'ANNOUNCE':
        if (message.role === 'owner') {
          if (!ownerConnected) {
            addLog('info', 'Owner came online');
            setIsPaired(false);
          }
          setOwnerConnected(true);
          setOwnerLastSeen(Date.now());
          
          // Re-announce ourselves so the owner knows we're here
          sendMessage({
            type: 'ANNOUNCE',
            role: 'helper',
            helperId,
            transportUri: `local://helper-${helperId}`
          });
        }
        break;

      case 'PAIRING_REQUEST':
        addLog('info', 'Received pairing request from Owner');
        // Auto-accept pairing
        setIsPaired(true);
        // Send response handled by sendMessage after state update
        break;

      case 'SHARE_DISTRIBUTION':
        
        console.log(`Helper ${helperId}: Got share, will send ACK soon`);
        addLog('info', `Receiving share for secret ${message.secretId.slice(0, 8)}...`);
        
            // shareData comes as base64, decode it
      const shareData = base64ToUint8Array(message.shareData);
      
      console.log('Helper received share, decoded length:', shareData.length);
      
      setStoredShares(prev => {
        const existing = prev.find(s => s.secretId === message.secretId);
        if (existing) {
          return prev.map(s => 
            s.secretId === message.secretId 
              ? { ...s, shareData, version: message.version, receivedAt: Date.now() }
              : s
          );
        }
        return [...prev, {
          secretId: message.secretId,
          shareData,
          version: message.version,
          receivedAt: Date.now()
        }];
      });
      
      addLog('success', `Stored share for secret ${message.secretId.slice(0, 8)}...`);
       
      // Force an immediate ACK instead of waiting for useEffect
      setTimeout(() => {
        console.log(`Helper ${helperId}: Sending immediate SHARE_ACK`);
        sendMessage({
          type: 'SHARE_ACK',
          to: 'owner',
          secretId: message.secretId,
          received: true
        });
      }, 100);

      break;

      case 'RECOVERY_REQUEST':
        addLog('info', `Recovery request for secret ${message.secretId.slice(0, 8)}...`);
        
        const share = storedShares.find(s => s.secretId === message.secretId);
        if (share) {
          addLog('success', 'Sending share for recovery');
        } else {
          addLog('warning', 'Share not found for requested secret');
        }
        break;

        case 'VERIFICATION_REQUEST':
          // Handled by separate useEffect for fresh state access
          break;
    }
  }, [helperId, addLog, storedShares]);

  // Check if owner has gone offline
  useEffect(() => {
    const interval = setInterval(() => {
      if (ownerLastSeen && (Date.now() - ownerLastSeen) > OFFLINE_THRESHOLD_MS) {
        if (ownerConnected) {
          setOwnerConnected(false);
          addLog('warning', 'Owner appears to be offline');
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [ownerLastSeen, ownerConnected, addLog]);

  const { sendMessage, isConnected } = useBroadcastChannel(participantId, handleMessage);

  // Announce presence and respond to messages
  useEffect(() => {
    if (isConnected) {
      sendMessage({
        type: 'ANNOUNCE',
        role: 'helper',
        helperId,
        transportUri: `local://helper-${helperId}`
      });
      addLog('info', `Helper ${helperId} connected to network`);
    }
  }, [isConnected, helperId, sendMessage, addLog]);

  // Handle pairing response
  useEffect(() => {
    if (isPaired) {
      sendMessage({
        type: 'PAIRING_RESPONSE',
        to: 'owner',
        channelId: helperId.toString(),
        responseData: '',
        accepted: true
      });
    }
  }, [isPaired, helperId, sendMessage]);

  // Handle share acknowledgment
  useEffect(() => {
    storedShares.forEach(share => {
      console.log(`SHARE_ACK sent for ` + share.secretId + ` from helper ` + helperId)
      sendMessage({
        type: 'SHARE_ACK',
        to: 'owner',
        secretId: share.secretId,
        received: true
      });
    });
  }, [storedShares, sendMessage]);

  // Handle recovery requests
useEffect(() => {
  const handleRecovery = (message: DeRecMessage) => {
    if (message.type === 'RECOVERY_REQUEST' && message.to === participantId) {
      const share = storedShares.find(s => s.secretId === message.secretId);
      
      if (share && derecLib) {
        try {
          const secretIdBytes = base64ToUint8Array(message.secretId);
          const requestBytes = base64ToUint8Array(message.requestData);
          
          // Generate proper response using the library
          const response = derecLib.ts_generate_share_response(
            secretIdBytes,
            BigInt(helperId),
            share.shareData,
            requestBytes
          );
          
          console.log(`Helper ${helperId} generated response:`, response);
          
          sendMessage({
            type: 'RECOVERY_RESPONSE',
            to: 'owner',
            secretId: message.secretId,
            shareData: uint8ArrayToBase64(response)
          });
          
          addLog('success', 'Sent share response for recovery');
        } catch (error) {
          console.error('Failed to generate share response:', error);
          addLog('error', `Failed to generate response: ${error}`);
        }
      } else if (!share) {
        addLog('warning', 'Share not found for requested secret');
      } else if (!derecLib) {
        addLog('error', 'DeRec library not available');
      }
    }
  };
  

  const channel = new BroadcastChannel('derec-protocol-channel');
  channel.onmessage = (event) => {
    if (event.data.type === 'RECOVERY_REQUEST' && event.data.to === participantId) {
      handleRecovery(event.data);
    }
  };

  return () => channel.close();
}, [storedShares, participantId, helperId, derecLib, sendMessage, addLog]);



// Handle verification requests
useEffect(() => {
  const channel = new BroadcastChannel('derec-protocol-channel');
  
  channel.onmessage = (event) => {
    const message = event.data;
    
    if (message.type !== 'VERIFICATION_REQUEST' || message.to !== participantId) {
      return;
    }
    
    console.log(`Helper ${helperId} received verification request:`, message);
    addLog('info', `Verification request for secret ${message.secretId.slice(0, 8)}...`);
    
    const share = storedShares.find(s => s.secretId === message.secretId);
    
    if (!share) {
      console.log(`Helper ${helperId}: Share not found for verification`);
      addLog('warning', 'Share not found for verification');
      // Send response indicating no share
      sendMessage({
        type: 'VERIFICATION_RESPONSE',
        to: 'owner',
        secretId: message.secretId,
        responseData: '',
        valid: false,
        reason: 'no-share'
      });
      return;
    }
    
    if (!derecLib) {
      console.log(`Helper ${helperId}: DeRec library not available`);
      addLog('error', 'DeRec library not available');
      return;
    }
    
    try {
      const secretIdBytes = base64ToUint8Array(message.secretId);
      const requestBytes = base64ToUint8Array(message.requestData);
      
      console.log(`Helper ${helperId} generating verification response`);
      
      const response = derecLib.ts_generate_verification_response(
        secretIdBytes,
        BigInt(helperId),
        share.shareData,
        requestBytes
      );
      
      console.log(`Helper ${helperId} generated verification response:`, response);
      
      sendMessage({
        type: 'VERIFICATION_RESPONSE',
        to: 'owner',
        secretId: message.secretId,
        responseData: uint8ArrayToBase64(response),
        valid: true
      });
      
      addLog('success', 'Sent verification response');
    } catch (error) {
      console.error(`Helper ${helperId} failed to generate verification response:`, error);
      addLog('error', `Verification failed: ${error}`);
      
      sendMessage({
        type: 'VERIFICATION_RESPONSE',
        to: 'owner',
        secretId: message.secretId,
        responseData: '',
        valid: false,
        reason: 'invalid'
      });
    }
  };

  return () => channel.close();
}, [storedShares, participantId, helperId, derecLib, sendMessage, addLog]);

// Handle list shares requests (for owner recovery)
useEffect(() => {
  const channel = new BroadcastChannel('derec-protocol-channel');
  
  channel.onmessage = (event) => {
    const message = event.data;
    
    if (message.type !== 'LIST_SHARES_REQUEST' || message.to !== participantId) {
      return;
    }
    
    console.log(`Helper ${helperId} received list shares request`);
    addLog('info', 'Owner requested list of stored shares');
    
    // Send back info about all stored shares
    const sharesList = storedShares.map(share => ({
      secretId: share.secretId,
      version: share.version,
      receivedAt: share.receivedAt
    }));
    
    sendMessage({
      type: 'LIST_SHARES_RESPONSE',
      to: 'owner',
      shares: sharesList
    });
    
    addLog('success', `Sent list of ${sharesList.length} shares to Owner`);
  };

  return () => channel.close();
}, [storedShares, participantId, helperId, sendMessage, addLog]);

  const helperColors = {
    1: '#3b82f6',
    2: '#10b981', 
    3: '#f59e0b'
  };

  return (
    <div className="helper-view" style={{ '--helper-color': helperColors[helperId] } as React.CSSProperties}>
      <header className="view-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <div className="header-title">
          <span className="role-badge helper">🛡️ Helper {helperId}</span>
          <h1>Share Storage</h1>
        </div>
        <div className="connection-status">
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <div className="view-content">
        <div className="main-panel">
          {/* Status Section */}
          <section className="workflow-section status-section">
            <h2>Status</h2>
            <div className="status-grid">
              <div className={`status-card ${ownerConnected ? 'active' : ''}`}>
                <div className="status-icon">👤</div>
                <div className="status-label">Owner</div>
                <div className={`status-value ${ownerConnected ? 'online' : 'offline'}`}>
                  {ownerConnected ? 'Connected' : 'Waiting...'}
                </div>
              </div>
              <div className={`status-card ${isPaired ? 'active' : ''}`}>
                <div className="status-icon">🔗</div>
                <div className="status-label">Pairing</div>
                <div className={`status-value ${isPaired ? 'paired' : 'unpaired'}`}>
                  {isPaired ? 'Paired' : 'Not paired'}
                </div>
              </div>
              <div className={`status-card ${storedShares.length > 0 ? 'active' : ''}`}>
                <div className="status-icon">📦</div>
                <div className="status-label">Shares</div>
                <div className="status-value">
                  {storedShares.length} stored
                </div>
              </div>
            </div>
          </section>

          {/* Stored Shares */}
          <section className="workflow-section">
            <h2>Stored Shares</h2>
            {storedShares.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>No shares stored yet</p>
                <p className="empty-hint">Shares will appear here when the Owner protects a secret</p>
              </div>
            ) : (
              <div className="shares-list">
                {storedShares.map(share => (
                  <div key={share.secretId} className="share-card">
                    <div className="share-icon">🔐</div>
                    <div className="share-info">
                      <span className="share-id">
                        Secret: {share.secretId.slice(0, 12)}...
                      </span>
                      <span className="share-meta">
                        Version {share.version} • {share.shareData.length} bytes
                      </span>
                      <span className="share-time">
                        Received: {new Date(share.receivedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="share-status">✓ Stored</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Instructions */}
          <section className="workflow-section info-section">
            <h2>How This Works</h2>
            <div className="info-content">
              <p>
                As a <strong>Helper</strong>, your role is to securely store secret shares 
                and return them when the Owner needs to recover their secret.
              </p>
              <ul>
                <li>📥 <strong>Receive</strong> – Accept and store shares from the Owner</li>
                <li>✅ <strong>Verify</strong> – Respond to periodic health checks</li>
                <li>📤 <strong>Return</strong> – Send shares back during recovery</li>
              </ul>
              <p className="info-note">
                Each share by itself reveals nothing about the secret. Only when 
                combined with other shares can the secret be reconstructed.
              </p>
            </div>
          </section>
        </div>

        <aside className="side-panel">
          <NetworkStatus 
            isOwner={false}
            connectedHelpers={new Map()}
            ownerConnected={ownerConnected}
            ownerLastSeen={ownerLastSeen}
          />
          <ActivityLog logs={logs} />
        </aside>
      </div>
    </div>
  );
}
