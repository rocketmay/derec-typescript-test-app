import { useState, useCallback, useEffect } from 'react';

import type { 
  HelperId, 
  PairedHelper, 
  ProtectedSecret, 
  DeRecMessage,
} from '../types/derec';
import { 
  useBroadcastChannel, 
  useActivityLog,
  uint8ArrayToBase64,
  base64ToUint8Array,
  generateId 
} from '../hooks/useBroadcastChannel';
import { ActivityLog } from './ActivityLog';
import { NetworkStatus } from './NetworkStatus';

// DeRec library type
interface DeRecLib {
  ts_create_contact_message: (channelId: bigint, transportUri: string) => any;
  ts_protect_secret: (
    secretId: Uint8Array,
    secretData: Uint8Array,
    channels: BigUint64Array,
    threshold: number,
    version: number
  ) => any;
  ts_generate_share_request: (
    channelId: bigint,
    secretId: Uint8Array,
    version: number
  ) => Uint8Array;
  ts_recover_from_share_responses: (
    responses: any,
    secretId: Uint8Array,
    version: number
  ) => Uint8Array;
  ts_generate_verification_request: (
    secretId: Uint8Array,
    version: number
  ) => Uint8Array;
  ts_verify_share_response: (
    secretId: Uint8Array,
    channelId: bigint,
    shareContent: Uint8Array,
    response: Uint8Array
  ) => boolean;
}

interface OwnerViewProps {
  derecLib: DeRecLib | null;
  onBack: () => void;
}

