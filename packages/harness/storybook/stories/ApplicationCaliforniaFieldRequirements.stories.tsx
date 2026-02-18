// Auto-generated from authored/contracts/application/california-field-requirements.form.yaml. Run `npm run generate:stories` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ReferenceRenderer } from '../../src/engine/ReferenceRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import type { FormContract, PermissionsPolicy } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/application/california-field-requirements.form.yaml';
import layoutYaml from '../../authored/contracts/application/california-field-requirements.form.yaml?raw';
// Permissions (all roles)
import applicantPermsData from '../../authored/permissions/applicant.yaml';
import applicantPermsYaml from '../../authored/permissions/applicant.yaml?raw';
import caseworkerPermsData from '../../authored/permissions/caseworker.yaml';
import caseworkerPermsYaml from '../../authored/permissions/caseworker.yaml?raw';
import reviewerPermsData from '../../authored/permissions/reviewer.yaml';
import reviewerPermsYaml from '../../authored/permissions/reviewer.yaml?raw';
// Annotations (layered)
import annotationLayer0 from '../../generated/annotations/federal.yaml';
import annotationLayer0Yaml from '../../generated/annotations/federal.yaml?raw';
import annotationLayer1 from '../../generated/annotations/california.yaml';
import annotationLayer1Yaml from '../../generated/annotations/california.yaml?raw';
// Resolved OpenAPI spec
import schemaSpecData from '../../generated/openapi/california-benefits-schema.yaml';
import schemaSpecYaml from '../../generated/openapi/california-benefits-schema.yaml?raw';

const typedContract = contract as unknown as FormContract;
const allPermissions: PermissionsPolicy[] = [
  applicantPermsData as unknown as PermissionsPolicy,
  caseworkerPermsData as unknown as PermissionsPolicy,
  reviewerPermsData as unknown as PermissionsPolicy,
];
const annotationLayers = [
  { name: 'federal', data: annotationLayer0 as unknown as Record<string, unknown> },
  { name: 'california', data: annotationLayer1 as unknown as Record<string, unknown> },
];
const typedSchemaSpec = schemaSpecData as unknown as Record<string, unknown>;

