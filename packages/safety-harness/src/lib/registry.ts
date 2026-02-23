import type { FormContract, PermissionsPolicy } from '@safety-net/form-engine-react';
import type { ZodSchema } from 'zod';

export interface ContractRegistryEntry {
  contract: FormContract;
  schema: ZodSchema;
  permissions: Record<string, PermissionsPolicy>;
}

const registry: Record<string, ContractRegistryEntry> = {};

export function getContractEntry(contractId: string): ContractRegistryEntry | undefined {
  return registry[contractId];
}

export default registry;
