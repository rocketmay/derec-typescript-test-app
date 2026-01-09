import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import init, { ts_create_contact_message } from 'derec-lib';

function App() {
  const [wasmReady, setWasmReady] = useState(false);
  const [result, setResult] = useState<string>('');
  const [count, setCount] = useState(0)

  useEffect(() => {
    async function initWasm() {
      try {
        await init();
        setWasmReady(true);
        console.log('WASM initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize WASM:', error);
      }
    }
    initWasm();
  }, []);

  const testLibrary = () => {
    try {
      // Test with a sample channel_id and transport_uri
      const channelId = BigInt(12345);
      const transportUri = 'https://example.com/transport';
      
      const contactMessage = ts_create_contact_message(channelId, transportUri);
      console.log('Contact message:', contactMessage);
      setResult(JSON.stringify(contactMessage, (_, v) => 
        typeof v === 'bigint' ? v.toString() : v
      ));
    } catch (error) {
      console.error('Error calling library:', error);
      setResult(`Error: ${error}`);
    }
  };

  return (
    <>
<div>
      <h1>DeRec Library Test</h1>
      <p>WASM Status: {wasmReady ? '✅ Ready' : '⏳ Loading...'}</p>
      <button onClick={testLibrary} disabled={!wasmReady}>
        Test ts_create_contact_message
      </button>
      {result && <pre>{result}</pre>}
    </div>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
