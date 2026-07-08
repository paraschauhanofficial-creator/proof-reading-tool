"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignup = async () => {
    setLoading(true);
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setMessage("Check your email to confirm your account.");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar showAuth={false} />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "calc(100vh - 56px)", padding: "24px",
      }}>
        <div style={{ width: "100%", maxWidth: "400px" }}>

          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
              AI<span style={{ color: "var(--accent)" }}>PR</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              AI-Powered Document Proofreading
            </p>
          </div>

          {/* Card */}
          <div style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "32px",
          }}>
            <h2 style={{ fontSize: "17px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "24px" }}>
              Create your account
            </h2>

            {error && (
              <div style={{
                backgroundColor: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: "8px", padding: "10px 14px",
                fontSize: "13px", color: "#f87171", marginBottom: "16px",
              }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{
                backgroundColor: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: "8px", padding: "10px 14px",
                fontSize: "13px", color: "#4ade80", marginBottom: "16px",
              }}>
                {message}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "14px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "14px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                  placeholder="••••••••"
                  style={{
                    width: "100%", backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    padding: "10px 14px", fontSize: "14px",
                    color: "var(--text-primary)", outline: "none",
                  }}
                />
              </div>

              <button
                onClick={handleSignup}
                disabled={loading}
                style={{
                  width: "100%", backgroundColor: "var(--accent)",
                  color: "#fff", border: "none", borderRadius: "8px",
                  padding: "11px", fontSize: "14px", fontWeight: 500,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1, marginTop: "4px",
                }}
              >
                {loading ? "Creating account..." : "Create account"}
              </button>
            </div>

            <p style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginTop: "20px" }}>
              Already have an account?{" "}
              <Link href="/auth/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}