# Production xlsx headers (extracted 2026-07-16 — AUTHORITATIVE for import)

# Format: ## file / ### tab (rows=N) / header list


## 01-inventory-v1-old.xlsx

### Materials (rows=3)

`id | name | unit | category | lowStockThreshold | createdAt | createdBy | updatedAt | updatedBy`

### Suppliers (rows=3)

`id | name | contact | notes | createdAt | createdBy | updatedAt | updatedBy`

### Purchases (rows=1)

`id | date | supplierId | doNumber | notes | createdAt | createdBy`

### PurchaseLines (rows=1)

`id | purchaseId | materialId | qty | rate | amount | division | requestedBy`

### StockOuts (rows=0)

`id | dnNumber | date | division | project | notes | createdAt | createdBy`

### StockOutLines (rows=0)

`id | stockOutId | materialId | qty | ratePerUnit | amount`

### AuditLog (rows=9)

`timestamp | userEmail | action | recordType | recordId | details`


## 01-inventory-v2-old.xlsx

### Materials (rows=26)

`id | name | unit | category | lowStockThreshold | createdAt | createdBy | updatedAt | updatedBy | photoUrl`

### Tools (rows=3)

`id | name | category | brand | unit | totalQty | serialNumber | photoUrl | notes | createdAt | createdBy | updatedAt | updatedBy`

### ToolAssignments (rows=0)

`id | toolId | qty | person | division | assignedDate | assignedNotes | returnedDate | returnedQty | returnedCondition | returnedNotes | returnedPhotoUrl | createdAt | createdBy | updatedAt | updatedBy`

### Repairs (rows=0)

`id | toolId | assignmentId | qty | supplierId | sentDate | sentNotes | sentPhotoUrl | status | returnedDate | returnedQty | returnedNotes | returnedPhotoUrl | createdAt | createdBy | updatedAt | updatedBy`

### StockCounts (rows=0)

`id | countDate | itemType | itemId | systemQty | countedQty | variance | reason | notes | photoUrl | createdAt | createdBy | updatedAt | updatedBy`

### Suppliers (rows=14)

`id | name | contact | notes | createdAt | createdBy | updatedAt | updatedBy | contactPerson | category | supplierType`

### Purchases (rows=9)

`id | date | supplierId | doNumber | notes | createdAt | createdBy | invoiceUrl | discount | delivery | tax | roundingAdjustment`

### PurchaseLines (rows=13)

`id | purchaseId | materialId | qty | rate | amount | division | requestedBy | itemType`

### StockOuts (rows=7)

`id | dnNumber | date | division | project | notes | createdAt | createdBy | requestedBy`

### StockOutLines (rows=9)

`id | stockOutId | materialId | qty | ratePerUnit | amount`

### Quotations (rows=0)

`id | materialId | supplierId | rate | qtyOffered | validUntil | source | notes | createdAt | createdBy | updatedAt | updatedBy | screenshotUrl | itemType`

### AuditLog (rows=88)

`timestamp | userEmail | action | recordType | recordId | details`


## 01-inventory-v5-LIVE.xlsx

### Materials (rows=96)

`id | name | unit | category | lowStockThreshold | createdAt | createdBy | updatedAt | updatedBy | photoUrl`

### Workers (rows=2)

`id | name | role | division | active | createdAt | createdBy | updatedAt | updatedBy`

### Payments (rows=22)

`id | paymentDate | payeeType | payeeId | amount | method | referenceNumber | notes | slipPhotoUrl | createdAt | createdBy | updatedAt | updatedBy`

### PaymentAllocations (rows=35)

`id | paymentId | purchaseId | amountApplied`

### Suppliers (rows=27)

`id | name | contact | notes | createdAt | createdBy | updatedAt | updatedBy | contactPerson | category | supplierType`

### Purchases (rows=89)

`id | date | supplierId | doNumber | notes | createdAt | createdBy | invoiceUrl | discount | delivery | tax | roundingAdjustment | deliveryPhotos | paidBy`

### PurchaseLines (rows=164)

`id | purchaseId | materialId | qty | rate | amount | division | requestedBy | itemType`

### StockOuts (rows=78)

`id | dnNumber | date | division | project | notes | createdAt | createdBy | requestedBy | collectionPhotos`

### StockOutLines (rows=140)

`id | stockOutId | materialId | qty | ratePerUnit | amount`

### Quotations (rows=0)

`id | materialId | supplierId | rate | qtyOffered | validUntil | source | notes | createdAt | createdBy | updatedAt | updatedBy | screenshotUrl | itemType`

### Tools (rows=3)

`id | name | category | brand | unit | totalQty | serialNumber | photoUrl | notes | createdAt | createdBy | updatedAt | updatedBy`

### ToolAssignments (rows=2)

`id | toolId | qty | person | division | assignedDate | assignedNotes | returnedDate | returnedQty | returnedCondition | returnedNotes | returnedPhotoUrl | createdAt | createdBy | updatedAt | updatedBy`

