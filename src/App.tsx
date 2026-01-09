import { useState, useEffect } from 'react';
import init, { 
    ts_create_contact_message, 
    ts_protect_secret, 
    ts_recover_from_share_responses, 
    ts_generate_share_request, 
    ts_generate_share_response,
    ts_generate_verification_request,
    ts_generate_verification_response,
    ts_verify_share_response } from 'derec-lib';
import type { Role, HelperId } from '../types';
import { RoleSelector } from '../components/RoleSelector';
import { OwnerView } from '../components/OwnerView';
import { HelperView } from '../components/HelperView';
import './App.css';

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
    ts_generate_share_response: (
      secretId: Uint8Array,
      channelId: bigint,
      shareContent: Uint8Array,
      request: Uint8Array
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
    ts_generate_verification_response: (
      secretId: Uint8Array,
      channelId: bigint,
      shareContent: Uint8Array,
      request: Uint8Array
    ) => Uint8Array;
    ts_verify_share_response: (
      secretId: Uint8Array,
      channelId: bigint,
      shareContent: Uint8Array,
      response: Uint8Array
    ) => boolean;
  }
  
function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [helperId, setHelperId] = useState<HelperId | null>(null);
  const [derecLib, setDerecLib] = useState<DeRecLib | null>(null);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize WASM
  useEffect(() => {
    async function initWasm() {
        try {
            await init();
            setDerecLib({
                ts_create_contact_message: ts_create_contact_message,
                ts_protect_secret: ts_protect_secret,
                ts_generate_share_request: ts_generate_share_request,
                ts_generate_share_response: ts_generate_share_response,
                ts_recover_from_share_responses: ts_recover_from_share_responses,
                ts_generate_verification_request: ts_generate_verification_request,
                ts_generate_verification_response: ts_generate_verification_response,
                ts_verify_share_response: ts_verify_share_response,
              });
            console.log('WASM initialized successfully!');
          } catch (error) {
            console.error('Failed to initialize WASM:', error);
            setWasmError(String(error)); 
          } finally {
          setIsLoading(false);
        }
    }
    
    initWasm();
  }, []);

  const handleSelectRole = (selectedRole: Role, selectedHelperId?: HelperId) => {
    setRole(selectedRole);
    if (selectedHelperId) {
      setHelperId(selectedHelperId);
    }
    
    // Update page title
    if (selectedRole === 'owner') {
      document.title = 'DeRec - Owner';
    } else {
      document.title = `DeRec - Helper ${selectedHelperId}`;
    }
  };

  const handleBack = () => {
    setRole(null);
    setHelperId(null);
    document.title = 'DeRec Protocol Demo';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <h2>Initializing DeRec Protocol</h2>
          <p>Loading WASM module...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (wasmError) {
    return (
      <div className="error-screen">
        <div className="error-content">
          <div className="error-icon">⚠️</div>
          <h2>Failed to Initialize</h2>
          <p>Could not load the DeRec WASM module.</p>
          <details>
            <summary>Error Details</summary>
            <pre>{wasmError}</pre>
          </details>
          <button onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Role selection
  if (!role) {
    return <RoleSelector onSelectRole={handleSelectRole} />;
  }

  // Owner view
  if (role === 'owner') {
    return <OwnerView derecLib={derecLib} onBack={handleBack} />;
  }

  // Helper view
  if (role === 'helper' && helperId) {
    return <HelperView helperId={helperId} derecLib={derecLib} onBack={handleBack} />;
  }

  return null;
}

export default App;
