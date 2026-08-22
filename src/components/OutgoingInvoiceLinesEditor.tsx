"use client";

import { useMemo, useRef, useState } from "react";
import { QuickItemCreateModal, type QuickItemResult } from "@/components/QuickItemCreateModal";

type Item = { id: string; code: string; name: string; unit: string; vat: number; service: boolean; netPrice: string; grossPrice: string };
type Line = { key: string; itemId: string; quantity: string; netUnitPrice: string; discountPercent: string; note: string };
type Option = { id: string; label: string };

function newLine(): Line { return { key: crypto.randomUUID(), itemId: "", quantity: "1", netUnitPrice: "", discountPercent: "0", note: "" }; }
function number(value: string) { const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; }

export function OutgoingInvoiceLinesEditor({ items: initialItems, initialLines, groups, units, vatRates, disabled = false, quickItemEndpoint }: { items: Item[]; initialLines: Omit<Line, "key">[]; groups: Option[]; units: Option[]; vatRates: Option[]; disabled?: boolean; quickItemEndpoint?: string }) {
  const [items, setItems] = useState(initialItems);
  const [lines, setLines] = useState<Line[]>(() => initialLines.length ? initialLines.map((line) => ({ ...line, key: crypto.randomUUID() })) : [newLine()]);
  const [newItemTarget, setNewItemTarget] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const totals = lines.reduce((sum, line) => {
    const item = itemMap.get(line.itemId); const qty = number(line.quantity); const price = number(line.netUnitPrice); const rebate = Math.min(100, Math.max(0, number(line.discountPercent)));
    const base = qty * price * (1 - rebate / 100); const vat = base * ((item?.vat ?? 0) / 100);
    return { base: sum.base + base, vat: sum.vat + vat, total: sum.total + base + vat };
  }, { base: 0, vat: 0, total: 0 });

  function update(key: string, patch: Partial<Line>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); }
  function selectItem(key: string, itemId: string) { const item = itemMap.get(itemId); update(key, { itemId, netUnitPrice: item?.netPrice || (item?.grossPrice && item.vat >= 0 ? (number(item.grossPrice) / (1 + item.vat / 100)).toFixed(4) : "") }); }
  function createdItem(item: QuickItemResult) {
    const vat = number(item.vatPercent);
    const created: Item = { id: item.id, code: item.sifra, name: item.naziv, unit: item.unitCode, vat, service: item.service === true, grossPrice: item.saleGrossPrice, netPrice: (number(item.saleGrossPrice) / (1 + vat / 100)).toFixed(4) };
    setItems((current) => [...current, created].sort((a, b) => a.code.localeCompare(b.code)));
    const target = newItemTarget ?? lines[lines.length - 1]?.key;
    if (target) update(target, { itemId: created.id, netUnitPrice: created.netPrice });
    setNewItemTarget(null);
  }
  function onEnter(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.currentTarget instanceof HTMLTextAreaElement) return;
    event.preventDefault(); const controls = [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-invoice-cell]:not([disabled])") ?? [])]; const index = controls.indexOf(event.currentTarget);
    if (index >= 0 && index < controls.length - 1) controls[index + 1].focus();
    else { setLines((current) => [...current, newLine()]); setTimeout(() => { const next = tableRef.current?.querySelectorAll<HTMLElement>("[data-invoice-cell]:not([disabled])"); next?.[next.length - 4]?.focus(); }, 0); }
  }
  const payload = lines.filter((line) => line.itemId).map(({ itemId, quantity, netUnitPrice, discountPercent, note }) => ({ itemId, quantity, netUnitPrice, discountPercent, note }));

  return <>
    <input type="hidden" name="stavke_json" value={JSON.stringify(payload)} />
    <div className="table-wrap outgoing-invoice-lines"><table ref={tableRef}>
      <thead><tr><th>#</th><th>Artikal / usluga</th><th>JM</th><th>Količina</th><th>Cijena bez PDV</th><th>Rabat %</th><th>PDV</th><th>Osnovica</th><th>Ukupno</th><th></th></tr></thead>
      <tbody>{lines.map((line, index) => { const item = itemMap.get(line.itemId); const qty = number(line.quantity); const price = number(line.netUnitPrice); const base = qty * price * (1 - Math.min(100, Math.max(0, number(line.discountPercent))) / 100); const total = base * (1 + (item?.vat ?? 0) / 100); return <tr key={line.key}>
        <td>{index + 1}</td><td><select data-invoice-cell disabled={disabled} value={line.itemId} onChange={(e) => selectItem(line.key, e.target.value)} onKeyDown={onEnter} required><option value="">Izaberi po šifri ili nazivu</option>{items.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}{option.service ? " · usluga" : ""}</option>)}</select></td>
        <td>{item?.unit ?? "-"}</td><td><input data-invoice-cell disabled={disabled} inputMode="decimal" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} onKeyDown={onEnter} /></td>
        <td><input data-invoice-cell disabled={disabled} inputMode="decimal" value={line.netUnitPrice} onChange={(e) => update(line.key, { netUnitPrice: e.target.value })} onKeyDown={onEnter} /></td>
        <td><input data-invoice-cell disabled={disabled} inputMode="decimal" value={line.discountPercent} onChange={(e) => update(line.key, { discountPercent: e.target.value })} onKeyDown={onEnter} /></td>
        <td>{item?.vat ?? 0}%</td><td>{base.toFixed(2)}</td><td><strong>{total.toFixed(2)}</strong></td>
        <td><button className="table-button table-button-danger" disabled={disabled || lines.length === 1} type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>×</button></td>
      </tr>; })}</tbody>
    </table></div>
    <div className="outgoing-invoice-editor-footer"><div className="button-row"><button className="secondary-button" disabled={disabled} type="button" onClick={() => setLines((current) => [...current, newLine()])}>+ Dodaj stavku</button><button className="secondary-button" disabled={disabled} type="button" onClick={() => setNewItemTarget(lines.find((line) => !line.itemId)?.key ?? lines[lines.length - 1]?.key ?? null)}>+ Novi artikal / usluga</button></div><div className="invoice-live-totals"><span>Osnovica <strong>{totals.base.toFixed(2)} €</strong></span><span>PDV <strong>{totals.vat.toFixed(2)} €</strong></span><span>Za plaćanje <strong>{totals.total.toFixed(2)} €</strong></span></div></div>
    <p className="admin-hint">Enter prelazi u sljedeće polje. Na kraju reda automatski se dodaje nova stavka. Cijena i PDV se preuzimaju iz šifarnika, ali cijenu možeš korigovati na nacrtu.</p>
    {newItemTarget ? <QuickItemCreateModal endpoint={quickItemEndpoint} groups={groups} units={units} vatRates={vatRates} onClose={() => setNewItemTarget(null)} onCreated={createdItem} /> : null}
  </>;
}
