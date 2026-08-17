/** Hand-written types for parse.mjs, which is plain JS shared with the CLI. */

export type ArRow = {
  financial_class_code: string;
  financial_class_name: string | null;
  bucket_current: number | null;
  bucket_30: number | null;
  bucket_60: number | null;
  bucket_90: number | null;
  bucket_120_plus: number | null;
  closing_ar: number | null;
};

export type ActivityRow = {
  financial_class_code: string;
  financial_class_name: string | null;
  units: number | null;
  charges: number | null;
  payments: number | null;
  adjustments: number | null;
};

export type Claim = {
  carrier_name: string | null;
  provider_name: string | null;
  chart: string | null;
  visit_id: string | null;
  cpt_lines: number;
  bucket_current: number;
  bucket_30: number;
  bucket_60: number;
  bucket_90: number;
  bucket_120_plus: number;
  total: number;
};

export type ServiceRow = {
  financial_class_code: string | null;
  procedure_code: string;
  description: string | null;
  units: number | null;
  charges: number | null;
};

export type VisitRow = {
  metric: "visits" | "new_patients";
  financial_class_code: string;
  financial_class_name: string | null;
  period_month: string;
  value: number;
};

export type ReferralRow = {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  new_patients_mtd: number | null;
  new_patients_ytd: number | null;
  visits_mtd: number | null;
  visits_ytd: number | null;
};

export type ParsedReport = {
  source_file: string;
  clinic_name: string;
  period_month: string | null;
  sheets_present: string[];
  ar_monthly: { rows: ArRow[]; error?: string };
  activity_monthly: {
    rows: ActivityRow[];
    grandTotal?: Omit<ActivityRow, "financial_class_code" | "financial_class_name"> | null;
    error?: string;
  };
  carrier_ar: {
    claims: Claim[];
    cptLines: number;
    checks: {
      providers?: number;
      providerMismatch?: number;
      carriers?: number;
      carrierMismatch?: number;
      drift?: number;
    };
    error?: string;
  };
  service_monthly: {
    rows: ServiceRow[];
    checks?: { checked: number; mismatched: number };
    error?: string;
  };
  visits_new_patients: { rows: VisitRow[]; error?: string };
  referrals_monthly: { rows: ReferralRow[]; error?: string };
};

export function parseReportBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<ParsedReport>;
export function parseReportFile(file: string): Promise<ParsedReport>;
