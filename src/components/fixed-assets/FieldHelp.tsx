"use client";
import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import styles from "./form-help.module.css";

export function FieldHelp({ title, help, children }: {
  title: string;
  help: ReactNode;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <div className={styles.field}>
    <div className={styles.heading}>
      <label htmlFor={id}>{title}</label>
      <button className={styles.helpButton} type="button" aria-label={`Pomoć: ${title}`}
        aria-expanded={open} aria-controls={`${id}-help`} onClick={() => setOpen(!open)}>ⓘ</button>
    </div>
    <div id={`${id}-help`} className={styles.help} hidden={!open}>{help}</div>
    {cloneElement(children, { id, "aria-describedby": open ? `${id}-help` : undefined })}
  </div>;
}

export function CalculationHelp({ children }: { children: ReactNode }) {
  return <details className={styles.calculation}>
    <summary>Kako se računa amortizacija?</summary>
    <div className={styles.help}>{children}</div>
  </details>;
}
