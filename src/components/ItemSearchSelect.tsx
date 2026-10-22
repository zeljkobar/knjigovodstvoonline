"use client";

import type { SelectHTMLAttributes } from "react";
import { AccountSearchSelect } from "./AccountSearchSelect";

export function ItemSearchSelect(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & { onConfirm?: () => void }) {
  return <AccountSearchSelect {...props} searchKind="item" />;
}
