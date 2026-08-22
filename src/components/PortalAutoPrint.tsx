"use client";

import { useEffect } from "react";

export function PortalAutoPrint({ invoiceId, width }: { invoiceId: string; width: "58" | "80" }) {
  useEffect(() => {
    window.open(`/stampa/portal/racuni/${invoiceId}/termalni?sirina=${width}`, "_blank", "noopener,noreferrer");
  }, [invoiceId, width]);

  return null;
}