### Repairs (rows=0)

`id | toolId | assignmentId | qty | supplierId | sentDate | sentNotes | sentPhotoUrl | status | returnedDate | returnedQty | returnedNotes | returnedPhotoUrl | createdAt | createdBy | updatedAt | updatedBy`

### StockCounts (rows=0)

`id | countDate | itemType | itemId | systemQty | countedQty | variance | reason | notes | photoUrl | createdAt | createdBy | updatedAt | updatedBy`

### AuditLog (rows=865)

`timestamp | userEmail | action | recordType | recordId | details`


## 02-smart-quotation.xlsx

### Malls (rows=5)

`ID | Name | Code | Location | Notes`

### Services (rows=6)

`ID | Name | IsExtra | Sort`

### PriceBook (rows=58)

`ID | Mall | Service | SubScope | Item | Unit | Compulsory | MinQty | MinCharge | PriceMall | PriceContractor | PriceTenant | Sort | Notes | Updated By | Updated On | CalcType | CalcParam | LinkKey | Cond | DefQty`

### Settings (rows=9)

`Key | Value`

### Quotes (rows=1)

`ID | QuoteNo | Date | Mall | Client | ClientType | Attention | Project | Subtotal | SST % | SST | Total | Status | Notes | Created By | Created On`

### QuoteLines (rows=5)

`ID | QuoteID | Service | SubScope | Item | Unit | Qty | Rate | Amount | Note | Sort`

### AuditLog (rows=44)

`Timestamp | User | Action | Details`


## 03-hoarding-pricing.xlsx

### Materials (rows=28)

`code | type | size | thickness | barQty | unit | costPrice | markup | updatedAt | updatedBy`

### Quotes (rows=0)

`id | quoteNo | date | client | contact | project | mall | lot | location | validity | status | length | height | doors | hoardingTotal | gateTotal | subtotal | sstPct | sstAmount | grandTotal | dataJson | createdAt | createdBy | updatedAt | updatedBy | signboardTotal | materialTotal | laborTotal`

### SupplierPrices (rows=0)

`id | code | supplier | costPrice | note | recordedAt | recordedBy`

### PriceHistory (rows=0)

`ts | code | field | oldVal | newVal | user | reason`

### Config (rows=21)

`key | value`

### AuditLog (rows=3)

`timestamp | userEmail | action | recordType | recordId | details`


## 04-expenses.xlsx

### Expenses (rows=262)

`id | createdAt | submittedBy | receiptDate | monthKey | vendor | description | category | currency | amount | type | status | imageUrl | remarks`

### AuditLog (rows=460)

`timestamp | userEmail | action | recordId | details`


## 05-payable.xlsx

### PaymentRequests (rows=49)

`id | createdAt | submittedBy | submitterName | requestor | department | project | payee | category | invoiceNo | invoiceDate | currency | description | lineItems | amount | sstApplicable | sstAmount | totalAmount | dueDate | priority | attachments | status | approvedBy | approvalDate | paymentReleaseDate | paymentMethod | paidAmount | outstanding | infotechKeyed | approverRemarks | entryMode | updatedAt | bankName | bankAccountName | bankAccountNo | lastAction | lastActionBy | requestAmount`

### AuditLog (rows=195)

`timestamp | userEmail | action | recordId | details`


## 06-receivable.xlsx

### PaymentsReceived (rows=21)

`id | createdAt | uploadedBy | uploaderName | payerName | payerBank | ourAccount | transactionType | referenceNo | valueDate | currency | amount | invoices | invoiceNosText | allocatedTotal | unallocated | description | attachments | status | verifiedBy | verifiedAt | keyedBy | keyedAt | possibleDuplicateOf | remarks | entryMode | updatedAt | lastAction | lastActionBy`

### AuditLog (rows=96)

`timestamp | userEmail | action | recordId | details`


## 07-workers.xlsx

### Divisions (rows=15)

`id | name | description | active | createdAt | createdBy`

### SwmsServices (rows=23)

`id | name | sortOrder`

### SwmsSteps (rows=171)

`id | service | stepNo | jobStep | method | hazards | impacts | existingControls | impact | likelihood | additionalControls | sortOrder`

### SwmsEquipment (rows=150)

`id | service | equipment | purpose | sortOrder`

### SwmsPPE (rows=85)

`id | service | ppe | sortOrder`

### InsurancePolicyAttachments (rows=3)

`id | policyId | label | driveUrl | sortOrder`

### InsurancePolicyQuotes (rows=0)

`id | policyId | provider | amount | notes | sortOrder`

### InsurancePolicyPayments (rows=0)

`id | policyId | paymentDate | amount | reference | notes | sortOrder`

### WorkPermitAttachments (rows=3)

`id | permitId | label | driveUrl | sortOrder`

### InsurancePolicies (rows=1)

