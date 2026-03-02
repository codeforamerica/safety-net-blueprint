import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { Header, Title, NavMenuButton, PrimaryNav } from '@trussworks/react-uswds';
import { useState } from 'react';
import { RoleProvider } from './context/RoleContext';
import { ExplorerLayout } from './pages/ExplorerLayout';
import { ApiListPage } from './pages/ApiListPage';
import { ApiDetailPage } from './pages/ApiDetailPage';
import { ApiCreatePage } from './pages/ApiCreatePage';

export function App() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = [
    <Link key="explore" to="/explore" className="usa-nav__link">
      Explore APIs
    </Link>,
  ];

  return (
    <RoleProvider>
      <Header basic>
        <div className="usa-nav-container">
          <div className="usa-navbar">
            <Title>Safety Harness</Title>
            <NavMenuButton
              label="Menu"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
            />
          </div>
          <PrimaryNav
            items={navItems}
            mobileExpanded={mobileNavOpen}
            onToggleMobileNav={() => setMobileNavOpen(!mobileNavOpen)}
          />
        </div>
      </Header>
      <main className="grid-container padding-y-4">
        <Routes>
          <Route path="/explore" element={<ExplorerLayout />}>
            <Route path=":apiName" element={<ApiListPage />} />
            <Route path=":apiName/new" element={<ApiCreatePage />} />
            <Route path=":apiName/:id" element={<ApiDetailPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/explore" replace />} />
        </Routes>
      </main>
    </RoleProvider>
  );
}
