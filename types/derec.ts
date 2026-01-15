// Role types
export type Role = 'owner' | 'helper';
export type HelperId = 1 | 2 | 3;

// Message types for BroadcastChannel communication
export type MessageType = 
  | 'ANNOUNCE'
  | 'PAIRING_REQUEST'
  | 'PAIRING_RESPONSE'
  | 'SHARE_DISTRIBUTION'
  | 'SHARE_ACK'
  | 'VERIFICATION_REQUEST'
  | 'VERIFICATION_RESPONSE'
  | 'RECOVERY_REQUEST'
  | 'RECOVERY_RESPONSE'
  | 'LIST_SHARES_REQUEST'
  | 'LIST_SHARES_RESPONSE';

export interface BaseMessage {
  type: MessageType;
  from: string; // 'owner' | 'helper-1' | 'helper-2' | 'helper-3'
  to?: string;  // Target recipient, or undefined for broadcast
  timestamp: number;
}

export interface AnnounceMessage extends BaseMessage {
  type: 'ANNOUNCE';
  role: Role;
  helperId?: HelperId;
  transportUri: string;
}

export interface PairingRequestMessage extends BaseMessage {
  type: 'PAIRING_REQUEST';
  channelId: string;
  contactMessage: string; // Base64 encoded
  ownerName: string;      // Human-readable name for the owner (e.g., "Bob")
  isRecoveryMode: boolean; // True if owner is trying to recover existing secrets
}

export interface PairingResponseMessage extends BaseMessage {
  type: 'PAIRING_RESPONSE';
  channelId: string;
  responseData: string; // Base64 encoded
  accepted: boolean;
  existingSecretCount?: number; // Number of secrets already stored for this owner (in recovery mode)
}

export interface ShareDistributionMessage extends BaseMessage {
  type: 'SHARE_DISTRIBUTION';
  secretId: string;
  shareData: string; // Base64 encoded share
  version: number;
}

export interface ShareAckMessage extends BaseMessage {
  type: 'SHARE_ACK';
  secretId: string;
  received: boolean;
}

export interface VerificationRequestMessage extends BaseMessage {
  type: 'VERIFICATION_REQUEST';
  secretId: string;
  requestData: string;
}

export interface VerificationResponseMessage extends BaseMessage {
  type: 'VERIFICATION_RESPONSE';
  secretId: string;
  responseData: string;
  valid: boolean;
  reason: string;
}

export interface RecoveryRequestMessage extends BaseMessage {
  type: 'RECOVERY_REQUEST';
  secretId: string;
  requestData: string;
}

export interface RecoveryResponseMessage extends BaseMessage {
  type: 'RECOVERY_RESPONSE';
  secretId: string;
  shareData: string;
}

interface ListSharesRequestMessage extends BaseMessage {
  type: 'LIST_SHARES_REQUEST';
}

interface ListSharesResponseMessage extends BaseMessage {
  type: 'LIST_SHARES_RESPONSE';
  shares: ShareInfo[];
}

export type DeRecMessage =
  | AnnounceMessage
  | PairingRequestMessage
  | PairingResponseMessage
  | ShareDistributionMessage
  | ShareAckMessage
  | VerificationRequestMessage
  | VerificationResponseMessage
  | RecoveryRequestMessage
  | RecoveryResponseMessage
  | ListSharesRequestMessage
  | ListSharesResponseMessage;

export const OFFLINE_THRESHOLD_MS = 15000;
export const VERIFICATION_INTERVAL_MS = 10000; // Verify every 10 seconds

export interface PairedHelper {
  id: HelperId;
  channelId: bigint;
  transportUri: string;
  paired: boolean;
  hasShare: boolean;
  lastSeen?: number;
  lastVerified?: number;
  verificationStatus?: 'pending' | 'valid' | 'invalid' | 'no-share';
}

export interface StoredShare {
  secretId: string;
  shareData: Uint8Array;
  version: number;
  receivedAt: number;
  ownerName: string; // The name of the owner who shared this secret
}

export interface ProtectedSecret {
  id: string;
  name: string;
  value: string; 
  version: number;
  threshold: number;
  helperCount: number;
  createdAt: number;
}

export interface ShareInfo {
  secretId: string;
  version: number;
  receivedAt: number;
  ownerName: string; // Include owner name in share listings
}

// Log entry for UI
export interface LogEntry {
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}


// Pending pairing request that needs helper approval
export interface PendingPairingRequest {
  channelId: string;
  ownerName: string;
  isRecoveryMode: boolean;
  contactMessage: string;
  requestedAt: number;
  existingSecretCount: number; // How many secrets we already have for this owner
}

// Known owner - tracks owners this helper has paired with
export interface KnownOwner {
  name: string;
  secretIds: string[];
  firstPairedAt: number;
  lastSeenAt: number;
}

export interface PendingRecoveryRequest {
  secretId: string;
  requestData: string;
  requestedAt: number;
}

export interface PendingListSharesRequest {
  requestedAt: number;
}