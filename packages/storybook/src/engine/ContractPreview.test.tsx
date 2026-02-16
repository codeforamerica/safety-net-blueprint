// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ContractPreview, type EditorTab } from './ContractPreview';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Mock useViewportAutoHide — lets us control isNarrow directly
// ---------------------------------------------------------------------------

let mockIsNarrow = false;
let mockStoredShowSource = true;

vi.mock('./useViewportAutoHide', () => ({
  useViewportAutoHide: () => mockIsNarrow,
  getStoredShowSource: () => mockStoredShowSource,
  setStoredShowSource: (show: boolean) => { mockStoredShowSource = show; },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const minimalTabs: EditorTab[] = [
  { id: 'layout', label: 'Layout', filename: 'layout.yaml', source: 'form:\n  id: test\n  title: Test\n  schema: test/Test\n  pages: []' },
  { id: 'test-data', label: 'Test Data', filename: 'test-data.yaml', source: 'name: test' },
  { id: 'permissions', label: 'Permissions', filename: 'permissions.yaml', source: 'role: applicant\ndefaults: editable' },
];

function renderPreview(isNarrow = false) {
  mockIsNarrow = isNarrow;
  return render(
    <ContractPreview
      tabs={minimalTabs}
      onLayoutChange={vi.fn()}
      onPermissionsChange={vi.fn()}
      onTestDataChange={vi.fn()}
    >
      <div data-testid="form-content">Form Content</div>
    </ContractPreview>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContractPreview narrow viewport layout', () => {
  beforeEach(() => {
    mockIsNarrow = false;
    mockStoredShowSource = true;
  });

  // ── Wide viewport ──────────────────────────────────────────────────────

  it('shows editor at 45% and form content side-by-side in wide viewport', () => {
    renderPreview(false);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();

    // Editor panel flex
    const editorPanel = textarea.closest('div[style*="flex"]') as HTMLElement;
    expect(editorPanel?.style.flex).toBe('0 0 45%');
  });

  it('shows "Hide Editor" toggle in wide viewport', () => {
    renderPreview(false);
    expect(screen.getByRole('button', { name: /^Hide Editor$/ })).toBeInTheDocument();
  });

  it('clicking "Hide Editor" hides editor and shows "Show Editor"', () => {
    renderPreview(false);

    fireEvent.click(screen.getByRole('button', { name: /^Hide Editor$/ }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show Editor$/ })).toBeInTheDocument();
  });

  // ── Narrow viewport (editor auto-hidden) ───────────────────────────────

  it('auto-hides editor in narrow viewport', () => {
    // In the real flow, auto-hide has already set storedShowSource to false
    mockStoredShowSource = false;
    renderPreview(true);

    // Editor hidden, form content visible
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show Editor$/ })).toBeInTheDocument();
  });

  // ── Narrow viewport (editor manually shown) ───────────────────────────

  it('shows editor at 100% when opened in narrow viewport', () => {
    mockStoredShowSource = false;
    renderPreview(true);

    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));

    const textarea = screen.getByRole('textbox');
    const editorPanel = textarea.closest('div[style*="flex"]') as HTMLElement;
    expect(editorPanel?.style.flex).toBe('1 1 100%');
  });

  it('hides form content when editor is open in narrow viewport', () => {
    mockStoredShowSource = false;
    renderPreview(true);

    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));

    expect(screen.queryByTestId('form-content')).not.toBeInTheDocument();
  });

  it('shows "Hide" button when editor is open in narrow viewport', () => {
    mockStoredShowSource = false;
    renderPreview(true);

    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));

    expect(screen.getByRole('button', { name: /^Hide$/ })).toBeInTheDocument();
  });

  it('clicking "Hide" restores form content in narrow viewport', () => {
    mockStoredShowSource = false;
    renderPreview(true);

    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));
    expect(screen.queryByTestId('form-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Hide$/ }));

    expect(screen.getByTestId('form-content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show Editor$/ })).toBeInTheDocument();
  });

  // ── Editor visibility persistence across story navigation ─────────────

  it('persists editor hidden state across remounts in wide viewport', () => {
    const { unmount } = renderPreview(false);

    // Hide the editor
    fireEvent.click(screen.getByRole('button', { name: /^Hide Editor$/ }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    unmount();

    // Remount — editor should still be hidden
    renderPreview(false);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show Editor$/ })).toBeInTheDocument();
  });

  it('persists editor shown state across remounts in wide viewport', () => {
    // Start hidden
    mockStoredShowSource = false;
    const { unmount } = renderPreview(false);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Show the editor
    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    unmount();

    // Remount — editor should still be shown
    renderPreview(false);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('persists editor open state across remounts in narrow viewport', () => {
    mockStoredShowSource = false;
    const { unmount } = renderPreview(true);

    // Open the editor
    fireEvent.click(screen.getByRole('button', { name: /^Show Editor$/ }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    unmount();

    // Remount — editor should still be open at 100%
    renderPreview(true);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    const editorPanel = textarea.closest('div[style*="flex"]') as HTMLElement;
    expect(editorPanel?.style.flex).toBe('1 1 100%');
  });
});
