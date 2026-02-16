import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import yaml from 'js-yaml';
import type { FormContract, PermissionsPolicy } from './types';
import {
  toKebabCase,
  scenarioDisplayName as toDisplayName,
  scenarioStoryId,
} from './naming';
import { REFERENCE_CONTENT } from './contract-reference';
import {
  useViewportAutoHide,
  getStoredShowSource,
  setStoredShowSource,
} from './useViewportAutoHide';

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
  formTitle?: string;
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

const scenarioButtonStyle = (enabled: boolean) => ({
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
  formTitle,
  onLayoutChange,
  onPermissionsChange,
  onTestDataChange,
  children,
}: ContractPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSource, setShowSourceRaw] = useState(getStoredShowSource);
  const setShowSource = useCallback((show: boolean) => {
    setStoredShowSource(show);
    setShowSourceRaw(show);
  }, []);
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? '');
  const [activeReferenceId, setActiveReferenceId] = useState('');
  const [scenarioSaveStatus, setScenarioSaveStatus] = useState<SaveStatus>('idle');

  // Auto-hide editor when Storybook switches to a narrow viewport (mobile/tablet),
  // and auto-show when reset. Only fires on transitions, so manual toggle still works.
  const isNarrowViewport = useViewportAutoHide(containerRef, setShowSource);

  // Collect reference-group tabs and build a synthetic "Reference" top-level tab.
  // The Syntax reference is always appended as the last reference sub-tab.
  const referenceTabs = useMemo<EditorTab[]>(() => {
    const grouped = tabs.filter((t) => t.group === 'reference');
    return [
      ...grouped,
      { id: 'syntax', label: 'Syntax', filename: 'Form Contract Syntax', source: REFERENCE_CONTENT, readOnly: true, group: 'reference' },
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
   * Save all editable tabs to a scenario directory.
   * scenarioDir is e.g. "scenarios/person-intake.citizen"
   */
  const saveAllTabs = useCallback(
    async (scenarioDir: string): Promise<boolean> => {
      const tabFiles: Record<string, string> = {
        'test-data': `${scenarioDir}/test-data.yaml`,
        layout: `${scenarioDir}/layout.yaml`,
        permissions: `${scenarioDir}/permissions.yaml`,
      };

      setScenarioSaveStatus('saving');
      try {
        const results = await Promise.all(
          Object.entries(tabFiles).map(([tabId, filename]) => {
            const ts = tabStates[tabId];
            if (!ts) return Promise.resolve(true);
            return saveFile(filename, ts.source);
          }),
        );

        const allOk = results.every(Boolean);
        setScenarioSaveStatus(allOk ? 'saved' : 'error');
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
          setTimeout(() => setScenarioSaveStatus('idle'), 2000);
        }
        return allOk;
      } catch {
        setScenarioSaveStatus('error');
        return false;
      }
    },
    [tabStates],
  );

  /** Save as a new scenario — prompts for a name, then navigates to it. */
  const handleSaveScenario = useCallback(async () => {
    if (!contractId || !formTitle) return;

    const raw = window.prompt('Scenario name (e.g., "Citizen", "Permanent Resident With Sponsor"):');
    if (!raw) return;

    const scenarioName = toKebabCase(raw);
    if (!scenarioName) return;

    const ok = await saveAllTabs(`scenarios/${contractId}.${scenarioName}`);
    if (ok) {
      document.body.style.display = 'none';
      const storyId = scenarioStoryId(formTitle, scenarioName);
      (window.top ?? window).location.href = `/?path=/story/${storyId}`;
    }
  }, [contractId, formTitle, saveAllTabs]);

  /** Update an existing scenario — derives the directory from the tab filenames. */
  const handleUpdateScenario = useCallback(async () => {
    const tdTab = tabs.find((t) => t.id === 'test-data');
    if (!tdTab) return;
    // filename is e.g. "scenarios/person-intake.citizen/test-data.yaml"
    const dir = tdTab.filename.replace(/\/[^/]+$/, '');
    if (!dir.startsWith('scenarios/')) return;

    await saveAllTabs(dir);
  }, [tabs, saveAllTabs]);

  /** Extract the scenario dir name (e.g. "person-intake.citizen") from tab filenames. */
  const getScenarioDirName = useCallback(() => {
    const tdTab = tabs.find((t) => t.id === 'test-data');
    if (!tdTab) return null;
    // "scenarios/person-intake.citizen/test-data.yaml" → "person-intake.citizen"
    const match = tdTab.filename.match(/^scenarios\/([^/]+)\//);
    return match ? match[1] : null;
  }, [tabs]);

  /** Rename the current scenario. */
  const handleRenameScenario = useCallback(async () => {
    const from = getScenarioDirName();
    if (!from || !contractId || !formTitle) return;

    const currentKebab = from.slice(contractId.length + 1); // strip "contractId."
    const raw = window.prompt('Rename scenario:', currentKebab.replace(/-/g, ' '));
    if (!raw) return;

    const newKebab = toKebabCase(raw);
    if (!newKebab || newKebab === currentKebab) return;

    setScenarioSaveStatus('saving');
    try {
      const res = await fetch('/__rename-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: `${contractId}.${newKebab}` }),
      });
      if (res.ok) {
        // Hide iframe content to prevent error flash, then navigate
        document.body.style.display = 'none';
        const storyId = scenarioStoryId(formTitle, newKebab);
        (window.top ?? window).location.href = `/?path=/story/${storyId}`;
      } else {
        setScenarioSaveStatus('error');
      }
    } catch {
      setScenarioSaveStatus('error');
    }
  }, [getScenarioDirName, contractId, formTitle]);

  /** Delete the current scenario. */
  const handleDeleteScenario = useCallback(async () => {
    const scenario = getScenarioDirName();
    if (!scenario || !formTitle) return;

    const kebabName = scenario.split('.').slice(1).join('.');
    const displayName = toDisplayName(kebabName);
    if (!window.confirm(`Delete scenario "${displayName}"? This cannot be undone.`)) return;

    // Navigate away first, then fire delete in background to avoid HMR error flash
    document.body.style.display = 'none';
    (window.top ?? window).location.href = '/';
    fetch('/__delete-scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
    });
  }, [getScenarioDirName, formTitle]);

  // Detect if we're viewing a scenario (test-data tab points to a scenario dir)
  const testDataTab = tabs.find((t) => t.id === 'test-data');
  const isViewingScenario = !!testDataTab && testDataTab.filename.startsWith('scenarios/');

  // Any editable tab has valid YAML → can save scenario
  const allEditableValid = ['test-data', 'layout', 'permissions'].every((tabId) => {
    const ts = tabStates[tabId];
    return !ts || ts.parseStatus.valid;
  });
  const anyDirty = ['test-data', 'layout', 'permissions'].some((tabId) => {
    const ts = tabStates[tabId];
    return ts?.dirty;
  });
  const showSaveScenarioButton = !!contractId && allEditableValid;
  const canSaveScenario = showSaveScenarioButton && scenarioSaveStatus !== 'saving';
  const canUpdateScenario = isViewingScenario && anyDirty && allEditableValid && scenarioSaveStatus !== 'saving';

  if (!state && !isReferenceActive) return <>{children}</>;

  return (
    <div ref={containerRef} style={{ display: 'flex', gap: '1.5rem', height: '85vh' }}>
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

            {/* Right-side actions */}
            <div
              style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '4px 0' }}
            >
              {isViewingScenario && (
                <button
                  onClick={handleUpdateScenario}
                  disabled={!canUpdateScenario}
                  style={updateButtonStyle(canUpdateScenario)}
                >
                  {scenarioSaveStatus === 'saving'
                    ? 'Saving...'
                    : scenarioSaveStatus === 'saved'
                      ? 'Scenario Updated!'
                      : 'Update Scenario'}
                </button>
              )}
              {showSaveScenarioButton && (
                <button
                  onClick={handleSaveScenario}
                  disabled={!canSaveScenario}
                  style={scenarioButtonStyle(canSaveScenario)}
                >
                  {scenarioSaveStatus === 'saving'
                    ? 'Saving...'
                    : scenarioSaveStatus === 'saved'
                      ? 'Scenario Saved!'
                      : isViewingScenario
                        ? 'Save as New Scenario'
                        : 'Save as Scenario'}
                </button>
              )}
            </div>
          </div>

          {/* Filename + scenario actions */}
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
            <span>
              {activeTab.filename}
              {activeTab.readOnly && (
                <span style={{ marginLeft: '8px', color: '#585b70' }}>
                  (read-only)
                </span>
              )}
            </span>
            {isViewingScenario && (
              <span style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                <button
                  onClick={handleRenameScenario}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#89b4fa',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Rename
                </button>
                <button
                  onClick={handleDeleteScenario}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f38ba8',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Delete
                </button>
              </span>
            )}
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
          <button
            onClick={() => setShowSource(!showSource)}
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
            {showSource ? 'Hide Editor' : 'Show Editor'}
          </button>
          {children}
        </div>
      )}
    </div>
  );
}