export function OwnerView({ derecLib, onBack }: OwnerViewProps) {
  const { logs, addLog } = useActivityLog();
  const [connectedHelpers, setConnectedHelpers] = useState<Map<HelperId, boolean>>(new Map());
  const [pairedHelpers, setPairedHelpers] = useState<PairedHelper[]>([]);
  const [secrets, setSecrets] = useState<ProtectedSecret[]>([]);
  const [secretInput, setSecretInput] = useState('');
  const [secretName, setSecretName] = useState('');
  const [recoveredSecret, setRecoveredSecret] = useState<{name: string, value: string} | null>(null);
  const [pendingShares, setPendingShares] = useState<Map<string, Map<HelperId, Uint8Array>>>(new Map());
  const [workflow, setWorkflow] = useState<'idle' | 'pairing' | 'protecting' | 'recovering'>('idle');
  const [shouldVerify, setShouldVerify] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [discoveredSecrets, setDiscoveredSecrets] = useState<Map<string, { secretId: string, version: number, helperCount: number }>>(new Map());

  const handleMessage = useCallback((message: DeRecMessage) => {
    switch (message.type) {
      case 'ANNOUNCE':
        if (message.role === 'helper' && message.helperId) {
          const announcedHelperId = message.helperId;
          
          setConnectedHelpers(prev => {
            const next = new Map(prev);
            const wasAlreadyConnected = next.get(announcedHelperId);
            next.set(announcedHelperId, true);
            if (!wasAlreadyConnected) {
              addLog('info', `Helper ${announcedHelperId} came online`);
            }
            return next;
          });
          
          // Set initial lastSeen only if not already paired
          setPairedHelpers(prev => {
            const helper = prev.find(h => h.id === announcedHelperId);
            if (helper && !helper.lastSeen) {
              return prev.map(h => h.id === announcedHelperId ? { ...h, lastSeen: Date.now() } : h);
            }
            return prev;
          });
        }
      break;

      case 'PAIRING_RESPONSE':
        if (message.accepted) {
          const helperId = parseInt(message.from.split('-')[1]) as HelperId;
          setPairedHelpers(prev => {
            const existing = prev.find(h => h.id === helperId);
            if (existing) {
              return prev.map(h => h.id === helperId ? { ...h, paired: true } : h);
            }
            return [...prev, {
              id: helperId,
              channelId: BigInt(helperId),
              transportUri: `local://helper-${helperId}`,
              paired: true,
              hasShare: false,
              lastSeen: Date.now()
            }];
          });
          addLog('success', `Paired with Helper ${helperId}`);
        }
        break;

      case 'SHARE_ACK':
        console.log('Received SHARE_ACK:', message);
        if (message.received) {
          const ackHelperId = parseInt(message.from.split('-')[1]) as HelperId;
          console.log(`Processing SHARE_ACK from Helper ${ackHelperId}`);
          setPairedHelpers(prev => {
            console.log('Current pairedHelpers:', prev);
            const updated = prev.map(h => h.id === ackHelperId 
              ? { ...h, hasShare: true, lastSeen: Date.now() } 
              : h
            );
            console.log('Updated pairedHelpers:', updated);
            return updated;
          });
          addLog('success', `Helper ${ackHelperId} confirmed share receipt`);
        }
        break;

      case 'RECOVERY_RESPONSE':
        const helperId = parseInt(message.from.split('-')[1]) as HelperId;
        const shareData = base64ToUint8Array(message.shareData);
        
        setPendingShares(prev => {
          const next = new Map(prev);
          const secretShares = next.get(message.secretId) || new Map();
          secretShares.set(helperId, shareData);
          next.set(message.secretId, secretShares);
          return next;
        });
        
        addLog('info', `Received share from Helper ${helperId}`);
        break;

        case 'VERIFICATION_RESPONSE':
          console.log('Owner received VERIFICATION_RESPONSE:', message);
  
          const verifyHelperId = parseInt(message.from.split('-')[1]) as HelperId;
          const verifySecret = secrets.find(s => s.id === message.secretId);
          
          if (verifySecret) {
            if (message.valid) {
              setPairedHelpers(prev =>
                prev.map(h => h.id === verifyHelperId 
                  ? { ...h, lastSeen: Date.now(), lastVerified: Date.now(), verificationStatus: 'valid' as const }
                  : h
                )
              );
              //addLog('success', `Helper ${verifyHelperId} verified share for "${verifySecret.name}"`);
            } else if (message.reason === 'no-share') {
              setPairedHelpers(prev =>
                prev.map(h => h.id === verifyHelperId 
                  ? { ...h, lastSeen: Date.now(), hasShare: false, verificationStatus: 'no-share' as const }
                  : h
                )
              );
              addLog('warning', `Helper ${verifyHelperId} lost share for "${verifySecret.name}"`);
            } else {
              setPairedHelpers(prev =>
                prev.map(h => h.id === verifyHelperId 
                  ? { ...h, lastSeen: Date.now(), verificationStatus: 'invalid' as const }
                  : h
                )
              );
              addLog('error', `Helper ${verifyHelperId} failed verification`);
            }
          } else {
            console.log('Secret not found for verification response');
          }
        break;
        case 'LIST_SHARES_RESPONSE':
          const listHelperId = parseInt(message.from.split('-')[1]) as HelperId;
          console.log(`Received shares list from Helper ${listHelperId}:`, message.shares);
          
          // Update lastSeen
          setPairedHelpers(prev =>
            prev.map(h => h.id === listHelperId 
              ? { ...h, lastSeen: Date.now(), hasShare: message.shares.length > 0 }
              : h
            )
          );
          
          // Aggregate discovered secrets
          if (message.shares && Array.isArray(message.shares)) {
            message.shares.forEach((share: { secretId: string, version: number }) => {
              setDiscoveredSecrets(prev => {
                const next = new Map(prev);
                const existing = next.get(share.secretId);
                if (existing) {
                  next.set(share.secretId, {
                    ...existing,
                    helperCount: existing.helperCount + 1,
                    version: Math.max(existing.version, share.version)
                  });
                } else {
                  next.set(share.secretId, {
                    secretId: share.secretId,
                    version: share.version,
                    helperCount: 1
                  });
                }
                return next;
              });
            });
            addLog('info', `Helper ${listHelperId} has ${message.shares.length} share(s)`);
          }
          break;
    }
  }, [addLog, secrets]);

  const { sendMessage, isConnected } = useBroadcastChannel('owner', handleMessage);

  // Announce presence on connect
  useEffect(() => {
    if (isConnected) {
      sendMessage({
        type: 'ANNOUNCE',
        role: 'owner',
        transportUri: 'local://owner'
      });
      addLog('info', 'Owner connected to network');
    }
  }, [isConnected, sendMessage, addLog]);

  // Re-announce periodically to catch new helper tabs
  useEffect(() => {
    const interval = setInterval(() => {
      if (isConnected) {
        sendMessage({
          type: 'ANNOUNCE',
          role: 'owner',
          transportUri: 'local://owner'
        });
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isConnected, sendMessage]);

  // Pair with all available helpers
  const pairWithHelpers = useCallback(() => {
    if (!derecLib) {
      addLog('error', 'DeRec library not initialized');
      return;
    }

    setWorkflow('pairing');
    
    connectedHelpers.forEach((isOnline, helperId) => {
      if (isOnline) {
        try {
          const channelId = BigInt(helperId);
          const contactMessage = derecLib.ts_create_contact_message(
            channelId,
            `local://helper-${helperId}`
          );
          
          sendMessage({
            type: 'PAIRING_REQUEST',
            to: `helper-${helperId}`,
            channelId: helperId.toString(),
            contactMessage: typeof contactMessage === 'object' 
              ? JSON.stringify(contactMessage)
              : String(contactMessage)
          });
          
          addLog('info', `Sent pairing request to Helper ${helperId}`);
        } catch (error) {
          addLog('error', `Failed to create contact for Helper ${helperId}: ${error}`);
        }
      }
    });

    setTimeout(() => setWorkflow('idle'), 2000);
  }, [derecLib, connectedHelpers, sendMessage, addLog]);

  // Protect a secret
  const protectSecret = useCallback(() => {
    if (!derecLib) {
      addLog('error', 'DeRec library not initialized');
      return;
    }

    if (!secretInput.trim()) {
      addLog('warning', 'Please enter a secret to protect');
      return;
    }

    const pairedCount = pairedHelpers.filter(h => h.paired).length;
    if (pairedCount < 3) {
      addLog('warning', `Need at least 3 paired helpers (have ${pairedCount})`);
      return;
    }

    setWorkflow('protecting');
    
    try {
      const secretId = new Uint8Array(
        generateId().match(/.{2}/g)!.map(b => parseInt(b, 16))
      );
      const secretData = new TextEncoder().encode(secretInput);
      const channels = new BigUint64Array(
        pairedHelpers.filter(h => h.paired).map(h => h.channelId)
      );
      const threshold = 2;
      const version = 1;

      addLog('info', 'Splitting secret into shares...');
      
      const shares = derecLib.ts_protect_secret(
        secretId,
        secretData,
        channels,
        threshold,
        version
      );

// Debug: see what the library actually returns
console.log('ts_protect_secret returned:');
console.log('- type:', typeof shares);
console.log('- isArray:', Array.isArray(shares));
console.log('- value:', shares);

// Handle the Map structure returned by the library
let shareEntries: Array<[bigint, any]> = [];

if (shares && typeof shares === 'object' && 'value' in shares && shares.value instanceof Map) {
  // Library returns {value: Map(channelId -> shareData)}
  shareEntries = Array.from(shares.value.entries());
  console.log('Share entries from Map:', shareEntries);
} else if (shares instanceof Map) {
  shareEntries = Array.from(shares.entries());
} else {
  addLog('error', `Unexpected share format: ${typeof shares}`);
  setWorkflow('idle');
  return;
}

      addLog('success', `Secret split into ${channels.length} shares (threshold: ${threshold})`);

      // Distribute shares to helpers
      const secretIdStr = uint8ArrayToBase64(secretId);
      
shareEntries.forEach(([channelId, shareData]) => {
  
console.log('Paired helpers:', pairedHelpers.map(h => ({ id: h.id, paired: h.paired })));
  const helperIdNum = Number(channelId) as HelperId;
  const helper = pairedHelpers.find(h => h.id === helperIdNum);
  
  if (helper) {
    // Convert share data to base64 for transmission
    let shareDataStr: string;
    
    if (Array.isArray(shareData)) {
      // Convert number array to Uint8Array, then to base64
      const shareBytes = new Uint8Array(shareData);
      shareDataStr = uint8ArrayToBase64(shareBytes);
    } else if (shareData instanceof Uint8Array) {
      shareDataStr = uint8ArrayToBase64(shareData);
    } else {
      shareDataStr = uint8ArrayToBase64(new Uint8Array(Object.values(shareData)));
    }

    console.log(`Sending share to Helper ${helper.id}, base64 length:`, shareDataStr.length);

    sendMessage({
      type: 'SHARE_DISTRIBUTION',
      to: `helper-${helper.id}`,
      secretId: secretIdStr,
      shareData: shareDataStr,
      version
    });
    addLog('info', `Sent share to Helper ${helper.id}`);
  }
});
      

      // Record the protected secret
      setSecrets(prev => [...prev, {
        id: secretIdStr,
        name: secretName || 'Unnamed Secret',
        value: secretInput,
        version,
        threshold,
        helperCount: channels.length,
        createdAt: Date.now()
      }]);

      setSecretInput('');
      setSecretName('');
      addLog('success', 'Secret protected successfully!');
      
    } catch (error) {
      addLog('error', `Failed to protect secret: ${error}`);
    }

    setTimeout(() => setWorkflow('idle'), 1000);
  }, [derecLib, secretInput, secretName, pairedHelpers, sendMessage, addLog]);

// Request list of shares from all paired helpers (recovery mode)
const requestSharesList = useCallback(() => {
  if (pairedHelpers.filter(h => h.paired).length === 0) {
    addLog('warning', 'No paired helpers to request from');
    return;
  }
  
  setDiscoveredSecrets(new Map()); // Clear previous discoveries
  
  pairedHelpers.forEach(helper => {
    if (helper.paired) {
      sendMessage({
        type: 'LIST_SHARES_REQUEST',
        to: `helper-${helper.id}`
      });
      addLog('info', `Requested shares list from Helper ${helper.id}`);
    }
  });
}, [pairedHelpers, sendMessage, addLog]);

// Recover a discovered secret (from recovery mode)
const recoverDiscoveredSecret = useCallback((secretId: string, version: number) => {
  if (!derecLib) {
    addLog('error', 'DeRec library not initialized');
    return;
  }
  
  setWorkflow('recovering');
  setRecoveredSecret(null);
  
  addLog('info', `Recovering secret ${secretId.slice(0, 8)}...`);
  
  const secretIdBytes = base64ToUint8Array(secretId);
  
  // Request shares from all paired helpers
  pairedHelpers.forEach(helper => {
    if (helper.paired) {
      try {
        const request = derecLib.ts_generate_share_request(
          BigInt(helper.id),
          secretIdBytes,
          version
        );
        
        sendMessage({
          type: 'RECOVERY_REQUEST',
          to: `helper-${helper.id}`,
          secretId: secretId,
          requestData: uint8ArrayToBase64(request)
        });
        addLog('info', `Sent recovery request to Helper ${helper.id}`);
      } catch (error) {
        addLog('error', `Failed to generate request for Helper ${helper.id}: ${error}`);
      }
    }
  });
}, [derecLib, pairedHelpers, sendMessage, addLog]);

  // Recover a secret
const recoverSecret = useCallback((secret: ProtectedSecret) => {
  if (!derecLib) {
    addLog('error', 'DeRec library not initialized');
    return;
  }
  
  setWorkflow('recovering');
  setRecoveredSecret(null);
  
  addLog('info', `Starting recovery for "${secret.name}"...`);

  const secretIdBytes = base64ToUint8Array(secret.id);

  // Generate and send share requests to all helpers
  pairedHelpers.forEach(helper => {
    if (helper.hasShare) {
      try {
        // Generate a proper share request using the library
        const request = derecLib.ts_generate_share_request(
          BigInt(helper.id),
          secretIdBytes,
          secret.version
        );
        
        console.log(`Generated share request for Helper ${helper.id}:`, request);
        
        sendMessage({
          type: 'RECOVERY_REQUEST',
          to: `helper-${helper.id}`,
          secretId: secret.id,
          requestData: uint8ArrayToBase64(request)
        });
        addLog('info', `Sent recovery request to Helper ${helper.id}`);
      } catch (error) {
        addLog('error', `Failed to generate request for Helper ${helper.id}: ${error}`);
      }
    }
  });
}, [derecLib, pairedHelpers, sendMessage, addLog]);



// Update shouldVerify when conditions change
useEffect(() => {
  const newShouldVerify = secrets.length > 0 && pairedHelpers.some(h => h.hasShare);
  setShouldVerify(newShouldVerify);
}, [secrets, pairedHelpers]);

// Send verification requests to all helpers with shares
const verifyHelpers = useCallback(() => {
  if (!derecLib || secrets.length === 0) return;
  
  const secret = secrets[0]; // Verify the first secret
  const secretIdBytes = base64ToUint8Array(secret.id);
  
  console.log('Verifying helpers');
  
  setPairedHelpers(prev => {
    return prev.map(helper => {
      console.log(`Checking helper ${helper.id}: hasShare=${helper.hasShare}`);
      
      if (helper.hasShare) {
        try {
          const request = derecLib.ts_generate_verification_request(
            secretIdBytes,
            secret.version
          );
          
          console.log(`Sending verification request to Helper ${helper.id}`);
          
          sendMessage({
            type: 'VERIFICATION_REQUEST',
            to: `helper-${helper.id}`,
            secretId: secret.id,
            requestData: uint8ArrayToBase64(request)
          });
          
          return { ...helper, verificationStatus: 'pending' as const };
        } catch (error) {
          console.error(`Failed to generate verification request for Helper ${helper.id}:`, error);
          return helper;
        }
      }
      return helper;
    });
  });
}, [derecLib, secrets, sendMessage]);

// Periodic verification
useEffect(() => {
  if (!shouldVerify) {
    console.log('Not setting up timer - verification not needed');
    return;
  }
  
  console.log('Setting up verification timer');
  
  let initialTimeout: number;
  let interval: number;
  
  initialTimeout = setTimeout(() => {
    console.log('Initial verification (2s delay)');
    verifyHelpers();
    
    interval = setInterval(() => {
      console.log('Periodic verification (every 10s)');
      verifyHelpers();
    }, 10000);
  }, 2000);
  
  return () => {
    console.log('Cleaning up verification timer');
    clearTimeout(initialTimeout);
    if (interval) clearInterval(interval);
  };
}, [shouldVerify, verifyHelpers]);

// Attempt reconstruction when we have enough shares
// Attempt reconstruction when we have enough shares
useEffect(() => {
  if (workflow !== 'recovering' || !derecLib) return;

  // Check discovered secrets (recovery mode)
  discoveredSecrets.forEach((discovered, visSecretId) => {
    const shares = pendingShares.get(visSecretId);
    if (shares && shares.size >= 2) { // Assuming threshold of 2
      try {
        addLog('info', `Have ${shares.size} responses, attempting reconstruction...`);
        
        const secretIdBytes = base64ToUint8Array(visSecretId);
        
        const responsesMap = new Map<bigint, Uint8Array>();
        shares.forEach((data, visHelperId) => {
          responsesMap.set(BigInt(visHelperId), data);
        });
        
        const wrappedResponses = { value: responsesMap };
        
        const recovered = derecLib.ts_recover_from_share_responses(
          wrappedResponses,
          secretIdBytes,
          discovered.version
        );
        
        const recoveredText = new TextDecoder().decode(recovered);
        setRecoveredSecret({ name: `Recovered Secret`, value: recoveredText });
        
        // Add to secrets list
        if (!secrets.find(s => s.id === visSecretId)) {
          setSecrets(prev => [...prev, {
            id: visSecretId,
            name: `Recovered Secret`,
            value: recoveredText,
            version: discovered.version,
            threshold: 2,
            helperCount: discovered.helperCount,
            createdAt: Date.now()
          }]);
        }
        
        // Clear from discovered
        setDiscoveredSecrets(prev => {
          const next = new Map(prev);
          next.delete(visSecretId);
          return next;
        });
        
        addLog('success', 'Secret recovered and saved!');
        setWorkflow('idle');
        
        // Clear pending shares
        setPendingShares(prev => {
          const next = new Map(prev);
          next.delete(visSecretId);
          return next;
        });
        
      } catch (error) {
        console.error('Recovery error:', error);
        addLog('error', `Reconstruction failed: ${error}`);
        setWorkflow('idle');
      }
    }
  });

  // Check known secrets (normal recovery)
  secrets.forEach(secret => {
    const shares = pendingShares.get(secret.id);
    if (shares && shares.size >= secret.threshold) {
      try {
        addLog('info', `Have ${shares.size}/${secret.threshold} responses, attempting reconstruction...`);
        
        const secretIdBytes = base64ToUint8Array(secret.id);
        
        const responsesMap = new Map<bigint, Uint8Array>();
        shares.forEach((data, visHelperId) => {
          responsesMap.set(BigInt(visHelperId), data);
        });
        
        const wrappedResponses = { value: responsesMap };
        
        const recovered = derecLib.ts_recover_from_share_responses(
          wrappedResponses,
          secretIdBytes,
          secret.version
        );
        
        const recoveredText = new TextDecoder().decode(recovered);
        setRecoveredSecret({ name: secret.name, value: recoveredText });
        addLog('success', `Secret "${secret.name}" recovered successfully!`);
        setWorkflow('idle');
        
        setPendingShares(prev => {
          const next = new Map(prev);
          next.delete(secret.id);
          return next;
        });
        
      } catch (error) {
        console.error('Recovery error:', error);
        addLog('error', `Reconstruction failed: ${error}`);
        setWorkflow('idle');
      }
    }
  });
}, [workflow, derecLib, secrets, discoveredSecrets, pendingShares, addLog]);

// Re-share a secret with all paired helpers
const reshareSecret = useCallback((secret: ProtectedSecret) => {
  if (!derecLib) {
    addLog('error', 'DeRec library not initialized');
    return;
  }

  const pairedCount = pairedHelpers.filter(h => h.paired).length;
  if (pairedCount < 3) {
    addLog('warning', `Need at least 3 paired helpers (have ${pairedCount})`);
    return;
  }

  setWorkflow('protecting');
  addLog('info', `Re-sharing "${secret.name}" with all helpers...`);

  try {
    const secretIdBytes = base64ToUint8Array(secret.id);
    const secretData = new TextEncoder().encode(secret.value);
    const channels = new BigUint64Array(
      pairedHelpers.filter(h => h.paired).map(h => h.channelId)
    );
    const newVersion = secret.version + 1;

    const shares = derecLib.ts_protect_secret(
      secretIdBytes,
      secretData,
      channels,
      secret.threshold,
      newVersion
    );

    // Handle the Map structure returned by the library
    let shareEntries: Array<[bigint, any]> = [];
    if (shares && typeof shares === 'object' && 'value' in shares && shares.value instanceof Map) {
      shareEntries = Array.from(shares.value.entries());
    } else if (shares instanceof Map) {
      shareEntries = Array.from(shares.entries());
    } else {
      addLog('error', `Unexpected share format: ${typeof shares}`);
      setWorkflow('idle');
      return;
    }

    // Distribute shares to helpers
    shareEntries.forEach(([channelId, shareData]) => {
      const visHelperIdNum = Number(channelId) as HelperId;
      const helper = pairedHelpers.find(h => h.id === visHelperIdNum);
      
      if (helper) {
        let shareDataStr: string;
        if (Array.isArray(shareData)) {
          const shareBytes = new Uint8Array(shareData);
          shareDataStr = uint8ArrayToBase64(shareBytes);
        } else if (shareData instanceof Uint8Array) {
          shareDataStr = uint8ArrayToBase64(shareData);
        } else {
          shareDataStr = uint8ArrayToBase64(new Uint8Array(Object.values(shareData)));
        }

        sendMessage({
          type: 'SHARE_DISTRIBUTION',
          to: `helper-${helper.id}`,
          secretId: secret.id,
          shareData: shareDataStr,
          version: newVersion
        });
        addLog('info', `Sent new share to Helper ${helper.id}`);
      }
    });

    // Update secret version
    setSecrets(prev => prev.map(s => 
      s.id === secret.id ? { ...s, version: newVersion } : s
    ));

    // Reset helper share status - they'll send ACKs when they receive new shares
    setPairedHelpers(prev =>
      prev.map(h => h.paired ? { ...h, hasShare: false, verificationStatus: undefined } : h)
    );

    addLog('success', `Re-shared "${secret.name}" (v${newVersion}) with all helpers`);
    
  } catch (error) {
    addLog('error', `Failed to re-share secret: ${error}`);
  }

  setTimeout(() => setWorkflow('idle'), 1000);
}, [derecLib, pairedHelpers, sendMessage, addLog]);

  const pairedCount = pairedHelpers.filter(h => h.paired).length;
  const onlineCount = connectedHelpers.size;

  return (
    <div className="owner-view">
      <header className="view-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <div className="header-title">
          <span className="role-badge owner">👤 Owner</span>
          <h1>Secret Management</h1>
        </div>
        <div className="connection-status">
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </header>

      <div className="view-content">
        <div className="main-panel">
          {/* Step 1: Pairing */}
          <section className="workflow-section">
            <h2>
              <span className="step-number">1</span>
              Pair with Helpers
            </h2>
            <p className="section-description">
              Establish secure channels with at least 3 helpers before protecting secrets.
            </p>
            <div className="section-status">
              <span className={`status-badge ${pairedCount >= 3 ? 'success' : 'pending'}`}>
                {pairedCount}/3 helpers paired
              </span>
              <span className="status-info">{onlineCount} online</span>
            </div>
            <button 
              className="action-button"
              onClick={pairWithHelpers}
              disabled={onlineCount === 0 || workflow === 'pairing'}
            >
              {workflow === 'pairing' ? 'Pairing...' : 'Pair with Online Helpers'}
            </button>
          </section>

          {/* Recovery Mode Section */}
          <section className="workflow-section">
            <h2>
              <span className="step-number">🔄</span>
              Recovery Mode
            </h2>
            <p className="section-description">
              Lost your secrets? Request them from your helpers.
            </p>
            
            <button 
              className="action-button"
              onClick={() => {
                setIsRecoveryMode(true);
                requestSharesList();
              }}
              disabled={pairedCount === 0 || workflow !== 'idle'}
            >
              🔍 Discover Secrets from Helpers
            </button>
            
            {discoveredSecrets.size > 0 && (
              <div className="discovered-secrets">
                <h4>Discovered Secrets:</h4>
                {Array.from(discoveredSecrets.entries()).map(([secretId, info]) => (
                  <div key={secretId} className="discovered-secret-card">
                    <div className="secret-info">
                      <span className="secret-id">ID: {secretId.slice(0, 12)}...</span>
                      <span className="secret-meta">
                        v{info.version} • Found on {info.helperCount} helper(s)
                      </span>
                    </div>
                    <button
                      className="recover-button"
                      onClick={() => recoverDiscoveredSecret(secretId, info.version)}
                      disabled={workflow !== 'idle' || info.helperCount < 2}
                    >
                      🔓 Recover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Step 2: Protect Secret */}
          <section className="workflow-section">
            <h2>
              <span className="step-number">2</span>
              Protect a Secret
            </h2>
            <p className="section-description">
              Split your secret into shares and distribute to paired helpers.
            </p>
            <div className="secret-input-group">
              <input
                type="text"
                placeholder="Secret name (optional)"
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                className="secret-name-input"
              />
              <textarea
                placeholder="Enter your secret (password, key, etc.)"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                className="secret-textarea"
                rows={3}
              />
            </div>
            <button 
              className="action-button primary"
              onClick={protectSecret}
              disabled={pairedCount < 3 || !secretInput.trim() || workflow === 'protecting'}
            >
              {workflow === 'protecting' ? 'Protecting...' : '🔒 Protect Secret'}
            </button>
          </section>

          {/* Step 3: Protected Secrets & Recovery */}
          <section className="workflow-section">
            <h2>
              <span className="step-number">3</span>
              Protected Secrets
            </h2>
            {secrets.length === 0 ? (
              <p className="empty-state">No secrets protected yet</p>
            ) : (
              <div className="secrets-list">
                {secrets.map(secret => {
                  const helpersNeedingShare = pairedHelpers.filter(
                    h => h.paired && (h.verificationStatus === 'no-share' || h.verificationStatus === 'invalid' || !h.hasShare)
                  );
                  const showReshare = helpersNeedingShare.length > 0;
                  
                  return (
                    <div key={secret.id} className="secret-card">
                      <div className="secret-info">
                        <span className="secret-name">{secret.name}</span>
                        <span className="secret-meta">
                          v{secret.version} • {secret.threshold}/{secret.helperCount} threshold
                        </span>
                      </div>
                      <div className="secret-actions">
                        {showReshare && (
                          <button
                            className="reshare-button"
                            onClick={() => reshareSecret(secret)}
                            disabled={workflow !== 'idle'}
                            title="Re-distribute shares to all helpers"
                          >
                            🔄 Re-share
                          </button>
                        )}
                        <button
                          className="recover-button"
                          onClick={() => recoverSecret(secret)}
                          disabled={workflow !== 'idle'}
                        >
                          {workflow === 'recovering' ? '⏳' : '🔓'} Recover
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {recoveredSecret && (
              <div className="recovered-secret">
                <h4>🎉 Recovered: {recoveredSecret.name}</h4>
                <code>{recoveredSecret.value}</code>
              </div>
            )}
          </section>
        </div>

        <aside className="side-panel">
          <NetworkStatus 
            isOwner={true}
            connectedHelpers={connectedHelpers}
            pairedHelpers={pairedHelpers}
          />
          <ActivityLog logs={logs} />
        </aside>
      </div>
    </div>
  );
}