// Consolidated reference content (generated at build time)
const annotationFieldsRefContent = "# Available annotation fields and program names\n#\n# Use in columns as: annotation.<layer>.<property>\n# Properties: label, source, statute, notes, programs.<name>\n\n# ── federal (212 fields) ──\n\n# Programs:\n#   annotation.federal.programs.CHIP\n#   annotation.federal.programs.LIHEAP\n#   annotation.federal.programs.Medicaid (MAGI)\n#   annotation.federal.programs.Medicaid (Non-MAGI)\n#   annotation.federal.programs.SNAP\n#   annotation.federal.programs.SSI\n#   annotation.federal.programs.Section 8 Housing\n#   annotation.federal.programs.Summer EBT\n#   annotation.federal.programs.TANF\n#   annotation.federal.programs.WIC\n\n# Fields:\n#   accommodationNeeded\n#   accommodationType\n#   applicationDate\n#   calsawsCaseNumber\n#   consentToShareData\n#   consentToVerifyInformation\n#   household.californiaResidencyVerified\n#   household.countyCode\n#   household.energySupplierAccountNumber\n#   household.energySupplierName\n#   household.familyType\n#   household.isHomeless\n#   household.livingArrangement\n#   household.mailingAddress.city\n#   household.mailingAddress.state\n#   household.mailingAddress.street1\n#   household.mailingAddress.street2\n#   household.mailingAddress.zip\n#   household.members.abawdCountableMonths\n#   household.members.abawdExemptionReason\n#   household.members.abawdWorkHoursPerWeek\n#   household.members.age\n#   household.members.alcoholAbusePattern\n#   household.members.alienRegistrationNumber\n#   household.members.assets.accountNumber\n#   household.members.assets.burialArrangementValue\n#   household.members.assets.burialFundAmount\n#   household.members.assets.homeEquityValue\n#   household.members.assets.institutionName\n#   household.members.assets.isHomestead\n#   household.members.assets.isJointlyOwned\n#   household.members.assets.jointOwnerName\n#   household.members.assets.lifeInsuranceCashValue\n#   household.members.assets.lifeInsuranceFaceValue\n#   household.members.assets.propertyDescription\n#   household.members.assets.propertyEquity\n#   household.members.assets.propertyFairMarketValue\n#   household.members.assets.recentAssetTransfer\n#   household.members.assets.transferAmount\n#   household.members.assets.transferDate\n#   household.members.assets.trustType\n#   household.members.assets.trustValue\n#   household.members.assets.type\n#   household.members.assets.value\n#   household.members.assets.vehicleFairMarketValue\n#   household.members.assets.vehicleMake\n#   household.members.assets.vehicleModel\n#   household.members.assets.vehicleUseType\n#   household.members.assets.vehicleYear\n#   household.members.assets.verificationSource\n#   household.members.calsawsClientId\n#   household.members.citizenshipStatus\n#   household.members.dateOfBirth\n#   household.members.dateOfEntryToUS\n#   household.members.deemedIncomeFromParent\n#   household.members.deemedIncomeFromSponsor\n#   household.members.deemedIncomeFromSpouse\n#   household.members.deemedResourcesFromParent\n#   household.members.deemedResourcesFromSpouse\n#   household.members.deliveryDate\n#   household.members.disabilityDuration\n#   household.members.disabilityStatus\n#   household.members.disabilityType\n#   household.members.drugFelonyConviction\n#   household.members.drugFelonyConvictionDate\n#   household.members.drugRelatedCriminalActivity\n#   household.members.employerInsuranceAffordable\n#   household.members.employerInsuranceAvailable\n#   household.members.employmentStatus\n#   household.members.ethnicity\n#   household.members.expectedDueDate\n#   household.members.expectedReleaseDate\n#   household.members.expenses.amount\n#   household.members.expenses.courtOrderNumber\n#   household.members.expenses.description\n#   household.members.expenses.forPersonId\n#   household.members.expenses.frequency\n#   household.members.expenses.recipientOrProvider\n#   household.members.expenses.type\n#   household.members.expenses.verificationSource\n#   household.members.firstName\n#   household.members.fleeingFelonStatus\n#   household.members.gender\n#   household.members.goodCauseExemptionFromWork\n#   household.members.goodCauseExemptionReason\n#   household.members.gradeLevel\n#   household.members.immigrationDocumentNumber\n#   household.members.immigrationDocumentType\n#   household.members.incomes.businessExpenses\n#   household.members.incomes.employerCity\n#   household.members.incomes.employerName\n#   household.members.incomes.employerState\n#   household.members.incomes.employerStreet\n#   household.members.incomes.employerZip\n#   household.members.incomes.endDate\n#   household.members.incomes.frequency\n#   household.members.incomes.grossAmount\n#   household.members.incomes.hoursPerWeek\n#   household.members.incomes.isSeasonalOrIrregular\n#   household.members.incomes.netAmount\n#   household.members.incomes.startDate\n#   household.members.incomes.tipsAndCommissions\n#   household.members.incomes.type\n#   household.members.incomes.verificationSource\n#   household.members.institutionalStatus\n#   household.members.institutionalizationDate\n#   household.members.ipvDisqualificationEndDate\n#   household.members.ipvHistory\n#   household.members.isAbawdEligible\n#   household.members.isApplicant\n#   household.members.isBlind\n#   household.members.isBreastfeeding\n#   household.members.isElderlyOrDisabled\n#   household.members.isEnrolledInSchool\n#   household.members.isFormerFosterYouth\n#   household.members.isHeadStartParticipant\n#   household.members.isInFosterCare\n#   household.members.isIndianTribalMember\n#   household.members.isMigrantYouth\n#   household.members.isMinorParent\n#   household.members.isPostpartum\n#   household.members.isPregnant\n#   household.members.isRunawayYouth\n#   household.members.isSchoolAge\n#   household.members.isStudent\n#   household.members.lastName\n#   household.members.levelOfCareAssessment\n#   household.members.maritalStatus\n#   household.members.mediCalAidCode\n#   household.members.medicaidBuyInEligible\n#   household.members.medicaidBuyInEmploymentVerified\n#   household.members.medicaidEnrollmentGroup\n#   household.members.medicaidWorkExemptionReason\n#   household.members.medicaidWorkHoursPerMonth\n#   household.members.meetsGainfulActivityTest\n#   household.members.methamphetamineProductionConviction\n#   household.members.middleName\n#   household.members.minorParentLivingArrangement\n#   household.members.needsLongTermCare\n#   household.members.numberOfExpectedChildren\n#   household.members.nutritionalRiskConditions\n#   household.members.nutritionalRiskLevel\n#   household.members.priorEvictionDate\n#   household.members.priorEvictionFromPublicHousing\n#   household.members.qualifiedAlienCategory\n#   household.members.race\n#   household.members.receivesOtherBenefits\n#   household.members.relationshipToApplicant\n#   household.members.schoolDistrict\n#   household.members.schoolName\n#   household.members.sexOffenderRegistryStatus\n#   household.members.shareOfCostAmount\n#   household.members.snapWorkRegistered\n#   household.members.snapWorkRegistrationExempt\n#   household.members.spouseIsInstitutionalized\n#   household.members.ssn\n#   household.members.sspAmount\n#   household.members.sspLivingArrangementCategory\n#   household.members.strikerStatus\n#   household.members.studentEmployedMinHours\n#   household.members.studentExemptionReason\n#   household.members.studentWorkStudy\n#   household.members.suffix\n#   household.members.tanfChildSupportGoodCause\n#   household.members.tanfCooperatesWithChildSupport\n#   household.members.tanfMonthsUsed\n#   household.members.tanfSanctionStatus\n#   household.members.tanfTotalWorkHoursPerWeek\n#   household.members.taxClaimedAsDependent\n#   household.members.taxClaimedByPersonId\n#   household.members.taxClaimsDependents\n#   household.members.taxFilingJointly\n#   household.members.taxFilingStatus\n#   household.members.twoParentFamily\n#   household.members.veteranStatus\n#   household.members.violentCriminalActivity\n#   household.members.wicParticipantCategory\n#   household.physicalAddress.city\n#   household.physicalAddress.county\n#   household.physicalAddress.state\n#   household.physicalAddress.street1\n#   household.physicalAddress.street2\n#   household.physicalAddress.zip\n#   household.preferredLanguage\n#   household.previousHousingAssistance\n#   household.primaryContactEmail\n#   household.primaryContactPhone\n#   household.primaryHeatingFuelType\n#   household.purchasePrepareFoodTogether\n#   household.sharedQuartersWithNonMembers\n#   household.shelterCosts.insurance\n#   household.shelterCosts.mortgage\n#   household.shelterCosts.propertyTax\n#   household.shelterCosts.rent\n#   household.size\n#   household.stateResidencySinceDate\n#   household.utilityCosts.electric\n#   household.utilityCosts.gas\n#   household.utilityCosts.heating\n#   household.utilityCosts.telephone\n#   household.utilityCosts.water\n#   isExpedited\n#   noticeDeliveryPreference\n#   paymentMethodPreference\n#   penaltyOfPerjuryAcknowledged\n#   programsAppliedFor\n#   rightsAndResponsibilitiesAcknowledged\n#   signatureDate\n#   signatureMethod\n#   signatureOfApplicant\n#   voterRegistrationOffered\n#   voterRegistrationResponse\n\n# ── california (26 fields) ──\n\n# Programs:\n#   annotation.california.programs.CA LIHEAP\n#   annotation.california.programs.CAPI\n#   annotation.california.programs.CFAP\n#   annotation.california.programs.CalFresh\n#   annotation.california.programs.CalWORKs\n#   annotation.california.programs.California WIC\n#   annotation.california.programs.GA/GR\n#   annotation.california.programs.Medi-Cal (Children)\n#   annotation.california.programs.Medi-Cal (MAGI)\n#   annotation.california.programs.Medi-Cal (Non-MAGI)\n#   annotation.california.programs.SSI/SSP\n#   annotation.california.programs.SUN Bucks\n\n# Fields:\n#   calsawsCaseNumber\n#   household.californiaResidencyVerified\n#   household.countyCode\n#   household.members.assets.recentAssetTransfer\n#   household.members.assets.type\n#   household.members.assets.value\n#   household.members.assets.verificationSource\n#   household.members.calsawsClientId\n#   household.members.citizenshipStatus\n#   household.members.dateOfBirth\n#   household.members.disabilityStatus\n#   household.members.incomes.grossAmount\n#   household.members.incomes.type\n#   household.members.isAbawdEligible\n#   household.members.isBlind\n#   household.members.mediCalAidCode\n#   household.members.medicaidBuyInEligible\n#   household.members.medicaidBuyInEmploymentVerified\n#   household.members.shareOfCostAmount\n#   household.members.ssn\n#   household.members.sspAmount\n#   household.members.sspLivingArrangementCategory\n#   household.members.tanfCooperatesWithChildSupport\n#   household.members.tanfMonthsUsed\n#   household.preferredLanguage\n#   household.utilityCosts.heating\n";
const permissionsRefContent = "# Available permissions roles\n#\n# Use in columns as: permissions.<role>\n# Values: editable | read-only | masked | hidden\n\n# ── applicant ──\n# Permissions policy for the applicant role.\r\n#\r\n# defaults: permission level applied to all fields unless overridden.\r\n#   Allowed values: editable | read-only | masked | hidden\r\n#\r\n# fields: per-field overrides (use the field ref from the form contract).\r\n#   Each value must be one of: editable | read-only | masked | hidden\r\n\r\nrole: applicant\r\ndefaults: editable\r\nfields:\r\n  socialSecurityNumber: editable\n\n# ── caseworker ──\n# Permissions policy for the caseworker role.\r\n#\r\n# defaults: permission level applied to all fields unless overridden.\r\n#   Allowed values: editable | read-only | masked | hidden\r\n#\r\n# fields: per-field overrides (use the field ref from the form contract).\r\n#   Each value must be one of: editable | read-only | masked | hidden\r\n\r\nrole: caseworker\r\ndefaults: editable\n\n# ── reviewer ──\n# Permissions policy for the reviewer role.\r\n#\r\n# defaults: permission level applied to all fields unless overridden.\r\n#   Allowed values: editable | read-only | masked | hidden\r\n#\r\n# fields: per-field overrides (use the field ref from the form contract).\r\n#   Each value must be one of: editable | read-only | masked | hidden\r\n\r\nrole: reviewer\r\ndefaults: read-only\r\nfields:\r\n  socialSecurityNumber: masked\n";

