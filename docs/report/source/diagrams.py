import json, sys
D = {}



D['dfd0'] = r'''flowchart LR
  AD["Admin /<br/>Owner"]:::e
  MG["Manager"]:::e
  CA["Cashier"]:::e
  CU["Customer"]:::e
  SU["Supplier"]:::e
  GM["Google<br/>Gemini"]:::e
  SYS(("0<br/>Digital Inventory &<br/>Sales Management<br/>System")):::p
  AD -- "users, settings,<br/>restock confirmation" --> SYS
  SYS -- "reports, alerts,<br/>restock plans" --> AD
  MG -- "products, stock counts,<br/>purchase orders, receipts" --> SYS
  SYS -- "stock levels,<br/>order status" --> MG
  CA -- "items scanned,<br/>payments" --> SYS
  SYS -- "bill total" --> CA
  CU -- "purchase request" --> SYS
  SYS -- "GST invoice" --> CU
  SYS -- "purchase order" --> SU
  SU -- "goods + supplier bill" --> SYS
  SYS -- "question + tool results" --> GM
  GM -- "answer / tool calls" --> SYS
  classDef e fill:#e8f1fc,stroke:#2a78d6,color:#0b0b0b
  classDef p fill:#fdeee7,stroke:#eb6834,color:#0b0b0b
'''
D['dfd1'] = r'''flowchart TB
  U["Staff user"]:::e
  SU["Supplier"]:::e
  CU["Customer"]:::e
  P1(("1.0<br/>Authenticate<br/>user")):::p
  P2(("2.0<br/>Manage<br/>catalogue")):::p
  P3(("3.0<br/>Record stock<br/>movement")):::p
  P4(("4.0<br/>Purchase<br/>& receive")):::p
  P5(("5.0<br/>POS billing")):::p
  P6(("6.0<br/>Forecast &<br/>plan restock")):::p
  P7(("7.0<br/>Reports &<br/>assistant")):::p
  D1[("D1 Users / Sessions")]:::d
  D2[("D2 Products / Suppliers")]:::d
  D3[("D3 Stock movements")]:::d
  D4[("D4 Purchase orders")]:::d
  D5[("D5 Sales / Returns")]:::d
  U -- "email, password" --> P1
  P1 <--> D1
  P1 -- "access token" --> U
  U -- "product details" --> P2
  P2 <--> D2
  U -- "order items" --> P4
  P4 <--> D4
  P4 -- "PO" --> SU
  SU -- "goods" --> P4
  P4 -- "received qty, cost" --> P3
  CU -- "items" --> P5
  P5 -- "invoice" --> CU
  P5 <--> D5
  P5 -- "sold qty" --> P3
  P3 <--> D3
  P3 -- "new stock level" --> D2
  D5 -- "sales history" --> P6
  D2 -- "stock, lead time" --> P6
  P6 -- "confirmed plan" --> P4
  D5 -- "figures" --> P7
  D3 -- "valuation" --> P7
  P7 -- "reports, answers" --> U
  classDef e fill:#e8f1fc,stroke:#2a78d6,color:#0b0b0b
  classDef p fill:#fdeee7,stroke:#eb6834,color:#0b0b0b
  classDef d fill:#e5f6ef,stroke:#1baf7a,color:#0b0b0b
'''

D['seq-receive'] = r'''sequenceDiagram
  autonumber
  actor M as Manager
  participant W as Web app
  participant A as API
  participant L as Stock ledger
  participant DB as MongoDB
  M->>W: Enter quantities,<br/>"Add to stock"
  W->>A: POST /purchase-orders/:id/receive
  A->>A: Check token, permission,<br/>validate input
  A->>DB: Start transaction
  A->>DB: Load order (must be open)
  loop each item received
    A->>L: recordMovement(purchase)
    L->>DB: Atomic stock update<br/>+ ledger entry
    A->>DB: Weighted-average cost
  end
  A->>DB: Save receipt and status
  A->>DB: Audit log entry
  A->>DB: Commit
  A-->>W: Updated order
  W-->>M: New status and stock
'''
D['seq-restock'] = r'''sequenceDiagram
  autonumber
  actor O as Owner
  participant W as Web app
  participant A as API
  participant G as Gemini
  participant F as Restock planner
  participant DB as MongoDB
  O->>W: "Restock based on<br/>previous demand?"
  W->>A: POST /assistant/chat
  A->>G: Question + tools
  G-->>A: Call create_restock_plan
  A->>F: Forecast and plan
  F->>DB: Read sales, stock,<br/>open orders
  F->>DB: Save draft plan
  A->>G: Tool result
  G-->>A: Reply text
  A-->>W: Reply + plan card
  O->>W: Edit, then "Confirm<br/>& place orders"
  W->>A: POST /restock-plans/:id/confirm
  A->>DB: Transaction: re-check,<br/>create POs, audit log
  A-->>W: Orders created
  Note over A,G: AI tools create and edit drafts only.<br/>Only a person can confirm.
'''
D['po-states'] = r'''stateDiagram-v2
  direction LR
  [*] --> Draft: Save as draft
  [*] --> Ordered: Place order
  Draft --> Draft: Edit items
  Draft --> Ordered: Place order
  Draft --> Cancelled: Cancel
  Ordered --> PartlyReceived: Receive some items
  Ordered --> Received: Receive all items
  Ordered --> Cancelled: Cancel
  PartlyReceived --> PartlyReceived: Receive more
  PartlyReceived --> Received: Receive the rest
  PartlyReceived --> Closed: Close short
  Received --> [*]
  Closed --> [*]
  Cancelled --> [*]
'''
D['restock-states'] = r'''stateDiagram-v2
  direction LR
  [*] --> Draft: AI / Smart Restock prepares plan
  Draft --> Draft: Owner edits quantities (or asks the AI to)
  Draft --> Confirmed: Owner presses "Confirm & place orders"
  Draft --> Cancelled: Owner cancels
  Draft --> Expired: Stock changed or older than 24 h
  Confirmed --> [*]: One purchase order per supplier created
'''

json.dump(D, open(sys.argv[1], 'w'))
print(len(D))
