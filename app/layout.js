import Providers from "./providers";

export const metadata = {
  title: "Sharewealth Brokerage Desk",
  description: "Internal brokerage dashboard",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
