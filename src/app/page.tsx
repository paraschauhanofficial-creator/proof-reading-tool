import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function HomePage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />

      {/* Hero */}
      <section style={{ maxWidth: "720px", margin: "0 auto", padding: "80px 24px 64px", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          backgroundColor: "var(--accent-light)", color: "var(--accent)",
          fontSize: "11px", fontWeight: 500, padding: "4px 12px",
          borderRadius: "20px", border: "1px solid var(--accent-border)",
          marginBottom: "2rem",
        }}>
          Medical Journal Proofreading
        </div>

        <h1 style={{
          fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 600,
          lineHeight: 1.2, letterSpacing: "-0.8px",
          color: "var(--text-primary)", marginBottom: "1.25rem",
        }}>
          Publication-ready manuscripts,<br />every time
        </h1>

        <p style={{
          fontSize: "16px", color: "var(--text-secondary)",
          lineHeight: 1.7, maxWidth: "480px", margin: "0 auto 2.5rem",
        }}>
          MedProof AI applies a 7-pass editorial pipeline — grammar, APA style,
          medical terminology, and tracked changes — so your paper reads like it
          was edited by an expert.
        </p>

        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/auth/signup" style={{
            backgroundColor: "var(--accent)", color: "#fff",
            fontSize: "14px", fontWeight: 500, padding: "10px 24px",
            borderRadius: "8px", textDecoration: "none", display: "inline-block",
          }}>
            Start proofreading
          </Link>
          <Link href="/auth/login" style={{
            backgroundColor: "var(--bg-card)", color: "var(--text-primary)",
            fontSize: "14px", fontWeight: 500, padding: "10px 24px",
            borderRadius: "8px", textDecoration: "none", display: "inline-block",
            border: "1px solid var(--border)",
          }}>
            Sign in
          </Link>
        </div>
      </section>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)" }} />

      {/* Features */}
      <section style={{ maxWidth: "720px", margin: "0 auto", padding: "56px 24px" }}>
        <p style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "1.5rem" }}>
          What it does
        </p>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1px", backgroundColor: "var(--border)",
          border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden",
        }}>
          {[
            { icon: "✦", title: "7-pass editing", desc: "Grammar, style, APA, terminology, consistency — all in one run." },
            { icon: "⟷", title: "Tracked changes", desc: "Sentence-level markup, compatible with Word's All Markup view." },
            { icon: "⚕", title: "Medical precision", desc: "Person-first language, gene italics, TCM terms preserved." },
            { icon: "↓", title: "Clean output", desc: "Clean version, tracked changes, and edit summary." },
          ].map((f) => (
            <div key={f.title} style={{ backgroundColor: "var(--bg-card)", padding: "20px" }}>
              <div style={{ fontSize: "18px", color: "var(--accent)", marginBottom: "10px" }}>{f.icon}</div>
              <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", marginBottom: "4px" }}>{f.title}</div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: "720px", margin: "0 auto", padding: "0 24px 56px" }}>
        <p style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "1.5rem" }}>
          How it works
        </p>
        <div style={{ border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
          {[
            { num: "01", title: "Upload your manuscript", desc: "Drop a .docx file — the original text is extracted and sent for editing." },
            { num: "02", title: "AI runs the 7-pass pipeline", desc: "Each pass targets a specific layer: grammar, academic English, medical writing, journal style, APA, consistency, and final review." },
            { num: "03", title: "Download your files", desc: "Get the clean version, a tracked-changes .docx, and a categorised edit summary." },
          ].map((s, i) => (
            <div key={s.num} style={{
              display: "flex", alignItems: "flex-start", gap: "14px",
              padding: "18px 20px", backgroundColor: "var(--bg-card)",
              borderBottom: i < 2 ? "1px solid var(--border)" : "none",
            }}>
              <span style={{
                fontSize: "11px", fontWeight: 600, color: "var(--accent)",
                backgroundColor: "var(--accent-light)", border: "1px solid var(--accent-border)",
                borderRadius: "6px", padding: "2px 8px", flexShrink: 0, marginTop: "2px",
              }}>{s.num}</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", marginBottom: "3px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid var(--border)", padding: "20px 40px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "12px",
      }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-muted)" }}>MedProof AI</div>
        <div style={{ display: "flex", gap: "24px" }}>
          {["Privacy", "Terms", "Contact"].map((l) => (
            <a key={l} href="#" style={{ fontSize: "12px", color: "var(--text-muted)", textDecoration: "none" }}>{l}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}