`id | policyNumber | provider | coverageType | coverageAmount | validFrom | validUntil | driveUrl | notes | status | createdAt | createdBy | updatedAt | updatedBy | invoiceNumber | premiumAmount | chargedToClient`

### ReportHistory (rows=51)

`id | generatedAt | generatedBy | format | mallName | projectName | contractorRef | reportDate | divisionIds | workerIds | docTypes | workerCount | docTypeCount`

### Workers (rows=114)

`id | fullName | icNumber | passportNumber | nationality | divisionId | position | phone | photoDriveUrl | status | createdAt | createdBy | updatedAt | updatedBy`

### Documents (rows=354)

`id | workerId | docType | docSubtype | docNumber | issueDate | expiryDate | issuingAuthority | driveUrl | notes | createdAt | createdBy | updatedAt | updatedBy`

### Config (rows=4)

`key | value | notes`

### PermitForms (rows=2)

`id | mallName | formName | formType | version | driveUrl | contactInfo | leadTime | requirements | notes | lastVerifiedDate | createdAt | createdBy | updatedAt | updatedBy`

### WorkPermits (rows=35)

`id | permitNumber | title | mallName | projectReference | contractorClient | workScope | workArea | workingHours | appliedBy | issuedBy | issueDate | validFrom | validUntil | driveUrl | status | notes | createdAt | createdBy | updatedAt | updatedBy | duration | insuranceSource | insurancePolicyId | insuranceProvider | insurancePolicyNumber | insuranceDriveUrl | insuranceNotes | clientInvoiceNumber`

### WorkPermitWorkers (rows=9)

`id | permitId | workerId | role`

### AuditLog (rows=1000)

`timestamp | userEmail | action | recordType | recordId | details`


## 08-job-report.xlsx

### JCR Summary (rows=1384)

`Submitted At | Job Date | Lot Number | Trade Name | Mall / Site | Job Scope | Status | Client | Reference | Lorry No. | Lorry Code | Supervisor | Hoarding Workers | Visual Supervisor | Visual Workers | Hoarding Type | Panel | Door | Counterweight | Floor Protection | Fabric | Visual Material | Skirting | Photo Count | Remarks | Drive Folder | PDF Report | Submitted By | Other Workers | Other Materials | Report Type | Acknowledgement`


## 09-project-pl.xlsx

### Projects (rows=58)

`id | code | category | clientName | address | lotNumber | poNumber | invoiceNumber | invoiceDate | invoiceAmount | startDate | endDate | durationDays | status | notes | createdAt | createdBy | updatedAt | updatedBy | clientId | buildingId | buildingName | supervisorName | clientInvoiceUrl | subCategory | supervisorIds | discount | adjustment | sstApplicable | sstRate | parentProjectId | isInHouse`

### Divisions (rows=4)

`id | name | head | contactNumber | notes | createdAt | createdBy | updatedAt | updatedBy`

### CreditNotes (rows=0)

`id | projectId | type | creditNoteNumber | creditNoteDate | amount | reason | status | bankName | bankAccountName | bankAccountNumber | refundPaidDate | creditNoteUrl | notes | createdAt | createdBy | updatedAt | updatedBy`

### UserRoles (rows=8)

`id | email | role | notes | createdAt | createdBy | updatedAt | updatedBy`

### Supervisors (rows=6)

`id | name | role | contactNumber | notes | createdAt | createdBy | updatedAt | updatedBy`

### Manpower (rows=0)

`id | projectId | workerType | workerId | workerName | workDate | durationDays | rate | totalCost | notes | createdAt | createdBy | updatedAt | updatedBy | jobScopeId`

### ProjectPhotos (rows=19)

`id | projectId | kind | photoUrl | caption | takenDate | createdAt | createdBy | updatedAt | updatedBy`

### Workers (rows=3)

`id | name | role | contactNumber | notes | createdAt | createdBy | updatedAt | updatedBy`

### DailyReports (rows=0)

`id | projectId | reportDate | title | reportUrl | notes | createdAt | createdBy | updatedAt | updatedBy`

### SupplierPayments (rows=0)

`id | projectId | materialId | supplierId | supplierName | paymentDate | amount | reference | slipUrl | notes | createdAt | createdBy`

### SubconCharges (rows=33)

`id | projectId | subconId | subconName | lumpAmount | jobScopeIds | invoiceUrl | notes | createdAt | createdBy | updatedAt | updatedBy | invoiceNumber | invoiceDate | completionReportUrl | supportingDocsUrl`

### Clients (rows=47)

`id | name | contactPerson | contactNumber | email | address | notes | createdAt | createdBy | updatedAt | updatedBy`

### Buildings (rows=39)

`id | name | address | notes | createdAt | createdBy | updatedAt | updatedBy`

### Subcons (rows=36)

`id | name | trade | contactPerson | contactNumber | notes | createdAt | createdBy | updatedAt | updatedBy`

### Suppliers (rows=8)

`id | name | category | contactPerson | contactNumber | address | notes | createdAt | createdBy | updatedAt | updatedBy`

