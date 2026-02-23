import { NavLink, Outlet, useParams, Navigate } from 'react-router-dom';
import { SideNav, Alert, Button } from '@trussworks/react-uswds';
import { useState, useEffect, useCallback } from 'react';
import type { Role } from '@safety-net/form-engine-react';
import { useManifest } from '../hooks/useManifest';
import { useRole } from '../context/RoleContext';

const ROLES: Role[] = ['admin', 'applicant', 'caseworker', 'reviewer'];

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:1080';

export interface FormDef {
  id: string;
  name: string;
  description?: string;
  status: string;
  definition: Record<string, unknown>;
}

export function ExplorerLayout() {
  const { apis, loading, error } = useManifest();
  const { role, setRole } = useRole();
  const [formDefs, setFormDefs] = useState<FormDef[]>([]);
  const { apiName } = useParams();

  const fetchFormDefs = useCallback(() => {
    fetch(`${BASE_URL}/forms?limit=100`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setFormDefs(data.items ?? []))
      .catch(() => setFormDefs([]));
  }, []);

  useEffect(() => {
    fetchFormDefs();
  }, [fetchFormDefs]);

  if (loading) {
    return <p className="usa-prose">Loading API manifest...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading="Failed to load API manifest">
        {error}
      </Alert>
    );
  }

  if (apis.length === 0) {
    return (
      <div className="usa-prose">
        <p>No APIs discovered.</p>
      </div>
    );
  }

  // Default to first API if none selected
  if (!apiName) {
    return <Navigate to={`/explore/${apis[0].name}`} replace />;
  }

  const navItems = apis.map((api) => (
    <NavLink
      key={api.name}
      to={`/explore/${api.name}`}
      className={({ isActive }) =>
        `usa-sidenav__item${isActive ? ' usa-current' : ''}`
      }
      end={false}
    >
      {api.title}
    </NavLink>
  ));

  return (
    <div className="grid-row grid-gap">
      <div className="grid-col-3">
        <div className="margin-bottom-2">
          <label
            htmlFor="explorer-role-select"
            style={{ fontSize: '0.75rem', fontWeight: 600, color: '#5b616b', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '0.25rem' }}
          >
            Role
          </label>
          <select
            id="explorer-role-select"
            className="usa-select"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            style={{ fontSize: '0.8125rem', width: '100%' }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <SideNav items={navItems} />
      </div>
      <div className="grid-col-9">
        <Outlet context={{ apis, formDefs }} />
      </div>
    </div>
  );
}
