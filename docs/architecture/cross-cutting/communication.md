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

## Capabilities

| Capability | Supported By |
|------------|--------------|
| **Caseworker** | |
| Generate notice from task | `Notice.generatedByTaskId`, notice templates |
| Review notice before sending | `Notice.status: pending_review` |
| Track notice delivery | `DeliveryRecord` entity |
| **Supervisor** | |
| Approve notices before sending | `Notice.status: approved` |
| Monitor failed deliveries | `DeliveryRecord.status: failed/returned` |
| **System/Automation** | |
| Auto-generate notices on determination | `Notice.noticeType`, triggered by eligibility events |
| Retry failed deliveries | `DeliveryRecord.retryCount` |
| Track response deadlines | `Notice.responseDueDate`, `Notice.responseReceivedDate` |
| **Client** | |
| View notices in portal | `DeliveryRecord.deliveryMethod: portal` |
| Respond to RFI | `Notice.responseReceivedDate` |

**Notes:**
- Notices are triggered by events in other domains (Intake, Eligibility, Workflow, Case Management).
- Notice content comes from templates (see [Configuration Management](../api-architecture.md#configuration-management)).
- Delivery tracking supports multiple channels (postal, email, portal).

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

---

## Process APIs

Process APIs orchestrate business operations by calling System APIs. They follow the pattern `POST /processes/{domain}/{resource}/{action}` and use `x-actors` and `x-capability` metadata.

See [API Architecture](../api-architecture.md) for the full Process API pattern.

### Notice Operations

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/communication/notices/send` | caseworker, system | Generate and send a notice |
| `POST /processes/communication/notices/approve` | supervisor | Approve a pending notice |
| `POST /processes/communication/notices/retry` | caseworker, system | Retry a failed delivery |

---

### Send Notice

Generate and send a notice to a client.

```yaml
POST /processes/communication/notices/send
x-actors: [caseworker, system]
x-capability: communication

requestBody:
  noticeType: string           # approval, denial, request_for_information, etc.
  applicationId: uuid          # Related application
  clientId: uuid               # Recipient
  programType: string          # snap, medicaid, tanf
  templateId: uuid             # Notice template to use (optional)
  templateData: object         # Data to populate template
  deliveryMethod:
    - postal_mail
    - email
    - both
  skipReview: boolean          # Auto-approve (for system-generated)

responses:
  200:
    notice: Notice             # Created notice
    deliveryRecord: DeliveryRecord

# Orchestrates:
# 1. Load notice template based on noticeType and programType
# 2. Populate template with client data and templateData
# 3. Create Notice record
# 4. If skipReview or system actor, set status: approved
# 5. If requires review, set status: pending_review
# 6. If approved, create DeliveryRecord and initiate delivery
# 7. If triggered by task, link via generatedByTaskId
```

### Approve Notice

Supervisor approves a notice pending review.

```yaml
POST /processes/communication/notices/approve
x-actors: [supervisor]
x-capability: communication

requestBody:
  noticeId: uuid               # Notice to approve
  modifications: object        # Optional edits to notice content
  notes: string                # Approval notes

responses:
  200:
    notice: Notice             # Approved notice
    deliveryRecord: DeliveryRecord

# Orchestrates:
# 1. Validate notice is in pending_review status
# 2. Apply any modifications
# 3. Update Notice.status → approved
# 4. Create DeliveryRecord and initiate delivery
```

### Retry Delivery

Retry a failed notice delivery.

```yaml
POST /processes/communication/notices/retry
x-actors: [caseworker, system]
x-capability: communication

requestBody:
  noticeId: uuid               # Notice to retry
  deliveryMethod: string       # Retry with same or different method
  updatedAddress: Address      # If address was incorrect (optional)
  updatedEmail: Email          # If email was incorrect (optional)

responses:
  200:
    deliveryRecord: DeliveryRecord  # New delivery attempt

# Orchestrates:
# 1. Validate previous delivery failed
# 2. Update recipient info if provided
# 3. Increment DeliveryRecord.retryCount
# 4. Create new DeliveryRecord with status: pending
# 5. Initiate delivery
```