### MaterialItems (rows=8)

`id | name | defaultUnit | notes | createdAt | createdBy | updatedAt | updatedBy`

### Lookups (rows=51)

`id | type | value | sortOrder | createdAt | createdBy | updatedAt | updatedBy`

### JobScopes (rows=285)

`id | projectId | description | qty | unit | clientRate | clientAmount | subconName | subconRate | subconAmount | jobStatus | clientPaymentStatus | notes | createdAt | createdBy | updatedAt | updatedBy | subconId | subconInvoiceUrl | subconInvoiceNumber | subconInvoiceDate | completionReportUrl | supportingDocsUrl | performedBy | divisionId | divisionName | internalCost | costConfirmation`

### Materials (rows=9)

`id | projectId | jobScopeId | itemName | qty | unit | unitCost | totalCost | supplierName | poNumber | notes | createdAt | createdBy | updatedAt | updatedBy | itemId | supplierId | invoiceUrl | materialSource | chargedToSubconId | chargedToSubconName | invoiceNumber | invoiceDate | deliveryOrderUrl | materialPhotosUrl`

### ClientPayments (rows=42)

`id | projectId | paymentDate | amount | reference | notes | createdAt | createdBy | slipUrl`

### SubconPayments (rows=52)

`id | projectId | jobScopeId | subconName | paymentDate | amount | reference | notes | createdAt | createdBy | subconId | slipUrl`

### AuditLog (rows=1857)

`timestamp | userEmail | action | recordType | recordId | details`


## 10-storage-rental.xlsx

### Invoices (rows=2)

`id | invNo | rentalId | lotId | clientCompany | invDate | dueDate | periodFrom | periodTo | description | amount | sstEnabled | sstAmount | total | amountPaid | status | fileUrl | fileId | notes | createdAt | createdBy | updatedAt`

### Payments (rows=0)

`id | invoiceId | payDate | amount | method | reference | receivedBy | notes | createdAt`

### Lots (rows=32)

`id | zone | floor | type | lockset | widthMm | depthMm | areaSqm | notes | updatedAt`

### Rentals (rows=32)

`id | engagementType | lotId | clientCompany | department | clientPIC | clientContact | clientEmail | startDate | endDate | monthlyRate | deposit | depositStatus | status | notice1Sent | notice2Sent | agreementSigned | cctvNo | cctvUrl | itemsDescription | photosUrl | handledBy | remarks | createdAt | createdBy | updatedAt | updatedBy | agreementUrl`

### AuditLog (rows=93)

`timestamp | userEmail | action | recordType | recordId | details`

### Reminders (rows=0)

`Timestamp | RentalID | LotID | Client | Type | DaysToExpiry | SentTo`

### Config (rows=6)

`key | value`


## 11-scaffold-greentag.xlsx

### Engagements (rows=85)

`id | jobNo | serviceType | scope | status | clientCompany | clientPIC | clientContact | clientEmail | clientAddress | siteName | siteAddress | scaffoldDesc | thirdParty | peNo | peEndorsedBy | peEndorsedDate | startDate | expectedEndDate | actualReturnDate | greenTag | inspectIntervalDays | assignedInspector | deliverySignName | deliverySignDate | deliverySignUrl | returnSignName | returnSignDate | returnSignUrl | photosSite | photosBefore | photosAfter | photosCollection | photosDefect | handledBy | remarks | createdAt | createdBy | updatedAt | updatedBy`

### Charges (rows=23)

`id | engagementId | type | description | qty | unit | rate | basis | amount | invoiceId | createdAt | createdBy`

### Materials (rows=0)

`id | engagementId | code | item | spec | category | unit | qtyOut | qtyReturned | damageQty | damageCharge | remarks | updatedAt | updatedBy`

### Inspections (rows=0)

`id | engagementId | inspectDate | inspector | inspectorCertNo | result | tagNo | nextDueDate | findings | photosUrl | certUrl | createdAt | createdBy`

### Invoices (rows=90)

`id | invNo | engagementId | clientCompany | invDate | dueDate | description | amount | sstEnabled | sstAmount | total | status | fileUrl | fileId | notes | createdAt | createdBy | updatedAt`

### Payments (rows=0)

`id | invoiceId | payDate | amount | method | reference | receivedBy | notes | createdAt`

### Personnel (rows=3)

`id | name | role | certType | certNo | issuedDate | expiryDate | contact | remarks | updatedAt`

### Catalogue (rows=13)

`code | item | spec | category | unit`

### Config (rows=15)

`key | value`

### AuditLog (rows=275)

`timestamp | userEmail | action | recordType | recordId | details`


## 12-transport.xlsx

### Clients (rows=3)

`id | company | regNo | pic | contact | email | address | notes | createdAt | createdBy | updatedAt`

### Lorries (rows=3)

`id | plateNo | code | type | capacity | category | active | notes | updatedAt`

### Workers (rows=0)

