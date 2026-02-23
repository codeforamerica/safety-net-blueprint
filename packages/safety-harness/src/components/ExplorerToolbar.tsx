const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#5b616b',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const selectStyle: React.CSSProperties = {
  height: '2rem',
  fontSize: '0.8125rem',
  padding: '0 0.5rem',
};

const buttonStyle: React.CSSProperties = {
  height: '2rem',
  fontSize: '0.8125rem',
  padding: '0 0.75rem',
  border: '1px solid #aeb0b5',
  borderRadius: '3px',
  cursor: 'pointer',
};

export type ViewMode = 'form' | 'raw';

export interface FormDefOption {
  id: string;
  name: string;
}

export function ExplorerToolbar({
  viewMode,
  onViewModeChange,
  formDefs,
  selectedFormDefId,
  onFormDefChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  formDefs: FormDefOption[];
  selectedFormDefId: string | null;
  onFormDefChange: (id: string | null) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
        padding: '0.5rem 0.75rem',
        background: '#f0f0f0',
        borderRadius: '4px',
        marginBottom: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <span style={labelStyle}>Layout</span>
        <select
          value={selectedFormDefId ?? ''}
          onChange={(e) => onFormDefChange(e.target.value || null)}
          style={selectStyle}
          className="usa-select"
          disabled={viewMode === 'raw'}
        >
          <option value="">Auto-generated</option>
          {formDefs.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginLeft: 'auto' }}>
        <span style={labelStyle}>View</span>
        <button
          type="button"
          onClick={() => onViewModeChange('form')}
          style={{
            ...buttonStyle,
            background: viewMode === 'form' ? '#005ea2' : '#fff',
            color: viewMode === 'form' ? '#fff' : '#1b1b1b',
          }}
        >
          Form
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('raw')}
          style={{
            ...buttonStyle,
            background: viewMode === 'raw' ? '#005ea2' : '#fff',
            color: viewMode === 'raw' ? '#fff' : '#1b1b1b',
          }}
        >
          Raw
        </button>
      </div>
    </div>
  );
}
