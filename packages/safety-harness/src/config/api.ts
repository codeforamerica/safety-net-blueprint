import { client as applicationsClient } from '../generated/api/applications/client.gen';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:1080';

applicationsClient.setConfig({ baseURL });