`id | name | phone | role | payType | dayRate | nightRate | monthlySalary | active | notes | updatedAt`

### Trips (rows=1)

`id | ref | tripDate | shift | lorryPlate | driver | driverCost | lorryCost | crewJson | status | notes | createdAt | createdBy | updatedAt | updatedBy | driverId`

### Engagements (rows=4)

`id | ref | clientId | clientCompany | reason | siteName | siteAddress | status | handledBy | remarks | createdAt | createdBy | updatedAt | updatedBy`

### Jobs (rows=6)

`id | engagementId | engagementRef | clientId | clientCompany | service | status | startDateTime | endDateTime | fromLocation | toLocation | lorryType | lorryPlate | driver | trips | collectionMoverBy | deliveryMoverBy | movers | shifts | itemsDescription | binId | binNo | placementType | placeDateTime | collectDateTime | permitNo | swcorpRef | maxDays | rateCode | rateLabel | unitRate | quantity | amount | invoiceId | handledBy | remarks | createdAt | createdBy | updatedAt | updatedBy | tripId | stopSeq | internalUse | landfill | weightTons | tipFee | tippingDate | tippingReceiptUrl | stopsJson`

### Bins (rows=4)

`id | binNo | swcorpReg | size | status | notes | updatedAt`

### Rates (rows=9)

`id | service | code | label | unit | rate | active | updatedAt`

### Invoices (rows=0)

`id | invNo | engagementId | engagementRef | clientId | clientCompany | invDate | dueDate | description | amount | sstEnabled | sstAmount | total | status | fileUrl | fileId | notes | createdAt | createdBy | updatedAt`

### Payments (rows=0)

`id | invoiceId | payDate | amount | method | reference | receivedBy | notes | createdAt`

### Photos (rows=0)

`id | jobId | engagementId | service | stage | url | fileId | caption | takenBy | takenAt`

### Config (rows=11)

`key | value`

### AuditLog (rows=29)

`timestamp | userEmail | action | recordType | recordId | details`


## 13-dispatch-db.xlsx

### Jobs (rows=0)

`id | jobCode | client | clientGroup | mall | lotNo | jobType | scope | doorType | installDate | measureStatus | sketchUrl | quoteStatus | quoteRef | needsVisual | visualStatus | visualUrl | permitBy | permitStatus | permitUrl | permitApprovedAt | materialReady | materialNotes | jobStatus | dispatchDate | teamNo | seq | notes | createdAt | createdBy | updatedAt | updatedBy`

### Teams (rows=0)

`id | dispatchDate | teamNo | driver | workers | lorry | notes | createdAt | createdBy | updatedAt | updatedBy`

### Staff (rows=0)

`id | name | role | phone | active | createdAt | createdBy | updatedAt | updatedBy`

### Lorries (rows=0)

`id | plate | label | active | createdAt | createdBy | updatedAt | updatedBy`

### Config (rows=6)

`key | value | notes`

### AuditLog (rows=10)

`timestamp | userEmail | action | recordType | recordId | details`


## 13-job-arrangement.xlsx

### Jobs (rows=1680)

`id | title | client | mall | lot | shift | scope | date | time | notes | supervisorIds | workerIds | lorryIds | createdAt | updatedAt | supervisorNames | workerNames | lorryDetails | state | incentiveStatus | incentivePaidDate | incentiveNotes | wageStatus | wagePaidDate | wageNotes | allowStatus | allowPaidDate | allowNotes | remarks | po | invoiceNo | invoiceDate | invoiceAmount | invoiceStatus | invoiceNotes | chargeHoarding | chargeVisual | chargeDismantling | discount | hasTax | hoardingSize | workerTimes | chargePreliminaries | chargeInsurance | chargeOutstation | chargeScaffold | chargeDoor | chargeCounterweight | chargeFabric | chargePeepingHole | chargeOthers | chargeSkirting | cidbStatus | cidbSubmittedDate | cidbReference | cidbSubmittedBy | quotationNo | projectRemarks | clientAddress | clientRegNo | lineItems`

### VehicleLog (rows=530)

`id | date | lorryId | shift | departHG | returnHG | nextDayReturn | notes | tripDetails | createdAt | createdBy`

### AttendanceLog (rows=3344)

`id | workerId | workerName | date | category | clockIn | clockOut | nextDayOut | rawEvents | source | notes | createdAt | createdBy`

### ShiftConflictReviews (rows=4)

`id | workerId | workerName | date | category | shiftIds | status | reviewerNote | reviewedBy | reviewedAt | createdAt`

### Disputes (rows=113)

`id | submittedAt | workerId | workerName | date | claimedIn | claimedOut | claimedNextDay | claimedAmount | workerNote | status | reviewerNote | reviewedBy | reviewedAt | photos`

### AuditLog (rows=4851)

`timestamp | actor | action | detail`

### Clients (rows=122)

`value`

### States (rows=11)

`state | wkMult | wkAllow | inhouseInc | outsourceRate`

