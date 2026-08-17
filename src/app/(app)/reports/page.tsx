import { ReportView } from "./report-view";

export const metadata = { title: "Reports · MOne" };

export default function ReportsPage() {
  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            Read a monthly clinic report workbook and check it before anything
            is loaded.
          </p>
        </div>
      </header>
      <ReportView />
    </main>
  );
}
