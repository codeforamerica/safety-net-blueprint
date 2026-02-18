import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import yaml from 'js-yaml';
import type { FormContract, PermissionsPolicy } from './types';
import {
  toKebabCase,
  customDisplayName as toDisplayName,
  customStoryId,
} from './naming';
import { REFERENCE_CONTENT } from './contract-reference';
import { useViewportAutoHide } from './useViewportAutoHide';
import { useEditorVisibility } from './EditorVisibilityContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorTab {
  id: string;
  label: string;
  filename: string;
  source: string;
  readOnly?: boolean;
  group?: 'reference';
}

interface ContractPreviewProps {
  tabs: EditorTab[];
  contractId?: string;
  role?: string;
  category?: string;
  onLayoutChange: (contract: FormContract) => void;
  onPermissionsChange: (policy: PermissionsPolicy) => void;
  onTestDataChange: (data: Record<string, unknown>) => void;
  children: React.ReactNode;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ParseStatus = { valid: true } | { valid: false; error: string };

interface TabState {
  source: string;
  dirty: boolean;
  parseStatus: ParseStatus;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST a single file to the save-contract endpoint. */
async function saveFile(filename: string, content: string): Promise<boolean> {
  const res = await fetch('/__save-contract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, filename }),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tabButtonStyle = (active: boolean) => ({
  background: active ? '#313244' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #89b4fa' : '2px solid transparent',
  color: active ? '#cdd6f4' : '#888',
  padding: '6px 12px',
  cursor: 'pointer' as const,
  fontSize: '12px',
  fontFamily: 'monospace',
  fontWeight: active ? 600 : (400 as number),
});

const customButtonStyle = (enabled: boolean) => ({
  background: 'transparent',
  border: enabled ? '1px solid #89b4fa' : '1px solid #666',
  color: enabled ? '#89b4fa' : '#888',
  borderRadius: '4px',
  padding: '2px 10px',
  cursor: enabled ? ('pointer' as const) : ('default' as const),
  fontSize: '12px',
  fontWeight: 600,
});

const updateButtonStyle = (enabled: boolean) => ({
  background: enabled ? '#a6e3a1' : 'transparent',
  border: '1px solid #666',
  color: enabled ? '#1e1e2e' : '#888',
  borderRadius: '4px',
  padding: '2px 10px',
  cursor: enabled ? ('pointer' as const) : ('default' as const),
  fontSize: '12px',
  fontWeight: 600,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContractPreview({
  tabs,
  contractId,
  role,
  category,
  onLayoutChange,
  onPermissionsChange,
  onTestDataChange,
  children,
}: ContractPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { visible: showSource, setVisible: setShowSource } = useEditorVisibility();
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? '');
  const [activeReferenceId, setActiveReferenceId] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Detect narrow viewport (mobile/tablet).  When the viewport shrinks,
  // the hook calls setShowSource(false) which flows back through context
  // to update the Storybook toolbar, keeping everything in sync.
  const isNarrowViewport = useViewportAutoHide(containerRef, setShowSource);

  // Collect reference-group tabs and build a synthetic "Reference" top-level tab.
  // Syntax reference is first so it's the default sub-tab.
  const referenceTabs = useMemo<EditorTab[]>(() => {
    const grouped = tabs.filter((t) => t.group === 'reference');
    return [
      { id: 'syntax', label: 'Syntax', filename: 'Form Contract Reference', source: REFERENCE_CONTENT, readOnly: true, group: 'reference' },
      ...grouped,
    ];
  }, [tabs]);

  // Top-level tabs: non-grouped tabs + a single "Reference" tab
  const topLevelTabs = useMemo<EditorTab[]>(
    () => tabs.filter((t) => !t.group),
    [tabs],
  );

  // Initialize the active reference sub-tab
  if (!activeReferenceId && referenceTabs.length > 0 && activeReferenceId !== referenceTabs[0].id) {
    setActiveReferenceId(referenceTabs[0].id);
  }

  // All tabs for state tracking (top-level + all reference sub-tabs)
  const allTabs = useMemo<EditorTab[]>(() => [
    ...topLevelTabs,
    ...referenceTabs,
  ], [topLevelTabs, referenceTabs]);

  // Per-tab state keyed by tab id
  const [tabStates, setTabStates] = useState<Record<string, TabState>>(() => {
    const initial: Record<string, TabState> = {};
    for (const tab of allTabs) {
      initial[tab.id] = {
        source: tab.source,
        dirty: false,
        parseStatus: { valid: true },
      };
    }
    return initial;
  });

  // Reset tab state when imported sources change (Vite HMR)
  useEffect(() => {
    setTabStates(() => {
      const next: Record<string, TabState> = {};
      for (const tab of allTabs) {
        next[tab.id] = {
          source: tab.source,
          dirty: false,
          parseStatus: { valid: true },
        };
      }
      return next;
    });
  }, [tabs.map((t) => t.source).join('\0')]);

  const isReferenceActive = activeTabId === 'reference';
  const activeTab = isReferenceActive
    ? referenceTabs.find((t) => t.id === activeReferenceId) ?? referenceTabs[0]
    : allTabs.find((t) => t.id === activeTabId) ?? allTabs[0];
  const state = isReferenceActive
    ? tabStates[activeReferenceId]
    : tabStates[activeTabId];

  const handleChange = useCallback(
    (newSource: string) => {
      let parseStatus: ParseStatus = { valid: true };

      try {
        const parsed = yaml.load(newSource);

        // Route parsed data to the appropriate callback
        if (activeTabId === 'layout') {
          const contract = parsed as FormContract;
          if (contract?.form?.pages) {
            onLayoutChange(contract);
          } else {
            parseStatus = { valid: false, error: 'Missing form.pages structure' };
          }
        } else if (activeTabId === 'permissions') {
          const policy = parsed as PermissionsPolicy;
          if (policy?.role && policy?.defaults) {
            onPermissionsChange(policy);
          } else {
            parseStatus = { valid: false, error: 'Missing role or defaults' };
          }
        } else if (activeTabId === 'test-data') {
          const data = parsed as Record<string, unknown>;
          if (data && typeof data === 'object') {
            onTestDataChange(data);
          } else {
            parseStatus = { valid: false, error: 'Expected a YAML object' };
          }
        }
        // schema tab is read-only, no callback needed
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Parse error';
        parseStatus = { valid: false, error: msg };
      }

      setTabStates((prev) => ({
        ...prev,
        [activeTabId]: {
          source: newSource,
          dirty: true,
          parseStatus,
        },
      }));
    },
    [activeTabId, onLayoutChange, onPermissionsChange, onTestDataChange],
  );

  /**
   * Save all editable tabs to a custom story directory.
   * customDir is e.g. "custom/application-intake.citizen"
   */
  const saveAllTabs = useCallback(
    async (customDir: string): Promise<boolean> => {
      const tabFiles: Record<string, string> = {
        'test-data': `${customDir}/test-data.yaml`,
        layout: `${customDir}/layout.yaml`,
        permissions: `${customDir}/permissions.yaml`,
      };

      setSaveStatus('saving');
      try {
        const results = await Promise.all(
          Object.entries(tabFiles).map(([tabId, filename]) => {
            const ts = tabStates[tabId];
            if (!ts) return Promise.resolve(true);
            return saveFile(filename, ts.source);
          }),
        );

        const allOk = results.every(Boolean);
        setSaveStatus(allOk ? 'saved' : 'error');
        if (allOk) {
          setTabStates((prev) => {
            const next = { ...prev };
            for (const tabId of Object.keys(tabFiles)) {
              if (next[tabId]) {
                next[tabId] = { ...next[tabId], dirty: false };
              }
            }
            return next;
          });
          setTimeout(() => setSaveStatus('idle'), 2000);
        }
        return allOk;
      } catch {
        setSaveStatus('error');
        return false;
      }
    },
    [tabStates],
  );

  /** Save as a new custom story — prompts for a name, then navigates to it. */
  const handleSaveCustom = useCallback(async () => {
    if (!contractId || !role) return;

    const raw = window.prompt('Custom story name (e.g., "Citizen", "Permanent Resident With Sponsor"):');
    if (!raw) return;

    const customName = toKebabCase(raw);
    if (!customName) return;

    // Check for name collision before saving
    try {
      const checkRes = await fetch('/__check-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: `${contractId}.${customName}` }),
      });
      if (checkRes.status === 409) {
        const msg = await checkRes.text();
        window.alert(msg || `A custom story named "${toDisplayName(customName)}" already exists. Choose a different name.`);
        return;
      }
    } catch {
      // If the check fails, proceed with the save (server will handle conflicts)
    }

    const ok = await saveAllTabs(`custom/${contractId}.${customName}`);
    if (ok) {
      // Brief delay so Vite's watcher can detect and compile the new story
      // file before the full page reload requests the story index.
      document.body.style.display = 'none';
      const storyId = customStoryId(role, category, customName);
      setTimeout(() => {
        (window.top ?? window).location.href = `/?path=/story/${storyId}`;
      }, 1500);
    }
  }, [contractId, role, category, saveAllTabs]);

  /** Update an existing custom story — derives the directory from the tab filenames. */
  const handleUpdateCustom = useCallback(async () => {
    const customTab = tabs.find((t) => t.filename.includes('custom/'));
    if (!customTab) return;
    const dir = customTab.filename.replace(/\/[^/]+$/, '');
    if (!dir.includes('custom/')) return;

    await saveAllTabs(dir);
  }, [tabs, saveAllTabs]);

  /** Extract the custom dir name (e.g. "application-intake.citizen") from tab filenames. */
  const getCustomDirName = useCallback(() => {
    const customTab = tabs.find((t) => t.filename.includes('custom/'));
    if (!customTab) return null;
    const match = customTab.filename.match(/custom\/([^/]+)\//);
    return match ? match[1] : null;
  }, [tabs]);

  /** Rename the current custom story. */
  const handleRenameCustom = useCallback(async () => {
    const from = getCustomDirName();
    if (!from || !contractId || !role) return;

    const currentKebab = from.slice(contractId.length + 1); // strip "contractId."
    const raw = window.prompt('Rename custom story:', currentKebab.replace(/-/g, ' '));
    if (!raw) return;

    const newKebab = toKebabCase(raw);
    if (!newKebab || newKebab === currentKebab) return;

    // Pre-flight collision check (no file changes, fast)
    try {
      const checkRes = await fetch('/__check-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: `${contractId}.${newKebab}` }),
      });
      if (checkRes.status === 409) {
        const msg = await checkRes.text();
        window.alert(msg || `A custom story named "${toDisplayName(newKebab)}" already exists.`);
        return;
      }
    } catch {
      // If the check fails, proceed with the rename (server will handle conflicts)
    }

    // Navigate first, then fire rename in background to avoid HMR error flash
    // (same pattern as the delete handler)
    document.body.style.display = 'none';
    const storyId = customStoryId(role, category, newKebab);
    (window.top ?? window).location.href = `/?path=/story/${storyId}`;
    fetch('/__rename-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: `${contractId}.${newKebab}` }),
      keepalive: true,
    });
  }, [getCustomDirName, contractId, role, category]);

