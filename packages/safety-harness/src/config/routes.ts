import manifest from '../../routes.yaml';

export interface RouteApiConfig {
  domain: string;
  list?: string;
  get?: string;
  create?: string;
  update?: string;
}

export interface RouteDefinition {
  path: string;
  contract: string;
  api: RouteApiConfig;
  type: 'detail' | 'list';
}

const raw = manifest as { routes: RouteDefinition[] };

export const routes: RouteDefinition[] = raw.routes;