const meta: Meta = {
  title: 'Reference/California Field Requirements',
  parameters: { layout: 'fullscreen' },
};

export default meta;

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/application/california-field-requirements.form.yaml', source: layoutYaml },
    { id: 'schema-spec', label: 'OpenAPI Schema', filename: 'generated/openapi/california-benefits-schema.yaml', source: schemaSpecYaml, readOnly: true, group: 'reference' as const },
    { id: 'annotations-federal', label: 'Federal Annotations', filename: 'generated/annotations/federal.yaml', source: annotationLayer0Yaml, readOnly: true, group: 'reference' as const },
    { id: 'annotations-california', label: 'California Annotations', filename: 'generated/annotations/california.yaml', source: annotationLayer1Yaml, readOnly: true, group: 'reference' as const },
    { id: 'annotation-fields', label: 'Annotation Fields', filename: 'Available annotation column values', source: annotationFieldsRefContent, readOnly: true, group: 'reference' as const },
    { id: 'permissions-ref', label: 'Permissions', filename: 'Available permission roles', source: permissionsRefContent, readOnly: true, group: 'reference' as const },
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="application-california-field-requirements"
      formTitle="California Field Requirements"
      onLayoutChange={setActiveContract}
      onPermissionsChange={() => {}}
      onTestDataChange={() => {}}
    >
      <ReferenceRenderer
        contract={activeContract}
        annotationLayers={annotationLayers}
        schemaSpec={typedSchemaSpec}
        permissionsPolicies={allPermissions}
      />
    </ContractPreview>
  );
}

export const ApplicationCaliforniaFieldRequirements: StoryObj = {
  name: 'California Field Requirements',
  render: () => <StoryWrapper />,
};
