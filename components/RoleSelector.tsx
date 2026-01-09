import type { Role, HelperId } from '../types/derec';

interface RoleSelectorProps {
  onSelectRole: (role: Role, helperId?: HelperId) => void;
}

export function RoleSelector({ onSelectRole }: RoleSelectorProps) {
  return (
    <div className="role-selector">
      <div className="role-selector-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">DeRec</span>
        </div>
        <h1>Decentralized Recovery Protocol</h1>
        <p className="subtitle">Select your role to begin the demonstration</p>
      </div>

      <div className="role-cards">
        <button 
          className="role-card owner-card"
          onClick={() => onSelectRole('owner')}
        >
          <div className="role-icon">👤</div>
          <h2>Owner</h2>
          <p>Create and protect secrets, initiate recovery</p>
          <div className="role-badge">1 instance needed</div>
        </button>

        <div className="helper-cards">
          {([1, 2, 3] as HelperId[]).map(id => (
            <button
              key={id}
              className="role-card helper-card"
              onClick={() => onSelectRole('helper', id)}
            >
              <div className="role-icon">🛡️</div>
              <h2>Helper {id}</h2>
              <p>Store secret shares, assist in recovery</p>
              <div className="role-badge">Channel {id}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="instructions">
        <h3>Quick Start</h3>
        <ol>
          <li>Open this app in <strong>4 browser tabs</strong></li>
          <li>Select <strong>Owner</strong> in one tab</li>
          <li>Select <strong>Helper 1, 2, and 3</strong> in the other tabs</li>
          <li>Follow the workflow to protect and recover a secret</li>
        </ol>
      </div>
    </div>
  );
}
