import React from 'react';
import { Button, ButtonGroup } from '@trussworks/react-uswds';
import type { ActionDefinition, ActionStyle, Role } from './types';

/** Map action style to USWDS Button variant props. */
function styleProps(style?: ActionStyle): Record<string, boolean> {
  switch (style) {
    case 'secondary': return { secondary: true };
    case 'success': return { base: true };
    case 'warning': return { secondary: true };
    case 'outline': return { outline: true };
    default: return {};
  }
}

/** Check whether an action is visible given the current role and form data. */
function isVisible(
  action: ActionDefinition,
  role: Role,
  data?: Record<string, unknown>,
): boolean {
  if (!action.show_when) return true;
  if (action.show_when.role && !action.show_when.role.includes(role)) return false;
  if (action.show_when.field && data) {
    for (const [key, expected] of Object.entries(action.show_when.field)) {
      if (data[key] !== expected) return false;
    }
  }
  return true;
}

export interface ActionBarProps {
  /** Action definitions from the form contract. */
  actions: ActionDefinition[];
  /** Current user role — used for visibility filtering. */
  role: Role;
  /** Current form data — used for field-based visibility conditions. */
  data?: Record<string, unknown>;
  /** Callback when an action button is clicked. Receives the action definition. */
  onAction: (action: ActionDefinition) => void;
  /** ID of the action that maps to the form's submit button (rendered by FormRenderer's own submit). */
  primaryActionId?: string;
}

/**
 * Renders action buttons declared in a form contract.
 *
 * Filters actions by role and field-based visibility conditions, then renders
 * them as a USWDS ButtonGroup. The primary action (typically Save/PATCH) can be
 * excluded via `primaryActionId` if the FormRenderer handles it via its own submit.
 */
export function ActionBar({ actions, role, data, onAction, primaryActionId }: ActionBarProps) {
  const visible = actions.filter(
    (a) => a.id !== primaryActionId && isVisible(a, role, data),
  );

  if (visible.length === 0) return null;

  const handleClick = (action: ActionDefinition) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    onAction(action);
  };

  return (
    <ButtonGroup className="margin-top-2">
      {visible.map((action) => (
        <Button
          key={action.id}
          type="button"
          {...styleProps(action.style)}
          onClick={() => handleClick(action)}
        >
          {action.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

export { isVisible as isActionVisible };
