import { useState, useCallback, useEffect } from 'react';
import type { 
  HelperId, 
  StoredShare,
  DeRecMessage,
  PendingPairingRequest,
  KnownOwner
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
  
  // Pairing approval state
  const [pendingPairingRequests, setPendingPairingRequests] = useState<PendingPairingRequest[]>([]);
  
  // Track known owners (for recovery mode)
  const [knownOwners, setKnownOwners] = useState<KnownOwner[]>([]);
  
  // Currently paired owner name
  const [pairedOwnerName, setPairedOwnerName] = useState<string | null>(null);

  const participantId = `helper-${helperId}`;

  const handleMessage = useCallback((message: DeRecMessage) => {
    switch (message.type) {
      case 'ANNOUNCE':
        if (message.role === 'owner') {
          if (!ownerConnected) {
            addLog('info', 'Owner came online');
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
        // Don't auto-accept - add to pending approvals
        const existingOwner = knownOwners.find(o => o.name === message.ownerName);
        const existingSecretCount = existingOwner ? existingOwner.secretIds.length : 0;
        
        // Check if we already have a pending request from this owner
        const alreadyPending = pendingPairingRequests.find(p => p.ownerName === message.ownerName);
        if (alreadyPending) {
          addLog('info', `Already have pending request from "${message.ownerName}"`);
          return;
        }
        
        setPendingPairingRequests(prev => [...prev, {
          channelId: message.channelId,
          ownerName: message.ownerName,
          isRecoveryMode: message.isRecoveryMode,
          contactMessage: message.contactMessage,
          requestedAt: Date.now(),
          existingSecretCount
        }]);
        
        if (message.isRecoveryMode && existingSecretCount > 0) {
          addLog('warning', `⚠️ "${message.ownerName}" is trying to RECOVER (you have ${existingSecretCount} secret(s) stored)`);
        } else if (message.isRecoveryMode) {
          addLog('warning', `⚠️ "${message.ownerName}" is trying to recover (no existing secrets found)`);
        } else {
          addLog('info', `"${message.ownerName}" is requesting to pair with you`);
        }
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
            receivedAt: Date.now(),
            ownerName: pairedOwnerName || 'Unknown'
          }];
        });
        
        // Update known owner's secret list
        if (pairedOwnerName) {
          setKnownOwners(prev => {
            const existing = prev.find(o => o.name === pairedOwnerName);
            if (existing) {
              if (!existing.secretIds.includes(message.secretId)) {
                return prev.map(o => o.name === pairedOwnerName 
                  ? { ...o, secretIds: [...o.secretIds, message.secretId], lastSeenAt: Date.now() }
                  : o
                );
              }
              return prev.map(o => o.name === pairedOwnerName 
                ? { ...o, lastSeenAt: Date.now() }
                : o
              );
            }
            return prev;
          });
        }
        
        addLog('success', `Stored share for secret ${message.secretId.slice(0, 8)}... from "${pairedOwnerName}"`);
        
        // Send ACK
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
        // Auto-respond to recovery requests (authentication happened at pairing time)
        addLog('info', `Recovery request for secret ${message.secretId.slice(0, 8)}...`);
        
        const recoveryShare = storedShares.find(s => s.secretId === message.secretId);
        if (recoveryShare) {
          addLog('success', 'Auto-sending share for recovery (owner was authenticated at pairing)');
        } else {
          addLog('warning', 'Share not found for requested secret');
        }
        break;

      case 'VERIFICATION_REQUEST':
        // Handled by separate useEffect for fresh state access
        break;
    }
  }, [helperId, addLog, knownOwners, pendingPairingRequests, pairedOwnerName, storedShares]);

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
  }, [storedShares, sendMessage, helperId]);

  // Handle recovery requests - AUTO-RESPOND (no manual approval needed)
  useEffect(() => {
    const channel = new BroadcastChannel('derec-protocol-channel');
    
    channel.onmessage = (event) => {
      const message = event.data;
      
      if (message.type !== 'RECOVERY_REQUEST' || message.to !== participantId) {
        return;
      }
      
      console.log(`Helper ${helperId} received recovery request:`, message);
      
      const share = storedShares.find(s => s.secretId === message.secretId);
      
      if (!share) {
        addLog('warning', 'Recovery requested for unknown secret');
        return;
      }
      
      if (!derecLib) {
        addLog('error', 'DeRec library not available');
        return;
      }
      
      // Auto-respond - authentication happened at pairing time
      try {
        const secretIdBytes = base64ToUint8Array(message.secretId);
        const requestBytes = base64ToUint8Array(message.requestData);
        
        const response = derecLib.ts_generate_share_response(
          secretIdBytes,
          BigInt(helperId),
          share.shareData,
          requestBytes
        );
        
        sendMessage({
          type: 'RECOVERY_RESPONSE',
          to: 'owner',
          secretId: message.secretId,
          shareData: uint8ArrayToBase64(response)
        });
        
        addLog('success', `Auto-sent share for recovery (secret ${message.secretId.slice(0, 8)}...)`);
      } catch (error) {
        console.error('Failed to generate share response:', error);
        addLog('error', `Failed to send recovery share: ${error}`);
      }
    };

    return () => channel.close();
  }, [storedShares, participantId, helperId, derecLib, sendMessage, addLog]);

  // Approve a pairing request
  const approvePairing = useCallback((request: PendingPairingRequest) => {
    setIsPaired(true);
    setPairedOwnerName(request.ownerName);
    
    // Update known owners
    setKnownOwners(prev => {
      const existing = prev.find(o => o.name === request.ownerName);
      if (existing) {
        return prev.map(o => o.name === request.ownerName 
          ? { ...o, lastSeenAt: Date.now() }
          : o
        );
      }
      return [...prev, {
        name: request.ownerName,
        secretIds: [],
        firstPairedAt: Date.now(),
        lastSeenAt: Date.now()
      }];
    });
    
    // Get count of existing secrets for this owner
    const existingOwner = knownOwners.find(o => o.name === request.ownerName);
    const secretCount = existingOwner ? existingOwner.secretIds.length : 0;
    
    // Send pairing response
    sendMessage({
      type: 'PAIRING_RESPONSE',
      to: 'owner',
      channelId: request.channelId,
      responseData: '',
      accepted: true,
      existingSecretCount: secretCount
    });
    
    // Remove from pending
    setPendingPairingRequests(prev => 
      prev.filter(r => r.channelId !== request.channelId)
    );
    
    if (request.isRecoveryMode) {
      addLog('success', `Approved recovery pairing for "${request.ownerName}"`);
    } else {
      addLog('success', `Paired with "${request.ownerName}"`);
    }
  }, [knownOwners, sendMessage, addLog]);

  // Deny a pairing request
  const denyPairing = useCallback((request: PendingPairingRequest) => {
    sendMessage({
      type: 'PAIRING_RESPONSE',
      to: 'owner',
      channelId: request.channelId,
      responseData: '',
      accepted: false
    });
    
    // Remove from pending
    setPendingPairingRequests(prev => 
      prev.filter(r => r.channelId !== request.channelId)
    );
    
    addLog('info', `Rejected pairing request from "${request.ownerName}"`);
  }, [sendMessage, addLog]);

  // Handle verification requests
  useEffect(() => {
    const channel = new BroadcastChannel('derec-protocol-channel');
    
    channel.onmessage = (event) => {
      const message = event.data;
      
      if (message.type !== 'VERIFICATION_REQUEST' || message.to !== participantId) {
        return;
      }
      
      console.log(`Helper ${helperId} received verification request:`, message);
      
      const share = storedShares.find(s => s.secretId === message.secretId);
      
      if (!share) {
        console.log(`Helper ${helperId}: Share not found for verification`);
        addLog('warning', 'Share not found for verification');
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
          valid: true,
          reason: ''
        });
        
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
      
      // Send back info about all stored shares for the currently paired owner
      // In a real implementation, you'd filter by the requesting owner
      const sharesList = storedShares
        .filter(share => !pairedOwnerName || share.ownerName === pairedOwnerName)
        .map(share => ({
          secretId: share.secretId,
          version: share.version,
          receivedAt: share.receivedAt,
          ownerName: share.ownerName
        }));
      
      sendMessage({
        type: 'LIST_SHARES_RESPONSE',
        to: 'owner',
        shares: sharesList
      });
      
      addLog('success', `Sent list of ${sharesList.length} shares to Owner`);
    };

    return () => channel.close();
  }, [storedShares, participantId, helperId, pairedOwnerName, sendMessage, addLog]);

  const helperColors = {
    1: '#3b82f6',
    2: '#10b981', 
    3: '#f59e0b'
  };

  // Group shares by owner for display
  const sharesByOwner = storedShares.reduce((acc, share) => {
    const owner = share.ownerName || 'Unknown';
    if (!acc[owner]) {
      acc[owner] = [];
    }
    acc[owner].push(share);
    return acc;
  }, {} as Record<string, StoredShare[]>);

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
                  {isPaired ? `Paired with ${pairedOwnerName}` : 'Not paired'}
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

          {/* Pending Pairing Approvals */}
          {pendingPairingRequests.length > 0 && (
            <section className="workflow-section approval-section">
              <h2>⚠️ Pairing Requests</h2>
              <p className="section-description">
                Someone is requesting to pair with you. Verify their identity before approving.
              </p>
              <div className="approval-list">
                {pendingPairingRequests.map(request => (
                  <div key={request.channelId} className={`approval-card ${request.isRecoveryMode ? 'recovery' : ''}`}>
                    <div className="approval-icon">
                      {request.isRecoveryMode ? '🔄' : '🔗'}
                    </div>
                    <div className="approval-content">
                      <p className="approval-message">
                        {request.isRecoveryMode ? (
                          request.existingSecretCount > 0 ? (
                            <>
                              <strong>"{request.ownerName}"</strong> is trying to <strong>recover</strong> their secrets.
                              <br />
                              <span className="existing-secrets-info">
                                You have <strong>{request.existingSecretCount} secret(s)</strong> stored for this person.
                              </span>
                            </>
                          ) : (
                            <>
                              <strong>"{request.ownerName}"</strong> is trying to recover, but you have no secrets stored for them.
                            </>
                          )
                        ) : (
                          <>
                            <strong>"{request.ownerName}"</strong> wants to pair with you to store secret shares.
                          </>
                        )}
                      </p>
                      <span className="approval-meta">
                        Requested: {new Date(request.requestedAt).toLocaleTimeString()}
                      </span>
                      {request.isRecoveryMode && (
                        <p className="approval-warning">
                          ⚠️ Make sure you verify this is really "{request.ownerName}" before approving recovery!
                        </p>
                      )}
                    </div>
                    <div className="approval-actions">
                      <button 
                        className="approve-button"
                        onClick={() => approvePairing(request)}
                      >
                        ✓ Approve
                      </button>
                      <button 
                        className="deny-button"
                        onClick={() => denyPairing(request)}
                      >
                        ✕ Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Known Owners */}
          {knownOwners.length > 0 && (
            <section className="workflow-section">
              <h2>Known Owners</h2>
              <p className="section-description">
                People you've paired with and are storing secrets for.
              </p>
              <div className="known-owners-list">
                {knownOwners.map(owner => (
                  <div key={owner.name} className="known-owner-card">
                    <div className="owner-icon">👤</div>
                    <div className="owner-info">
                      <span className="owner-name">{owner.name}</span>
                      <span className="owner-meta">
                        {owner.secretIds.length} secret(s) stored • 
                        First paired: {new Date(owner.firstPairedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Stored Shares */}
          <section className="workflow-section">
            <h2>Stored Shares</h2>
            {storedShares.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>No shares stored yet</p>
                <p className="empty-hint">Shares will appear here when an Owner protects a secret after you approve their pairing request</p>
              </div>
            ) : (
              <div className="shares-by-owner">
                {Object.entries(sharesByOwner).map(([ownerName, shares]) => (
                  <div key={ownerName} className="owner-shares-group">
                    <h4 className="owner-shares-header">
                      👤 {ownerName}
                      <span className="share-count">{shares.length} share(s)</span>
                    </h4>
                    <div className="shares-list">
                      {shares.map(share => (
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
                <li>🔗 <strong>Approve Pairing</strong> – Verify the owner's identity before accepting</li>
                <li>📥 <strong>Receive</strong> – Accept and store shares from paired Owners</li>
                <li>✅ <strong>Verify</strong> – Respond to periodic health checks</li>
                <li>📤 <strong>Return</strong> – Automatically send shares back during recovery (after pairing is re-approved)</li>
              </ul>
              <p className="info-note">
                Each share by itself reveals nothing about the secret. Only when 
                combined with other shares can the secret be reconstructed.
              </p>
              <p className="info-note warning">
                <strong>Important:</strong> During recovery, you must verify the person requesting 
                is really who they claim to be before approving the pairing request!
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