  /** Delete the current custom story. */
  const handleDeleteCustom = useCallback(async () => {
    const customDir = getCustomDirName();
    if (!customDir || !role) return;

    const kebabName = customDir.split('.').slice(1).join('.');
    const displayName = toDisplayName(kebabName);
    if (!window.confirm(`Delete custom story "${displayName}"? This cannot be undone.`)) return;

    // Navigate away first, then fire delete in background to avoid HMR error flash
    document.body.style.display = 'none';
    (window.top ?? window).location.href = '/';
    fetch('/__delete-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: customDir }),
      keepalive: true,
    });
  }, [getCustomDirName, role]);

  // Detect if we're viewing a custom story (any tab points to a custom dir)
  const isViewingCustom = tabs.some((t) => t.filename.includes('custom/'));

  // Any editable tab has valid YAML → can save custom story
  const allEditableValid = ['test-data', 'layout', 'permissions'].every((tabId) => {
    const ts = tabStates[tabId];
    return !ts || ts.parseStatus.valid;
  });
  const anyDirty = ['test-data', 'layout', 'permissions'].some((tabId) => {
    const ts = tabStates[tabId];
    return ts?.dirty;
  });
  const showSaveButton = !!contractId && allEditableValid;
  const canSave = showSaveButton && saveStatus !== 'saving';
  const canUpdate = isViewingCustom && anyDirty && allEditableValid && saveStatus !== 'saving';

