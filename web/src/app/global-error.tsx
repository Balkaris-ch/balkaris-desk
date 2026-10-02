"use client";

import { Trouble } from "@/components/shell/Trouble";
import "@/styles/tokens.css";
import "@/styles/base.css";

/**
 * The last resort: the root layout itself failed, so this draws the document.
 * The root layout does almost nothing (fonts, the two stylesheets), so this
 * should never be seen; if it is, the system fonts stand in for the desk's.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Balkaris desk</title>
        <Trouble error={error} retry={retry} form="page" />
      </body>
    </html>
  );
}
