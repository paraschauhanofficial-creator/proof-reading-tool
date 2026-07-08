"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import * as XLSX from "xlsx";

export default function RecordsPage() {
  const [manuscripts, setManuscripts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchManuscripts();
  }, []);

  const fetchManuscripts = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth/login"); return; }

    const { data } = await supabase
      .from("manuscripts")
      .select("*")
      .order("incoming_date", { ascending: true });

    if (data) setManuscripts(data);
    setLoading(false);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  };

  // Get unique months from delivery dates
  const months = Array.from(new Set(
    manuscripts
      .filter(m => m.delivery_date)
      .map(m => {
        const d = new Date(m.delivery_date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      })
  )).sort();

  const filtered = selectedMonth === "all"
    ? manuscripts
    : manuscripts.filter(m => {
        if (!m.delivery_date) return false;
        const d = new Date(m.delivery_date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return key === selectedMonth;
      });

  const handleExport = () => {
    const rows = filtered.map(m => ({
      "Receiving date": formatDate(m.incoming_date),
      "Delivery date": formatDate(m.delivery_date),
      "Remarks / Contents / Project": m.notes || "",
      "Original Doc. Name": m.title || "",
      "English word count": m.word_count || "",
      "Rate Rs/K EN": "",
      "Amount": "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 35 },
      { wch: 40 },
      { wch: 20 },
      { wch: 16 },
      { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Records");

    const monthLabel = selectedMonth === "all"
      ? "All"
      : new Date(selectedMonth + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" });

    XLSX.writeFile(wb, `AIPR_Records_${monthLabel}.xlsx`);
  };

  const totalWords = filtered.reduce((sum, m) => sum + (m.word_count || 0), 0);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              Records
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              {filtered.length} document{filtered.length !== 1 ? "s" : ""} · {totalWords.toLocaleString()} total words
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Month filter */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
                borderRadius: "8px", padding: "8px 12px", fontSize: "13px",
                color: "var(--text-primary)", outline: "none", cursor: "pointer",
              }}
            >
              <option value="all">All months</option>
              {months.map(m => (
                <option key={m} value={m}>
                  {new Date(m + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" })}
                </option>
              ))}
            </select>

            {/* Export button */}
            <button
              onClick={handleExport}
              style={{
                backgroundColor: "var(--accent)", color: "#fff", border: "none",
                borderRadius: "8px", padding: "8px 18px", fontSize: "13px",
                fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              }}
            >
              📥 Export Excel
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "13px" }}>No records found.</p>
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
                    {[
                      "Receiving date",
                      "Delivery date",
                      "Remarks / Contents / Project",
                      "Original Doc. Name",
                      "English word count",
                      "Rate Rs/K EN",
                      "Amount",
                    ].map((col) => (
                      <th key={col} style={{
                        padding: "11px 14px", textAlign: "left",
                        fontSize: "11px", fontWeight: 600,
                        color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.5px", whiteSpace: "nowrap",
                      }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m, i) => (
                    <tr
                      key={m.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                        backgroundColor: i % 2 === 0 ? "var(--bg-card)" : "var(--bg)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-light)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = i % 2 === 0 ? "var(--bg-card)" : "var(--bg)")}
                    >
                      <td style={{ padding: "11px 14px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {formatDate(m.incoming_date)}
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {formatDate(m.delivery_date)}
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-secondary)", maxWidth: "280px" }}>
                        {m.notes || <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-primary)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.title}
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-secondary)", textAlign: "right" }}>
                        {m.word_count ? m.word_count.toLocaleString() : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-muted)" }}>
                        —
                      </td>
                      <td style={{ padding: "11px 14px", color: "var(--text-muted)" }}>
                        —
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Footer totals */}
                <tfoot>
                  <tr style={{ backgroundColor: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
                    <td colSpan={4} style={{ padding: "11px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Total — {filtered.length} documents
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", textAlign: "right" }}>
                      {totalWords.toLocaleString()}
                    </td>
                    <td colSpan={2} style={{ padding: "11px 14px" }} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}