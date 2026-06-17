"use client";

type PrintButtonProps = {
  label?: string;
};

export function PrintButton({ label = "Stampaj" }: PrintButtonProps) {
  return (
    <button className="print-button" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
