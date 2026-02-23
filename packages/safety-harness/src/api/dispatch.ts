import {
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
} from '../generated/api/applications/sdk.gen';
import type {
  Application,
  ApplicationList,
} from '../generated/api/applications/types.gen';

export async function fetchApplications(): Promise<ApplicationList> {
  const result = await listApplications();
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to list applications');
  }
  return result.data as ApplicationList;
}

export async function fetchApplication(id: string): Promise<Application> {
  const result = await getApplication({
    path: { applicationId: id },
  });
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to get application');
  }
  return result.data as Application;
}

export async function submitApplication(
  data: Record<string, unknown>,
): Promise<Application> {
  const result = await createApplication({
    body: data as Parameters<typeof createApplication>[0]['body'],
  });
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to create application');
  }
  return result.data as Application;
}

export async function patchApplication(
  id: string,
  data: Record<string, unknown>,
): Promise<Application> {
  const result = await updateApplication({
    path: { applicationId: id },
    body: data as Parameters<typeof updateApplication>[0]['body'],
  });
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to update application');
  }
  return result.data as Application;
}
