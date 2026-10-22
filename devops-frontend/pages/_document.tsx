import Document, { Head, Html, Main, NextScript, type DocumentContext, type DocumentInitialProps } from 'next/document';

type DocumentProps = DocumentInitialProps & { nonce?: string };

export default function AppDocument({ nonce }: DocumentProps) {
  return (
    <Html lang="en" data-theme="light">
      <Head nonce={nonce}>
        <script src="/theme-boot.js" nonce={nonce} />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#121A31" />
      </Head>
      <body>
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  );
}

AppDocument.getInitialProps = async (ctx: DocumentContext): Promise<DocumentProps> => {
  const initialProps = await Document.getInitialProps(ctx);
  const header = ctx.req?.headers['x-nonce'];
  const nonce = Array.isArray(header) ? header[0] : header;
  return { ...initialProps, nonce };
};
