/**
 * Assembly function for PUT /intake/applications/{applicationId}/eligibility-snapshot.
 *
 * Called by the generic createSingletonReplaceHandler in route-generator.js when
 * the operationId is registered in SINGLETON_PUT_ASSEMBLERS. Returns the assembled
 * EligibilitySnapshot body, or null if the parent application is not found.
 *
 * Assembly: pulls household-info, application-members, and each member's sub-resources
 * (income, expenses, assets, employment, health-coverage) plus verifications scoped to
 * that member. Assembles into the EligibilitySnapshot shape defined in intake-openapi.yaml.
 */

import { findAll, findById } from '../database-manager.js';

export function assembleEligibilitySnapshot(applicationId) {
  const application = findById('applications', applicationId);
  if (!application) return null;

  const { items: householdItems } = findAll('household-infos', { applicationId }, { limit: 1 });
  const householdSnapshot = householdItems.length > 0 ? householdItems[0] : {};

  const { items: allMembers } = findAll('application-members', { applicationId }, { limit: 1000 });
  const { items: allVerifications } = findAll('application-verifications', { applicationId }, { limit: 10000 });

  const members = allMembers.map(member => {
    const memberId = member.id;

    const { items: income } = findAll('member-incomes', { memberId }, { limit: 1000 });
    const { items: expenses } = findAll('member-expenses', { memberId }, { limit: 1000 });
    const { items: assets } = findAll('member-assets', { memberId }, { limit: 1000 });
    const { items: employment } = findAll('member-employment-records', { memberId }, { limit: 1000 });
    const { items: healthCoverage } = findAll('member-health-coverages', { memberId }, { limit: 1000 });

    const verificationSummary = allVerifications.filter(
      v => v.sourceId === memberId && v.sourceType === 'member'
    );

    const memberSnapshot = { ...member, income, expenses, assets, employment, healthCoverage };

    return { memberId, memberSnapshot, verificationSummary };
  });

  return { householdSnapshot, members, refreshedAt: new Date().toISOString() };
}
