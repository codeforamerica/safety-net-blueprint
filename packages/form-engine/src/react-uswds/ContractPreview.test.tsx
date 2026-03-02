// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ContractPreview, type EditorTab } from './ContractPreview';
import { EditorVisibilityProvider } from './EditorVisibilityContext';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Mock useViewportAutoHide — lets us control isNarrow directly
// ---------------------------------------------------------------------------

let mockIsNarrow = false;
/** Capture the setShowSource callback that ContractPreview passes to useViewportAutoHide */
let capturedSetShowSource: ((show: boolean) => void) | null = null;

vi.mock('./useViewportAutoHide', () => ({
  useViewportAutoHide: (_ref: unknown, setShowSource: (show: boolean) => void) => {
    capturedSetShowSource = setShowSource;
    return mockIsNarrow;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const minimalTabs: EditorTab[] = [
  { id: 'layout', label: 'Layout', filename: 'layout.yaml', source: 'form:\n  id: test\n  title: Test\n  schema: Application\n  pages: []' },
  { id: 'test-data', label: 'Test Data', filename: 'test-data.yaml', source: 'name: test' },
  { id: 'permissions', label: 'Permissions', filename: 'permissions.yaml', source: 'role: applicant\ndefaults: editable' },
];

const customTabs: EditorTab[] = [
  { id: 'layout', label: 'Layout', filename: 'storybook/custom/test-app.citizen/layout.yaml', source: 'form:\n  id: test\n  title: Test\n  schema: Application\n  pages: []' },
  { id: 'test-data', label: 'Test Data', filename: 'storybook/custom/test-app.citizen/test-data.yaml', source: 'name: test' },
  { id: 'permissions', label: 'Permissions', filename: 'storybook/custom/test-app.citizen/permissions.yaml', source: 'role: applicant\ndefaults: editable' },
];

function renderPreview({
  isNarrow = false,
  editorVisible = true,
  setVisible = vi.fn(),
  tabs = minimalTabs,
  contractId,
  role,
}: {
  isNarrow?: boolean;
  editorVisible?: boolean;
  setVisible?: (show: boolean) => void;
  tabs?: EditorTab[];
  contractId?: string;
  role?: string;
} = {}) {
  mockIsNarrow = isNarrow;
  capturedSetShowSource = null;
  return render(
    <EditorVisibilityProvider visible={editorVisible} setVisible={setVisible}>
      <ContractPreview
        tabs={tabs}
        contractId={contractId}
        role={role}
        onLayoutChange={vi.fn()}
        onPermissionsChange={vi.fn()}
        onTestDataChange={vi.fn()}
      >
        <div data-testid="form-content">Form Content</div>
      </ContractPreview>
    </EditorVisibilityProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContractPreview editor visibility via context', () => {
  beforeEach(() => {
    mockIsNarrow = false;
    capturedSetShowSource = null;
  });

  // ── Toolbar toggle (context-driven) ────────────────────────────────────

  it('shows editor when editorVisible is true', () => {
    renderPreview({ editorVisible: true });

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });

  it('hides editor when editorVisible is false', () => {
    renderPreview({ editorVisible: false });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });

  it('toggles editor when context value changes', () => {
    const setVisible = vi.fn();
    const { rerender } = render(
      <EditorVisibilityProvider visible={true} setVisible={setVisible}>
        <ContractPreview
          tabs={minimalTabs}
          onLayoutChange={vi.fn()}
          onPermissionsChange={vi.fn()}
          onTestDataChange={vi.fn()}
        >
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();

    rerender(
      <EditorVisibilityProvider visible={false} setVisible={setVisible}>
        <ContractPreview
          tabs={minimalTabs}
          onLayoutChange={vi.fn()}
          onPermissionsChange={vi.fn()}
          onTestDataChange={vi.fn()}
        >
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });

  it('re-shows editor when context toggles back to visible', () => {
    const setVisible = vi.fn();
    const props = {
      tabs: minimalTabs,
      onLayoutChange: vi.fn(),
      onPermissionsChange: vi.fn(),
      onTestDataChange: vi.fn(),
    };

    const { rerender } = render(
      <EditorVisibilityProvider visible={true} setVisible={setVisible}>
        <ContractPreview {...props}>
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );

    // Hide
    rerender(
      <EditorVisibilityProvider visible={false} setVisible={setVisible}>
        <ContractPreview {...props}>
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Show again
    rerender(
      <EditorVisibilityProvider visible={true} setVisible={setVisible}>
        <ContractPreview {...props}>
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // ── Wide viewport layout ──────────────────────────────────────────────

  it('shows editor at 45% and form content side-by-side in wide viewport', () => {
    renderPreview({ isNarrow: false, editorVisible: true });

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();

    const editorPanel = textarea.closest('div[style*="flex"]') as HTMLElement;
    expect(editorPanel?.style.flex).toBe('0 0 45%');
  });

  it('does not show inline toggle buttons (toolbar controls visibility)', () => {
    renderPreview({ editorVisible: true });

    expect(screen.queryByRole('button', { name: /^Hide Editor$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show Editor$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hide$/ })).not.toBeInTheDocument();
  });

  // ── Narrow viewport ───────────────────────────────────────────────────

  it('shows editor at 100% in narrow viewport', () => {
    renderPreview({ isNarrow: true, editorVisible: true });

    const textarea = screen.getByRole('textbox');
    const editorPanel = textarea.closest('div[style*="flex"]') as HTMLElement;
    expect(editorPanel?.style.flex).toBe('1 1 100%');
  });

  it('hides form content when editor is visible in narrow viewport', () => {
    renderPreview({ isNarrow: true, editorVisible: true });

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByTestId('form-content')).not.toBeInTheDocument();
  });

  it('shows form content when editor is hidden in narrow viewport', () => {
    renderPreview({ isNarrow: true, editorVisible: false });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });

  // ── Viewport auto-hide syncs with context ─────────────────────────────

  it('passes context setVisible to useViewportAutoHide so toolbar stays in sync', () => {
    const setVisible = vi.fn();
    renderPreview({ isNarrow: false, editorVisible: true, setVisible });

    // The component should have passed setVisible (from context) to useViewportAutoHide
    expect(capturedSetShowSource).toBe(setVisible);
  });

  it('viewport auto-hide calls setVisible(false) which hides editor via context', () => {
    const setVisible = vi.fn();
    const { rerender } = render(
      <EditorVisibilityProvider visible={true} setVisible={setVisible}>
        <ContractPreview
          tabs={minimalTabs}
          onLayoutChange={vi.fn()}
          onPermissionsChange={vi.fn()}
          onTestDataChange={vi.fn()}
        >
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();

    // Simulate viewport auto-hide calling setVisible(false)
    // In real usage this updates the toolbar global, which re-renders with visible=false
    expect(capturedSetShowSource).not.toBeNull();
    capturedSetShowSource!(false);
    expect(setVisible).toHaveBeenCalledWith(false);

    // Simulate the toolbar having updated: re-render with visible=false
    rerender(
      <EditorVisibilityProvider visible={false} setVisible={setVisible}>
        <ContractPreview
          tabs={minimalTabs}
          onLayoutChange={vi.fn()}
          onPermissionsChange={vi.fn()}
          onTestDataChange={vi.fn()}
        >
          <div data-testid="form-content">Form Content</div>
        </ContractPreview>
      </EditorVisibilityProvider>,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Custom story toolbar visibility
// ---------------------------------------------------------------------------

describe('Custom story toolbar visibility', () => {
  beforeEach(() => {
    mockIsNarrow = false;
    capturedSetShowSource = null;
  });

  it('shows Save as Custom button when contractId and role are set', () => {
    renderPreview({ editorVisible: true, contractId: 'test-app', role: 'applicant' });

    expect(screen.getByRole('button', { name: /Save as Custom/ })).toBeInTheDocument();
  });

  it('shows Save as Custom button even when editor is hidden', () => {
    renderPreview({ editorVisible: false, contractId: 'test-app', role: 'applicant' });

    expect(screen.getByRole('button', { name: /Save as Custom/ })).toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
  });

  it('shows custom toolbar in narrow viewport with editor open', () => {
    renderPreview({ isNarrow: true, editorVisible: true, contractId: 'test-app', role: 'applicant' });

    expect(screen.getByRole('button', { name: /Save as Custom/ })).toBeInTheDocument();
  });

  it('does not show custom button when contractId is not set', () => {
    renderPreview({ editorVisible: true });

    expect(screen.queryByRole('button', { name: /Save as Custom/ })).not.toBeInTheDocument();
  });

  it('shows custom management buttons when viewing a custom story', () => {
    renderPreview({
      editorVisible: true,
      contractId: 'test-app',
      role: 'applicant',
      tabs: customTabs,
    });

    expect(screen.getByRole('button', { name: /Update/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save as New Custom/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rename/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('shows custom management buttons even when editor is hidden', () => {
    renderPreview({
      editorVisible: false,
      contractId: 'test-app',
      role: 'applicant',
      tabs: customTabs,
    });

    expect(screen.getByRole('button', { name: /Update/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save as New Custom/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Custom story detection (custom/ path matching)
// ---------------------------------------------------------------------------

describe('Custom story detection via custom/ path', () => {
  beforeEach(() => {
    mockIsNarrow = false;
    capturedSetShowSource = null;
  });

  it('detects custom story from storybook/custom/ tab filenames', () => {
    renderPreview({
      editorVisible: true,
      contractId: 'test-app',
      role: 'applicant',
      tabs: customTabs,
    });

    // Custom story mode: shows Update + Save as New Custom (not Save as Custom)
    expect(screen.getByRole('button', { name: /Update/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save as New Custom/ })).toBeInTheDocument();
  });

  it('does NOT detect custom story from base story tabs (no custom/ path)', () => {
    renderPreview({
      editorVisible: true,
      contractId: 'test-app',
      role: 'applicant',
      tabs: minimalTabs,
    });

    // Base story mode: shows Save as Custom (not Update/New)
    expect(screen.getByRole('button', { name: /Save as Custom/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update/ })).not.toBeInTheDocument();
  });

  it('does NOT detect custom story from old snapshots/ path in filenames', () => {
    const legacyTabs: EditorTab[] = [
      { id: 'layout', label: 'Layout', filename: 'storybook/snapshots/test-app.citizen/layout.yaml', source: 'form:\n  id: test\n  title: Test\n  schema: Application\n  pages: []' },
      { id: 'test-data', label: 'Test Data', filename: 'storybook/snapshots/test-app.citizen/test-data.yaml', source: 'name: test' },
      { id: 'permissions', label: 'Permissions', filename: 'storybook/snapshots/test-app.citizen/permissions.yaml', source: 'role: applicant\ndefaults: editable' },
    ];

    renderPreview({
      editorVisible: true,
      contractId: 'test-app',
      role: 'applicant',
      tabs: legacyTabs,
    });

    // Old snapshots/ path should NOT trigger custom story mode
    expect(screen.getByRole('button', { name: /Save as Custom/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Default context (no provider)
// ---------------------------------------------------------------------------

describe('EditorVisibilityProvider default context', () => {
  beforeEach(() => {
    mockIsNarrow = false;
    capturedSetShowSource = null;
  });

  it('defaults to visible when no provider is present', () => {
    render(
      <ContractPreview
        tabs={minimalTabs}
        onLayoutChange={vi.fn()}
        onPermissionsChange={vi.fn()}
        onTestDataChange={vi.fn()}
      >
        <div data-testid="form-content">Form Content</div>
      </ContractPreview>,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
