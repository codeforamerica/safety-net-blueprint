# Communication (Cross-Cutting)

Detailed schemas for the Communication cross-cutting concern. See [Domain Design Overview](../domain-design.md) for context.

## Overview

Communication is cross-cutting because notices and correspondence can originate from any domain:
- **Intake**: "Application received"
- **Eligibility**: "Approved", "Denied", "Request for information"
- **Workflow**: "Documents needed", "Interview scheduled"
- **Case Management**: "Case worker assigned"

| Entity | Purpose |
|--------|---------|
| **Notice** | Official communication (approval, denial, RFI, etc.) |
| **Correspondence** | Other communications |
| **DeliveryRecord** | Tracking of delivery status |

---

## Schemas

### Notice

Official communications sent to clients.

```yaml
Notice:
  properties:
    id: uuid
    noticeType:
      # Determination
      - approval
      - denial
      - partial_approval
      # Information requests
      - request_for_information
      - interview_scheduled
      - interview_missed
      # Status
      - application_received
      - pending_verification
      - under_review
      # Action
      - renewal_due
      - recertification_required
      - benefits_ending
      - benefits_change
      # Appeals
      - appeal_received
      - hearing_scheduled
      - appeal_decision
    applicationId: uuid
    programType: enum
    recipientInfo: NoticeRecipientInfo
    deliveryMethod:
      - postal_mail
      - email
      - both
      - in_person
    status:
      - draft
      - pending_review
      - approved
      - sent
      - delivered
      - returned
      - failed
    language: Language
    responseRequired: boolean
    responseDueDate: datetime
    responseReceivedDate: datetime
    denialReasons: DenialReason[]        # For denial notices
    rfiItems: RequestForInformationItem[]  # For RFI notices
    generatedByTaskId: uuid              # Task that triggered this notice
    sentAt: datetime
    sentById: uuid
    createdAt, updatedAt: datetime
```

### NoticeRecipientInfo

Recipient details for a notice.

```yaml
NoticeRecipientInfo:
  properties:
    clientId: uuid
    name: Name
    address: Address                     # Mailing address
    email: Email                         # For electronic delivery
    preferredLanguage: Language
    accommodations: string[]             # Accessibility needs
```

### DenialReason

Reason for benefit denial.

```yaml
DenialReason:
  properties:
    code: string                         # Standard denial code
    description: string                  # Human-readable explanation
    regulation: string                   # Regulatory citation
    appealable: boolean
```

### RequestForInformationItem

Item requested in an RFI notice.

```yaml
RequestForInformationItem:
  properties:
    itemType: string                     # "income_verification", "identity_document", etc.
    description: string                  # What is needed
    dueDate: datetime                    # When it's due
    receivedDate: datetime               # When received (if any)
    status:
      - pending
      - received
      - waived
      - expired
```

### Correspondence

Other communications (non-official notices).

```yaml
Correspondence:
  properties:
    id: uuid
    correspondenceType:
      - client_inquiry
      - worker_note
      - inter_agency
      - third_party
    direction:
      - inbound                          # From client/external
      - outbound                         # To client/external
    applicationId: uuid
    caseId: uuid
    clientId: uuid
    subject: string
    body: string
    attachmentIds: uuid[]                # Document references
    sentById: uuid                       # Worker who sent (if outbound)
    receivedAt: datetime
    createdAt, updatedAt: datetime
```

### DeliveryRecord

Tracking of notice/correspondence delivery.

```yaml
DeliveryRecord:
  properties:
    id: uuid
    noticeId: uuid                       # Or correspondenceId
    deliveryMethod:
      - postal_mail
      - email
      - in_person
      - portal
    status:
      - pending
      - sent
      - delivered
      - bounced
      - returned
      - failed
    trackingNumber: string               # For postal mail
    sentAt: datetime
    deliveredAt: datetime
    failureReason: string
    retryCount: integer
    createdAt, updatedAt: datetime
```
