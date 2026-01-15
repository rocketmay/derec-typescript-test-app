# DeRec + TypeScript

A simple TypeScript React Vite application that demonstrates the [DeRec (Decentralized Recovery) Protocol](https://derecalliance.org/) using the DeRec Library to generate, distribute, and recover secret shares.

> ⚠️ **Disclaimer**: This project is a **demonstration only** and is NOT hardened for security. It is intended to showcase DeRec functionality in a TypeScript environment. **Do not use this for protecting real secrets.** Refer to and use this code at your own risk.

## What is DeRec?

DeRec is a protocol for decentralized secret recovery. Instead of relying on a single backup, your secret is split into multiple "shares" distributed among trusted helpers (friends, family, or services). No single helper can see your secret, but a threshold number of them can help you recover it if needed.

This demo simulates the protocol using browser tabs communicating via the BroadcastChannel API.

## Installation

### Prerequisites

- Node.js (v18+)
- npm
- A local clone of the DeRec library

### Setup

1. Clone this repository:
   ```bash
   git clone <this-repo-url>
   cd derec-typescript-demo
   ```

2. Clone the DeRec library (if you haven't already):
   ```bash
   git clone https://github.com/derecalliance/lib-derec ../lib-derec
   ```

3. Build the DeRec library WASM bindings (follow instructions in lib-derec repo)

4. Update `package.json` to point to your local lib-derec clone:
   ```json
   "dependencies": {
     "derec-lib": "file:../lib-derec/library/target/pkg-web"
   }
   ```

5. Install dependencies:
   ```bash
   npm install
   ```

## Running the Demo

Start the development server:

```bash
npm run dev
```

### Testing the Workflow

1. **Open 4 browser tabs** pointing to the app (e.g., `http://localhost:5173`)

2. **Select roles in each tab:**
   - Tab 1: Select **Owner**
   - Tab 2: Select **Helper 1**
   - Tab 3: Select **Helper 2**
   - Tab 4: Select **Helper 3**

3. **Owner Setup:**
   - Enter your name (e.g., "Bob")
   - Select "Normal Mode" for protecting new secrets
   - Click "Continue"

4. **Pairing:**
   - In the Owner tab, click "Request Pairing"
   - In each Helper tab, you'll see "Bob wants to pair with you" — click **Approve**
   - Wait until all 3 helpers are paired

5. **Protect a Secret:**
   - Enter a secret name and value
   - Click "Protect Secret"
   - Watch shares get distributed to each Helper tab

6. **Recovery (Normal):**
   - Click "Recover" on a protected secret
   - Helpers automatically respond (they already approved the owner at pairing time)
   - Secret is reconstructed when threshold shares are received

7. **Recovery (After Device Loss):**
   - Close the Owner tab (simulating device loss)
   - Open a new tab, select Owner
   - Enter the same name ("Bob") and select "Recovery Mode"
   - Pair with helpers — they'll see "Bob is trying to RECOVER" with existing secret count
   - After approval, discover and recover your secrets

## Implemented Features

### Core Protocol

| Feature | Status | Description |
|---------|--------|-------------|
| Pairing | ✅ | Owner establishes secure channels with helpers |
| Secret Sharing | ✅ | Splits secrets using threshold cryptography (2-of-3) |
| Share Distribution | ✅ | Distributes unique shares to each helper |
| Periodic Verification | ✅ | Verifies helper share integrity every 10 seconds |
| Secret Recovery | ✅ | Reconstructs secret from threshold shares |
| Owner Identity | ✅ | Helpers see owner's name during pairing |
| Recovery Mode | ✅ | Distinct flow for recovering after device loss |
| Pairing Approval | ✅ | Helpers must approve pairing requests |
| Lost Share Detection | ✅ | Detects when a helper has lost their share |
| Re-sharing | ✅ | Can redistribute shares after helper failure |
| Share Versioning | ✅ | Shares are annotated with version numbers |

### User Experience

- Visual network status showing helper connectivity
- Activity log with timestamped events
- Status indicators for share verification
- Recovery mode with secret discovery from helpers
- Grouped share display by owner (helper view)

## What's Missing (Non-Exhaustive)

This demo omits many features required for a production implementation:

### Security

| Missing Feature | Risk |
|-----------------|------|
| **Message encryption** | Messages are sent in plaintext via BroadcastChannel |
| **Message signing** | No cryptographic verification of message authenticity |
| **Secure channel establishment** | Contact messages don't establish real encrypted channels |
| **Nonce/replay protection** | Messages could be replayed by an attacker |
| **Owner authentication** | Name matching is simple string comparison, not cryptographic |
| **Helper authentication** | No verification that helpers are who they claim to be |

### Protocol Compliance

| Missing Feature | Description |
|-----------------|-------------|
| **Unpair protocol** | No way to remove a helper from the set |
| **Keep list management** | Old share versions are never cleaned up |
| **Exponential backoff** | Verification uses fixed interval, not exponential retry |
| **Parameter negotiation** | No negotiation of retry intervals, thresholds, etc. |
| **Partial vs full recovery response** | Helpers return all shares regardless of pairing mode |
| **Security threshold enforcement** | Recovery threshold can drop below safe levels |
| **Multiple secrets per owner** | Limited support for managing multiple secrets |

### Error Handling

| Missing Feature | Description |
|-----------------|-------------|
| **Network failure recovery** | No reconnection logic or message queuing |
| **Timeout handling** | Requests don't timeout or retry properly |
| **Malicious share detection** | No Merkle proof verification during recovery |
| **Byzantine fault tolerance** | Trusts that helpers return correct shares |
| **Concurrent operation handling** | Race conditions possible with multiple operations |

### Data Persistence

| Missing Feature | Description |
|-----------------|-------------|
| **Persistent storage** | All state is lost on page refresh |
| **Share backup** | Helpers don't persist shares to disk |
| **Owner state backup** | Owner's secret list isn't persisted |
| **Cross-session recovery** | Can't recover across browser sessions |

### Production Requirements

| Missing Feature | Description |
|-----------------|-------------|
| **Real network transport** | Uses BroadcastChannel instead of actual network |
| **TLS/HTTPS** | No transport layer security |
| **Rate limiting** | No protection against flooding attacks |
| **Audit logging** | No tamper-proof activity records |
| **Key rotation** | No mechanism to rotate cryptographic keys |
| **Regulatory compliance** | No data retention policies |
| **Accessibility** | Limited ARIA labels and keyboard navigation |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Tabs                           │
├─────────────┬─────────────┬─────────────┬─────────────────┤
│   Owner     │  Helper 1   │  Helper 2   │    Helper 3     │
│   Tab       │    Tab      │    Tab      │      Tab        │
├─────────────┴─────────────┴─────────────┴─────────────────┤
│                   BroadcastChannel API                      │
│              (simulates network transport)                  │
├─────────────────────────────────────────────────────────────┤
│                    DeRec WASM Library                       │
│         (cryptographic operations, secret sharing)          │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Description |
|------|-------------|
| `src/App.tsx` | Main app with WASM initialization and role selection |
| `src/components/OwnerView.tsx` | Owner interface for protecting/recovering secrets |
| `src/components/HelperView.tsx` | Helper interface for storing shares and approvals |
| `src/types/derec.ts` | TypeScript types for messages and state |
| `src/hooks/useBroadcastChannel.ts` | Communication layer abstraction |

### DeRec Library Functions Used

| Function | Purpose |
|----------|---------|
| `ts_create_contact_message` | Creates pairing contact message |
| `ts_protect_secret` | Splits secret into threshold shares |
| `ts_generate_share_request` | Creates recovery request |
| `ts_generate_share_response` | Wraps share for recovery response |
| `ts_recover_from_share_responses` | Reconstructs secret from shares |
| `ts_generate_verification_request` | Creates share verification challenge |
| `ts_generate_verification_response` | Responds to verification challenge |

## Contributing

This is a demonstration project. For contributions to the DeRec protocol or library, please visit:

- [DeRec Alliance](https://derecalliance.org/)
- [DeRec Library](https://github.com/derecalliance/lib-derec)
- [DeRec Protocol Specification](https://github.com/derecalliance/protocol)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [DeRec Alliance](https://derecalliance.org/) for the protocol specification and library
- Built with [React](https://react.dev/), [Vite](https://vitejs.dev/), and [TypeScript](https://www.typescriptlang.org/)