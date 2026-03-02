// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EditorVisibilityProvider, useEditorVisibility } from './EditorVisibilityContext';

afterEach(cleanup);

function VisibilityDisplay() {
  const { visible, setVisible } = useEditorVisibility();
  return (
    <span data-testid="visibility">
      {visible ? 'visible' : 'hidden'}
      <button onClick={() => setVisible(!visible)}>toggle</button>
    </span>
  );
}

describe('EditorVisibilityContext', () => {
  it('defaults to visible when no provider wraps the component', () => {
    render(<VisibilityDisplay />);
    expect(screen.getByTestId('visibility')).toHaveTextContent('visible');
  });

  it('provides true when visible prop is true', () => {
    render(
      <EditorVisibilityProvider visible={true}>
        <VisibilityDisplay />
      </EditorVisibilityProvider>,
    );
    expect(screen.getByTestId('visibility')).toHaveTextContent('visible');
  });

  it('provides false when visible prop is false', () => {
    render(
      <EditorVisibilityProvider visible={false}>
        <VisibilityDisplay />
      </EditorVisibilityProvider>,
    );
    expect(screen.getByTestId('visibility')).toHaveTextContent('hidden');
  });

  it('updates when visible prop changes', () => {
    const { rerender } = render(
      <EditorVisibilityProvider visible={true}>
        <VisibilityDisplay />
      </EditorVisibilityProvider>,
    );
    expect(screen.getByTestId('visibility')).toHaveTextContent('visible');

    rerender(
      <EditorVisibilityProvider visible={false}>
        <VisibilityDisplay />
      </EditorVisibilityProvider>,
    );
    expect(screen.getByTestId('visibility')).toHaveTextContent('hidden');
  });

  it('calls setVisible callback when provided', () => {
    const mockSetVisible = vi.fn();
    render(
      <EditorVisibilityProvider visible={true} setVisible={mockSetVisible}>
        <VisibilityDisplay />
      </EditorVisibilityProvider>,
    );
    screen.getByRole('button', { name: 'toggle' }).click();
    expect(mockSetVisible).toHaveBeenCalledWith(false);
  });

  it('does not throw when setVisible is called without provider', () => {
    render(<VisibilityDisplay />);
    // Default setVisible is a no-op, should not throw
    expect(() => screen.getByRole('button', { name: 'toggle' }).click()).not.toThrow();
  });
});