### MallStates (rows=201)

`mall | state`

### Monthly Summary (rows=222)

`Black Lee — Monthly Summary`

### Malls (rows=198)

`value`

### ScopeFactory (rows=16)

`value`

### ScopeOnsite (rows=18)

`value`

### Supervisors (rows=13)

`id | name | type`

### Workers (rows=55)

`id | name | rate | team | monthlyPay | bankName | accountName | accountNo`

### Lorries (rows=18)

`id | plate`


## 14-attendance.xlsx

### Records (rows=68)

`ID | File Key | File Name | Added At | Keyed By | Worker | Date | Time | App | Verify Code | Machine Tick | Verdict | EXIF Check | Notes | Photo (Drive ID) | Thumb | AI JSON | EXIF JSON`


## 15-fleet-command-center.xlsx

### Vehicles (rows=33)

`ID | Plate | Model | Type | Year | Notes | Keyed By | Doc Link | Lorry Code`

### Drivers (rows=15)

`ID | Name | IC | Phone | License Class | License Expiry | GDL Expiry | Assigned Vehicle | Notes | Keyed By | License Doc | Passport Photo | IC Doc | License Renewal Doc`

### Expiries (rows=6)

`ID | Subject | Type | Due Date | Notes | Keyed By | Doc Link`

### Expenses (rows=477)

`ID | Date | Vehicle | Category | Amount | Qty | Vendor | Ref | Notes | Source | Keyed By | Doc Link | Before Pics | After Pics | Delivery Order | Tipping Receipt | Payment Receipt | Tipping Ticket | Other Docs`

### Trips (rows=36)

`ID | Period | Vehicle | KM | Trips | Speeding | Braking | Accel | Cornering | Idling | Source | Keyed By`

### ImportLog (rows=12)

`ID | File | Type | Rows | Info | Imported At | Keyed By`


## 16-hoarding-library.xlsx

### Records (rows=2899)

`ID | Lot | Mall | Tenant | Length (m) | Height (m) | Area (m2) | Panels | Door Type | Door Qty | Door Size | Drawing No | Date | Notes | Drive File ID | File Name | Created At | Run | Group ID | Files (JSON)`

### MailBotLog (rows=1508)

`At | Kind | Message`

### Rates (rows=6)

`ID | Mall | Item | Unit | Rate (RM)`


## 17-mall-platform.xlsx

### Malls (rows=48)

`ID | Name | Code | UOM | Group | Location | Notes | Added By | Added On`

### HoardingLines (rows=0)

`ID | Date | Mall | Lot No | Tenant | Line Type | Cost Type | Description | Size | Length | Height | Qty | UOM | Total Size | Rate Mall | Amount Mall | Rate Contractor | Amount Contractor | Rate Tenant | Amount Tenant | Drawing File ID | Created By | Created On`

### TeamMembers (rows=1)

`ID | Name | Sort`

### MeasureTypes (rows=2)

`ID | Name | Sort`

### MeasureRequests (rows=17)

`ID | Date | Requestor | Mall | Lot No | Client | Work Type | Assigned To | Remarks | Ref Photos | Purpose | Status | Quote Sent On | Notes | Updated By | Updated On`

### SwmsServices (rows=14)

`ID | Name | Sort`

### SwmsSteps (rows=21)

`ID | Service | Step No | Job Step | Method | Hazards | Impacts | Existing Controls | Impact | Likelihood | Additional Controls | Sort`

### SwmsEquipment (rows=12)

`ID | Service | Equipment | Purpose | Sort`

### SwmsPPE (rows=7)

`ID | Service | PPE | Sort`

### Types (rows=13)

`ID | Category | Name | Sort`

### RequirementTypes (rows=23)

`ID | Category | Name | Sort`

### ShopTypes (rows=6)

`ID | Name | Sort`

### RateBasis (rows=4)

`ID | Name | Sort`

### Categories (rows=4)

`ID | Name | Sort`

### Requirements (rows=23)

`ID | Mall | Category | Requirement | Type | Value | Shop Type | Notes | Sort | Updated By | Updated On`

### JobCategories (rows=8)

`ID | Name | Sort`

### Panels (rows=2)

`ID | Name | PIC | Phone | Email | Notes | Updated By | Updated On`

### PanelRates (rows=2)

`ID | Panel | Job Category | Mall | Rate Basis | Price From | Price To | Lot Size Ref | Engaged On | Notes | Updated By | Updated On`

### Sketches (rows=368)

`Timestamp | Mall | Code | Lot No | Shop Type | Version | File Name | File URL | File ID | Folder URL | Remarks | Uploaded By`

### AuditLog (rows=125)

`Timestamp | User | Action | Details`


## 18-team-command.xlsx

### jobs (rows=3)

`id | no | service | invoiceNo | invoiceDate | status | clientName | value | createdAt | createdBy | updatedAt | updatedBy | b2bExempt | clientType | _json`

### scaffoldMaterials (rows=0)

