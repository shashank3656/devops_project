import { Head, Html, Main, NextScript } from 'next/document';

const THEME_BOOTSTRAP = `try{var t=(localStorage.getItem('opstrellis-theme')||localStorage.getItem('setuops-theme'))==='dark'?'dark':'light';document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}catch(e){}`;

export default function Document() {
  return (
    <Html lang="en" data-theme="light">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#121A31" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
