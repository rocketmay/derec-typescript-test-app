import { useEffect, useRef, useCallback, useState } from 'react';
import type { DeRecMessage, LogEntry } from '../types/derec';

const CHANNEL_NAME = 'derec-protocol-channel';

export function useBroadcastChannel(
  participantId: string,
  onMessage: (message: DeRecMessage) => void
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Create channel
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    setIsConnected(true);

    // Listen for messages
    channelRef.current.onmessage = (event: MessageEvent<DeRecMessage>) => {
      const message = event.data;
      
      // Ignore our own messages
      if (message.from === participantId) return;
      
      // Check if message is for us (or broadcast)
      if (message.to && message.to !== participantId) return;
      
      onMessage(message);
    };

    return () => {
      channelRef.current?.close();
      setIsConnected(false);
    };
  }, [participantId, onMessage]);

  const sendMessage = useCallback((message: Record<string,any>) => {
    if (!channelRef.current) return;
    
    const fullMessage = {
      ...message,
      from: participantId,
      timestamp: Date.now(),
    };
    
    channelRef.current.postMessage(fullMessage);
  }, [participantId]);

  return { sendMessage, isConnected };
}

// Hook for managing activity log
export function useActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, {
      timestamp: Date.now(),
      level,
      message
    }]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, addLog, clearLogs };
}

// Utility to encode/decode Uint8Array to base64
export function uint8ArrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

// Generate a random ID
export function generateId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