(no headers)

### greenTagLogs (rows=0)

(no headers)

### rorobinEvents (rows=0)

(no headers)

### storageReminders (rows=0)

(no headers)

### hoardingQuotes (rows=0)

(no headers)

### expenses (rows=3)

`id | createdAt | amount | category | date | description | linkedJobId | paidVia`

### clients (rows=5)

`id | b2bExempt | contactEmail | contactName | contactTel | name | notes | type`

### sites (rows=3)

`id | address | name`

### team (rows=6)

`id | category | name | role | tel`

### lorries (rows=3)

`id | capacity | category | code | notes | plateNo | type`

### settings (rows=1)

`key | value`

### _SyncLog (rows=81)

`timestamp | user | action | jobCount | totalRecords`


## 19-claims.xlsx

### Claims (rows=4)

`id | claimNo | submittedAt | submittedBy | receiptDate | vendor | currency | subtotal | sstAmount | total | primaryCategory | status | pdfUrl | folderUrl | receiptUrls | remarks`

### ClaimLines (rows=14)

`id | claimId | description | quantity | unitPrice | lineAmount | category | remarks`

### Summaries (rows=1)

`id | summaryNo | generatedAt | generatedBy | claimNos | claimCount | currency | grandTotal | periodFrom | periodTo | pdfUrl | title | remarks`

### AuditLog (rows=5)

`timestamp | userEmail | action | recordType | recordId | details`


## 20-visual-works.xlsx

### Jobs (rows=3)

`id | jobNo | status | mall | lotNo | jobType | client | requestedBy | requestDate | installDate | completedDate | artworkLink | artworkProofUrl | sketchUrl | sitePhotosUrl | photosUrl | folderUrl | material | totalSqft | rateId | ratePerSqft | installRate | subtotal | expectedAmount | permitId | proceedBy | proceedAt | notes | createdAt | createdBy | updatedAt`

### Materials (rows=1)

`id | name | notes | updatedAt`

### JobPanels (rows=3)

`id | jobId | label | widthVal | heightVal | unit | qty | sqft | material | ratePerSqft | amount`

### Rates (rows=1)

`id | mall | material | jobType | ratePerSqft | installRate | minCharge | effectiveFrom | notes | updatedAt | updatedBy | packageRate`

### Malls (rows=16)

`id | name | notes | updatedAt`

### Permits (rows=0)

`id | mall | lotNo | permitType | permitNo | validFrom | validTo | fileUrl | fileId | notes | createdAt | createdBy`

### Workers (rows=0)

`id | name | role | phone | icNo | icFileUrl | icFileId | cidbNo | cidbExpiry | cidbFileUrl | cidbFileId | wahNo | wahExpiry | wahFileUrl | wahFileId | docType | docNo | docExpiry | docUrl | docFileId | status | notes | updatedAt | updatedBy`

### Invoices (rows=0)

`id | invNo | invDate | period | malls | claimedAmount | sstEnabled | sstAmount | claimedTotal | fileUrl | fileId | status | reconVerdict | reconNote | notes | createdAt | createdBy | updatedAt`

### InvoiceJobs (rows=0)

`id | invoiceId | jobId | claimedSqft | claimedAmount | recordedSqft | recordedAmount | varianceRm | flag`

### AuditLog (rows=35)

`timestamp | userEmail | action | recordType | recordId | details`


## 21-subcon-invoice.xlsx

### Invoices (rows=3)

`id | invNo | invDate | ref | issuerType | issuerName | issuerIc | issuerAddr | issuerPhone | issuerEmail | billToName | billToAddr | subtotal | sstEnabled | sstAmount | total | payInfo | notes | pdfUrl | folderUrl | createdAt | createdBy`

### InvoiceLines (rows=16)

`id | invoiceId | description | quantity | unitPrice | lineAmount`

### Subcons (rows=2)

`id | type | name | ic | addr | phone | email | payInfo | logoFileId | updatedAt`

### AuditLog (rows=5)

`timestamp | userEmail | action | recordType | recordId | details`


## 22-blog-linkedin-duplicate-sheet.xlsx

### Posts (rows=0)

`ID | Created At | Job Scope | Mall | Brand | Job Date | Caption | Image URL | Image File ID | Target | Wix Status | LinkedIn Status | Wix Link | LinkedIn Link | Pushed At`


## 22-blog-linkedin.xlsx

### Posts (rows=0)

`ID | Created At | Job Scope | Mall | Brand | Job Date | Caption | Image URL | Image File ID | Target | Wix Status | LinkedIn Status | Wix Link | LinkedIn Link | Pushed At`


## 24-lorry.xlsx

### Lorries (rows=28)

`id | plate | vehicleCode | model | year | active | notes | vehicleCardPhotoId | createdAt | createdBy | updatedAt | updatedBy | vehicleType`

### Vehicles (rows=0)

