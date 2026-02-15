import React, { useState, useCallback, useEffect } from 'react';
import yaml from 'js-yaml';
import type { FormContract } from './types';

interface ContractPreviewProps {
  yamlSource: string;
  initialContract: FormContract;
  onContractChange: (contract: FormContract) => void;
  currentPageId?: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ParseStatus = { valid: true } | { valid: false; error: string };

/**
 * Editable side-by-side view: YAML editor on the left, rendered form on the right.
 * Edits are parsed live and update the form. Save writes back to disk.
 */
export function ContractPreview({
  yamlSource,
  initialContract,
  onContractChange,
  currentPageId,
  children,
}: ContractPreviewProps & { children: React.ReactNode }) {
  const [showSource, setShowSource] = useState(true);
  const [source, setSource] = useState(yamlSource);
  const [parseStatus, setParseStatus] = useState<ParseStatus>({ valid: true });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);

  // Reset when the file-imported YAML changes (Vite HMR)
  useEffect(() => {
    setSource(yamlSource);
    setDirty(false);
    setParseStatus({ valid: true });
  }, [yamlSource]);

  const handleChange = useCallback(
    (newSource: string) => {
      setSource(newSource);
      setDirty(true);
      setSaveStatus('idle');

      try {
        const parsed = yaml.load(newSource) as FormContract;
        if (parsed?.form?.pages) {
          setParseStatus({ valid: true });
          onContractChange(parsed);
        } else {
          setParseStatus({ valid: false, error: 'Missing form.pages structure' });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Parse error';
        setParseStatus({ valid: false, error: msg });
      }
    },
    [onContractChange],
  );

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/__save-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: source }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setDirty(false);
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [source]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && showSource) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, showSource]);

  return (
    <div style={{ display: 'flex', gap: '1.5rem', minHeight: '80vh' }}>
      {showSource && (
        <div
          style={{
            flex: '0 0 45%',
            display: 'flex',
            flexDirection: 'column',
            background: '#1e1e2e',
            borderRadius: '8px',
            padding: '1rem',
            maxHeight: '85vh',
          }}
        >
          {/* Header bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem',
              borderBottom: '1px solid #444',
              paddingBottom: '0.5rem',
              gap: '0.5rem',
            }}
          >
            <span
              style={{
                color: '#cdd6f4',
                fontWeight: 600,
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            >
              person-intake.yaml
              {dirty && <span style={{ color: '#f9e2af' }}> (modified)</span>}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleSave}
                disabled={!dirty || !parseStatus.valid || saveStatus === 'saving'}
                style={{
                  background: dirty && parseStatus.valid ? '#89b4fa' : 'transparent',
                  border: '1px solid #666',
                  color: dirty && parseStatus.valid ? '#1e1e2e' : '#888',
                  borderRadius: '4px',
                  padding: '2px 10px',
                  cursor: dirty && parseStatus.valid ? 'pointer' : 'default',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {saveStatus === 'saving'
                  ? 'Saving...'
                  : saveStatus === 'saved'
                    ? 'Saved'
                    : 'Save'}
              </button>
              <button
                onClick={() => setShowSource(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid #666',
                  color: '#cdd6f4',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Hide
              </button>
            </div>
          </div>

          {/* Parse error banner */}
          {!parseStatus.valid && (
            <div
              style={{
                background: '#45243a',
                color: '#f38ba8',
                padding: '0.4rem 0.6rem',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
                marginBottom: '0.5rem',
                whiteSpace: 'pre-wrap',
              }}
            >
              {parseStatus.error}
            </div>
          )}

          {/* Editable YAML */}
          <textarea
            value={source}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              margin: 0,
              padding: 0,
              background: 'transparent',
              color: '#cdd6f4',
              fontFamily: 'monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              border: 'none',
              outline: 'none',
              resize: 'none',
              tabSize: 2,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {!showSource && (
          <button
            onClick={() => setShowSource(true)}
            style={{
              marginBottom: '0.75rem',
              background: '#1e1e2e',
              color: '#cdd6f4',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: 'monospace',
            }}
          >
            Show YAML
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
