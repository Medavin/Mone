/**
 * What the import engine is allowed to load, and how each column behaves.
 *
 * Declared here rather than inferred from the database, for two reasons.
 *
 * First, inference cannot tell you which columns MATTER. Postgres knows
 * `amount` is numeric; it does not know that a denial without an amount is
 * usually a bad row, or that `clinic_id` has to be resolved from a name.
 *
 * Second, it is a deliberate allow-list. An engine that can write to any
 * table is one mis-selected dropdown away from writing to `profiles`.
 */

export type FieldKind = "text" | "number" | "money" | "date" | "boolean" | "clinic" | "person";

export type Field = {
  column: string;
  label: string;
  kind: FieldKind;
  /** A row without this is rejected rather than loaded half-empty. */
  required?: boolean;
  /** Header names commonly seen for this field, used to guess the mapping. */
  aliases?: string[];
  hint?: string;
};

export type Target = {
  table: string;
  label: string;
  description: string;
  /** Columns that together identify a row, for updating rather than duplicating. */
  conflict?: string[];
  fields: Field[];
};

/** Shared by anything that names a clinic in a column. */
const clinicField: Field = {
  column: "clinic_id",
  label: "Clinic",
  kind: "clinic",
  aliases: ["clinic", "client", "practice", "office", "location", "clinic name", "client name"],
  hint: "Matched by name against your clinics, including the name mappings.",
};

