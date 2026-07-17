import Providers from "./providers";

export const metadata = {
  title: "Sharewealth Brokerage Desk",
  description: "Internal brokerage dashboard",
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
