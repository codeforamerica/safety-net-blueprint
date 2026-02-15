import React, { useState } from 'react';

interface ContractPreviewProps {
  yamlSource: string;
  children: React.ReactNode;
  currentPageId?: string;
}

/**
 * Side-by-side view: YAML contract source on the left, rendered form on the right.
 * Highlights the current page's YAML section. Designers can read the contract
 * alongside the rendered output to understand what drives each field.
 */
export function ContractPreview({
  yamlSource,
  children,
  currentPageId,
}: ContractPreviewProps) {
  const [showSource, setShowSource] = useState(true);

  // Highlight the current page section in the YAML
  const highlightedSource = currentPageId
    ? highlightPageSection(yamlSource, currentPageId)
    : yamlSource;

  return (
    <div style={{ display: 'flex', gap: '1.5rem', minHeight: '80vh' }}>
      {showSource && (
        <div
          style={{
            flex: '0 0 45%',
            overflow: 'auto',
            background: '#1e1e2e',
            borderRadius: '8px',
            padding: '1rem',
            fontSize: '13px',
            lineHeight: '1.5',
            maxHeight: '85vh',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
              borderBottom: '1px solid #444',
              paddingBottom: '0.5rem',
            }}
          >
            <span
              style={{
                color: '#cdd6f4',
                fontWeight: 600,
                fontFamily: 'monospace',
              }}
            >
              person-intake.yaml
            </span>
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
          <pre
            style={{ margin: 0, color: '#cdd6f4', fontFamily: 'monospace' }}
            dangerouslySetInnerHTML={{ __html: highlightedSource }}
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

/**
 * Wraps the active page section in a highlighted span.
 * Finds the page by its `- id: <pageId>` marker and highlights
 * until the next page or end of pages.
 */
function highlightPageSection(yaml: string, pageId: string): string {
  const escaped = escapeHtml(yaml);
  const lines = escaped.split('\n');
  const result: string[] = [];
  let inHighlight = false;
  let pageIndent = -1;

  for (const line of lines) {
    const pageMatch = line.match(/^(\s*)- id: (.+)$/);

    if (pageMatch) {
      if (inHighlight) {
        result.push('</span>');
        inHighlight = false;
      }

      if (pageMatch[2] === pageId) {
        inHighlight = true;
        pageIndent = pageMatch[1].length;
        result.push(
          '<span style="background:#2a2a4a;display:block;border-left:3px solid #89b4fa;padding-left:4px;margin-left:-7px">',
        );
      }
    } else if (inHighlight) {
      // Check if we've left the page block (same or lesser indent that's not empty)
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        const currentIndent = line.length - line.trimStart().length;
        if (currentIndent <= pageIndent && !line.trim().startsWith('-')) {
          result.push('</span>');
          inHighlight = false;
        }
      }
    }

    result.push(line);
  }

  if (inHighlight) {
    result.push('</span>');
  }

  return result.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