export const TARGETS: Target[] = [
  {
    table: "denials",
    label: "Denials",
    description: "From AdvancedMD's Denial Module, or any denial export.",
    fields: [
      { column: "denial_date", label: "Denial date", kind: "date", required: true,
        aliases: ["denial date", "date", "denied on", "posted date", "process date"] },
      clinicField,
      { column: "denial_code", label: "Denial code", kind: "text", required: true,
        aliases: ["denial code", "code", "reason code", "carc", "adjustment code", "denial cd"] },
      { column: "denial_type", label: "Type or reason", kind: "text",
        aliases: ["denial type", "type", "reason", "description", "denial reason"] },
      { column: "carrier", label: "Carrier", kind: "text",
        aliases: ["carrier", "payer", "insurance", "plan", "payor"] },
      { column: "amount", label: "Amount", kind: "money",
        aliases: ["amount", "denied amount", "charge", "balance", "billed"] },
      { column: "claim_no", label: "Claim number", kind: "text",
        aliases: ["claim", "claim no", "claim number", "claim id", "icn"] },
      { column: "service_date", label: "Date of service", kind: "date",
        aliases: ["dos", "service date", "date of service", "from dos"] },
      { column: "patient_name", label: "Patient", kind: "text",
        aliases: ["patient", "patient name", "name"], hint: "Test data only until the hosting move." },
      { column: "chart_no", label: "Chart number", kind: "text",
        aliases: ["chart", "chart no", "account", "mrn", "patient id"] },
    ],
  },
  {
    table: "crl_entries",
    label: "CRL",
    description: "Claims sent out to a CAM or a collector.",
    fields: [
      { column: "entry_date", label: "Date", kind: "date", required: true,
        aliases: ["date", "sent date", "entry date", "created"] },
      clinicField,
      { column: "sent_to", label: "Sent to", kind: "text",
        aliases: ["sent to", "routed to", "assigned to", "queue"],
        hint: "Expects cam, collector, client or other. Anything else lands as other." },
      { column: "insurance", label: "Insurance", kind: "text",
        aliases: ["insurance", "carrier", "payer", "plan"] },
      { column: "issue", label: "Issue", kind: "text",
        aliases: ["issue", "reason", "problem", "notes", "description"] },
      { column: "amount", label: "Amount", kind: "money",
        aliases: ["amount", "balance", "charge", "outstanding"] },
      { column: "patient_name", label: "Patient", kind: "text",
        aliases: ["patient", "patient name", "name"] },
      { column: "chart_no", label: "Chart number", kind: "text",
        aliases: ["chart", "chart no", "account", "mrn"] },
    ],
  },
  {
    table: "reported_payments",
    label: "Reported payments",
    description: "What a clinic says it received, before it is applied.",
    fields: [
      { column: "reported_on", label: "Reported on", kind: "date", required: true,
        aliases: ["date", "reported", "reported on", "deposit date", "check date"] },
      clinicField,
      { column: "amount", label: "Amount", kind: "money", required: true,
        aliases: ["amount", "payment", "check amount", "deposit", "paid"] },
      { column: "method", label: "Method", kind: "text",
        aliases: ["method", "type", "payment type", "source"],
        hint: "Expects check, eft, era, ehr, card or cash. Anything else lands as other." },
      { column: "reference", label: "Reference", kind: "text",
        aliases: ["reference", "check no", "check number", "trace", "batch"] },
      { column: "payer", label: "Payer", kind: "text",
        aliases: ["payer", "carrier", "insurance", "from"] },
    ],
  },
  {
    table: "clinic_payers",
    label: "In-network payers",
    description: "Which payers a clinic is contracted with.",
    conflict: ["clinic_id", "payer_name"],
    fields: [
      clinicField,
      { column: "payer_name", label: "Payer", kind: "text", required: true,
        aliases: ["payer", "carrier", "insurance", "plan", "payer name"] },
      { column: "payer_id", label: "Payer ID", kind: "text",
        aliases: ["payer id", "id", "electronic payer id", "epid"] },
      { column: "in_network", label: "In network", kind: "boolean",
        aliases: ["in network", "par", "participating", "contracted", "status"] },
      { column: "effective_from", label: "Effective from", kind: "date",
        aliases: ["effective", "effective from", "start date", "contract date"] },
      { column: "fee_schedule", label: "Fee schedule", kind: "text",
        aliases: ["fee schedule", "schedule", "rate"] },
    ],
  },
  {
    table: "clinic_people",
    label: "Clinic contacts and providers",
    description: "Doctors, therapists, contacts and office managers.",
    fields: [
      clinicField,
      { column: "full_name", label: "Name", kind: "text", required: true,
        aliases: ["name", "provider", "full name", "therapist", "doctor", "contact"] },
      { column: "kind", label: "Kind", kind: "text",
        aliases: ["kind", "type", "role"],
        hint: "contact, provider, owner, front_desk, billing or other." },
      { column: "credential", label: "Credential", kind: "text",
        aliases: ["credential", "degree", "title", "designation"] },
      { column: "npi", label: "NPI", kind: "text", aliases: ["npi", "individual npi"] },
      { column: "email", label: "Email", kind: "text", aliases: ["email", "e-mail"] },
      { column: "phone", label: "Phone", kind: "text", aliases: ["phone", "telephone", "mobile"] },
    ],
  },
  {
    table: "clinic_locations",
    label: "Clinic locations",
    description: "Additional sites for a client.",
    fields: [
      clinicField,
      { column: "name", label: "Site name", kind: "text", required: true,
        aliases: ["name", "site", "location", "office"] },
      { column: "address_line1", label: "Address", kind: "text", aliases: ["address", "street", "address 1"] },
      { column: "city", label: "City", kind: "text", aliases: ["city", "town"] },
      { column: "state", label: "State", kind: "text", aliases: ["state", "st"] },
      { column: "postal_code", label: "ZIP", kind: "text", aliases: ["zip", "postal", "zip code"] },
      { column: "phone", label: "Phone", kind: "text", aliases: ["phone", "telephone"] },
      { column: "location_npi", label: "Location NPI", kind: "text", aliases: ["npi", "location npi", "group npi"] },
    ],
  },
  {
    table: "inventory_items",
    label: "Inventory",
    description: "Equipment and stock.",
    fields: [
      { column: "name", label: "Item", kind: "text", required: true, aliases: ["item", "name", "description", "asset"] },
      { column: "category", label: "Category", kind: "text", aliases: ["category", "type", "class"] },
      { column: "brand", label: "Brand", kind: "text", aliases: ["brand", "make", "manufacturer"] },
      { column: "model", label: "Model", kind: "text", aliases: ["model", "model no"] },
      { column: "serial_no", label: "Serial", kind: "text", aliases: ["serial", "serial no", "sn"] },
      { column: "asset_tag", label: "Asset tag", kind: "text", aliases: ["tag", "asset tag", "asset id"] },
      { column: "quantity", label: "Quantity", kind: "number", aliases: ["qty", "quantity", "count"] },
      { column: "location", label: "Where", kind: "text", aliases: ["location", "site", "office"] },
      { column: "purchased_on", label: "Bought on", kind: "date", aliases: ["purchase date", "bought", "purchased"] },
      { column: "cost", label: "Cost", kind: "money", aliases: ["cost", "price", "value"] },
    ],
  },
];

export const targetFor = (table: string) => TARGETS.find((t) => t.table === table);