`ID | Plate | Model | Type | Year | Notes | Keyed By | Doc Link | Lorry Code | regDate | status | driver | notes | regCardUrl | createdBy | createdAt | updatedBy | updatedAt`

### Invoices (rows=2)

`id | category | vendor | invoiceNo | invoiceDate | plate | description | subtotalRM | taxRM | totalRM | mileageKm | weightTonnes | coveragePeriod | warranty | driveFileId | driveUrl | status | notes | createdBy | createdAt | updatedBy | updatedAt`

### InvoiceLineItems (rows=4)

`id | invoiceId | lineNo | description | qty | unitPriceRM | taxRateStr | amountRM`

### CartrackTrips (rows=0)

`id | plate | startTime | endTime | startLocation | endLocation | distanceKm | durationHms | speeding | braking | acceleration | cornering | idling | source | uploadedBy | uploadedAt`

### ShellSubsidySummary (rows=0)

`id | invoiceNo | invoiceDate | accountNo | grossFuelRM | subsidyRM | netRM | uploadedBy | uploadedAt`

### ImportLog (rows=0)

`ID | File | Type | Rows | Info | Imported At | Keyed By | notes`

### Drivers (rows=16)

`ID | Name | IC | Phone | License Class | License Expiry | GDL Expiry | Assigned Vehicle | Notes | Keyed By | License Doc | Passport Photo | IC Doc | License Renewal Doc | emergencyContactPhone | hireDate | assignedPlate | status | notes | photoId | licenseDocIds | createdAt | createdBy | updatedAt | updatedBy | icDocIds | category | ic | licenseNo | licenseExpiry | gdlExpiry | licenseUrl | icUrl`

### SummonLogs (rows=10)

`id | summonNumber | issuedDate | issuedBy | plate | driverName | driverId | location | offenceType | offenceDetails | fineRM | discountRM | discountDeadline | paymentDeadline | status | paidRM | paidDate | paymentRef | paymentProofIds | courtDate | responsibleParty | notes | summonCopyIds | createdAt | createdBy | updatedAt | updatedBy | offenceNo | offenceDate | offence | amountRM | deadline | docUrl`

### IncidentLogs (rows=3)

`id | date | time | plate | driverName | location | locationGps | type | collisionType | collisionOther | thirdPartyPlates | thirdPartyName | thirdPartyContact | thirdPartyInsurer | faultParty | details | damagedAsset | witnesses | towed | towCompany | towCostRM | injuryAny | injuryAction | injuredPersonName | hospitalName | injuryDetails | policeReportStatus | policeReportNumber | policeStation | followUpNeeded | followUpNotes | incidentPhotoIds | policeReportIds | quotationIds | compensationPaidRM | compensationPaidTo | compensationPaidIds | compensationReceivedRM | compensationReceivedFrom | compensationReceivedIds | insuranceClaimFiled | insuranceCompany | claimNumber | claimAmountRM | claimStatus | repairAction | linkedMaintId | status | notes | createdAt | createdBy | updatedAt | updatedBy | driver | description | damageRM | docUrl`

### ComplianceLogs (rows=57)

`id | plate | type | issuedDate | expiryDate | amountRM | coverageRM | insurer | policyNumber | agencyName | agencyChargesRM | notes | mainDocIds | receiptIds | agentInvoiceIds | paymentSlipIds | createdAt | createdBy | updatedAt | updatedBy | status | renewedById | prevId | paymentRef | paidDate | refNo | issueDate | docUrl`

### FuelLogs (rows=26)

`id | date | plate | odometer | litres | amountRM | station | paidBy | driver | notes | pumpPhotoId | receiptPhotoId | createdAt | createdBy | updatedAt | updatedBy | time | card | site | product | ppl | amount | odo | isSubsidy | source | uploadedBy | uploadedAt`

### TollParkLogs (rows=0)

`id | date | plate | type | amountRM | location | paidBy | driver | jobRef | duration | notes | receiptPhotoId | createdAt | createdBy | updatedAt | updatedBy | time | card | category | entry | exit | amount | source | uploadedBy | uploadedAt`

### MaintLogs (rows=50)

`id | date | plate | odometer | type | itemsReplaced | workshop | costRM | nextServiceKm | notes | receiptPhotoId | receiptPhotoIds | lineItems | subTotal | taxable | taxRate | taxAmount | discountAmount | beforePhotoIds | afterPhotoIds | createdAt | createdBy | updatedAt | updatedBy | nextServiceDate | paymentSlipIds | paymentRef | paidDate | invoiceNumber | paidRM`

### AuditLog (rows=342)

`timestamp | userEmail | action | recordType | recordId | details | ts | user`


## 25-4d-tracker.xlsx

### Sheet1 (rows=0)

(no headers)

### Results (rows=3578)

`date | drawNo | p1 | p2 | p3 | s1 | s2 | s3 | s4 | s5 | s6 | s7 | s8 | s9 | s10 | c1 | c2 | c3 | c4 | c5 | c6 | c7 | c8 | c9 | c10`
