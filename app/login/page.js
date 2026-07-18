"use client";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

// Only allow same-origin relative paths — blocks open-redirect attacks.
function safeRedirect(raw) {
  if (!raw || typeof raw !== "string") return "/";
  // Must start with / but not // (protocol-relative) and must not contain a protocol
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/^\/[a-z][a-z\d+\-.]*:/i.test(raw)) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });
    setSubmitting(false);
    if (res?.error) {
      setError(res.error === "CredentialsSignin" ? "Invalid username or password." : res.error);
      return;
    }
    router.push(safeRedirect(params.get("callbackUrl")));
    router.refresh();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F4F5F7",
        fontFamily: "Inter, sans-serif",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "#fff",
          border: "1px solid #E4E7EC",
          borderRadius: 14,
          padding: 32,
          width: "100%",
          maxWidth: 340,
          boxSizing: "border-box",
          boxShadow: "0 1px 2px rgba(14,20,32,0.04)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0E1420", marginBottom: 4 }}>
          Sharewealth Brokerage Desk
        </div>
        <div style={{ fontSize: 13, color: "#4B5566", marginBottom: 22 }}>Sign in to continue</div>

        <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#4B5566", marginBottom: 6 }}>
          Username
        </label>
        <input
          type="text"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
          autoComplete="username"
        />

        <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#4B5566", margin: "14px 0 6px" }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          autoComplete="current-password"
        />

        {error && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: "#DC2626" }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "10px 0",
            borderRadius: 8,
            border: "none",
            background: "#132038",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13.5,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #E4E7EC",
  fontSize: 13.5,
  boxSizing: "border-box",
};