  if (!state && !isReferenceActive) return <>{children}</>;

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Custom story toolbar — always visible at the top */}
      {showSaveButton && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '6px 12px',
            borderBottom: '1px solid #e0e0e0',
            background: '#fafafa',
            flexShrink: 0,
          }}
        >
          {isViewingCustom ? (
            <>
              <button
                onClick={handleUpdateCustom}
                disabled={!canUpdate}
                style={updateButtonStyle(canUpdate)}
              >
                {saveStatus === 'saving'
                  ? 'Saving...'
                  : saveStatus === 'saved'
                    ? 'Updated!'
                    : 'Update'}
              </button>
              <button
                onClick={handleSaveCustom}
                disabled={!canSave}
                style={customButtonStyle(canSave)}
              >
                Save as New Custom
              </button>
              <button
                onClick={handleRenameCustom}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#89b4fa',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Rename
              </button>
              <button
                onClick={handleDeleteCustom}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#f38ba8',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={handleSaveCustom}
              disabled={!canSave}
              style={customButtonStyle(canSave)}
            >
              {saveStatus === 'saving'
                ? 'Saving...'
                : saveStatus === 'saved'
                  ? 'Custom Saved!'
                  : 'Save as Custom'}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>
      {showSource && (
        <div
          style={{
            flex: isNarrowViewport ? '1 1 100%' : '0 0 45%',
            display: 'flex',
            flexDirection: 'column',
            background: '#1e1e2e',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #444',
              padding: '0 0.5rem',
            }}
          >
            {topLevelTabs.map((tab) => {
              const ts = tabStates[tab.id];
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  style={tabButtonStyle(tab.id === activeTabId)}
                >
                  {tab.label}
                  {ts?.dirty && (
                    <span style={{ color: '#f9e2af', marginLeft: '4px' }}>
                      *
                    </span>
                  )}
                </button>
              );
            })}
            {referenceTabs.length > 0 && (
              <button
                onClick={() => setActiveTabId('reference')}
                style={tabButtonStyle(isReferenceActive)}
              >
                Reference
              </button>
            )}
          </div>

          {/* Filename */}
          <div
            style={{
              padding: '0.4rem 1rem 0',
              color: '#6c7086',
              fontFamily: 'monospace',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <span>
              {activeTab.filename}
              {activeTab.readOnly && (
                <span style={{ marginLeft: '8px', color: '#585b70' }}>
                  (read-only)
                </span>
              )}
            </span>
          </div>

          {/* Reference sub-selector */}
          {isReferenceActive && (
            <div
              style={{
                display: 'flex',
                gap: '0.25rem',
                padding: '0.4rem 1rem 0',
              }}
            >
              {referenceTabs.map((rt) => (
                <button
                  key={rt.id}
                  onClick={() => setActiveReferenceId(rt.id)}
                  style={{
                    background: rt.id === activeReferenceId ? '#45475a' : 'transparent',
                    border: '1px solid #585b70',
                    color: rt.id === activeReferenceId ? '#cdd6f4' : '#888',
                    borderRadius: '3px',
                    padding: '1px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                >
                  {rt.label}
                </button>
              ))}
            </div>
          )}

          {/* Parse error banner */}
          {state && !state.parseStatus.valid && (
            <div
              style={{
                background: '#45243a',
                color: '#f38ba8',
                padding: '0.4rem 0.6rem',
                margin: '0.5rem 1rem 0',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
              }}
            >
              {state.parseStatus.error}
            </div>
          )}

          {/* Editor */}
          <textarea
            value={state?.source ?? activeTab.source}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={activeTab.readOnly}
            spellCheck={false}
            style={{
              flex: 1,
              margin: 0,
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: activeTab.readOnly ? '#a6adc8' : '#cdd6f4',
              fontFamily: 'monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              border: 'none',
              outline: 'none',
              resize: 'none',
              tabSize: 2,
              whiteSpace: 'pre',
              overflowX: 'auto',
              cursor: activeTab.readOnly ? 'default' : 'text',
            }}
          />
        </div>
      )}

      {/* In narrow viewport with editor open, hide form content to give editor full width */}
      {!(isNarrowViewport && showSource) && (
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {children}
        </div>
      )}
      </div>
    </div>
  );
}
