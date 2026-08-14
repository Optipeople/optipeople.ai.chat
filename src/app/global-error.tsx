"use client";

// Replaces the root layout when the layout itself crashes — no i18n
// provider is available here, so the copy is bilingual by design.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f7f7",
          color: "#212529",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong / Noget gik galt
          </h1>
          <p style={{ fontSize: 15, color: "#6c757d", marginBottom: 16 }}>
            Please try again. If it keeps happening, contact
            support@optipeople.dk.
            <br />
            Prøv igen. Kontakt support@optipeople.dk hvis det bliver ved.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "8px 24px",
              fontSize: 14,
              cursor: "pointer",
              border: "2px solid #378fc2",
              borderRadius: 2,
              background: "#bde0f5",
            }}
          >
            Try again / Prøv igen
          </button>
        </div>
      </body>
    </html>
  );
}
