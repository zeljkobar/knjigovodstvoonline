"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { createAndFiscalizePosSale } from "./actions";

type WarehouseType = "RETAIL" | "WHOLESALE";
type Item = {
  id: string;
  registerId: string;
  code: string;
  name: string;
  barcode: string | null;
  group: string;
  unit: string;
  netPrice: number;
  grossPrice: number;
  vatPercent: number;
  warehouseType: WarehouseType;
};
type Register = {
  id: string;
  name: string;
  code: string;
  defaultPayment: string;
  warehouseType: WarehouseType;
  warehouseName: string | null;
};
type CartLine = Item & { quantity: number };

function money(value: number) {
  return value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineTotalCents(line: Item, quantity: number) {
  if (line.warehouseType === "RETAIL") return Math.round(line.grossPrice * 100) * quantity;
  const baseCents = Math.round(line.netPrice * 100) * quantity;
  return baseCents + Math.round((baseCents * line.vatPercent) / 100);
}

function PayButton({ totalCents }: { totalCents: number }) {
  const { pending } = useFormStatus();
  return <button className="pos-pay-button" disabled={pending || totalCents <= 0} type="submit">{pending ? "Fiskalizacija…" : `Naplati ${money(totalCents / 100)} €`}</button>;
}

export function PosTerminal({ items, registers }: { items: Item[]; registers: Register[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Sve");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? "");
  const [payment, setPayment] = useState(registers[0]?.defaultPayment ?? "CASH");
  const [cartOpen, setCartOpen] = useState(false);
  const selectedRegister = registers.find((register) => register.id === registerId) ?? registers[0];
  const registerItems = useMemo(() => items.filter((item) => item.registerId === registerId), [items, registerId]);
  const groups = useMemo(() => ["Sve", ...Array.from(new Set(registerItems.map((item) => item.group)))], [registerItems]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return registerItems.filter((item) => (group === "Sve" || item.group === group) && (!needle || `${item.code} ${item.name} ${item.barcode ?? ""}`.toLocaleLowerCase().includes(needle)));
  }, [registerItems, query, group]);
  const totalCents = cart.reduce((sum, line) => sum + lineTotalCents(line, line.quantity), 0);

  function add(item: Item) {
    setCart((current) => {
      const found = current.find((line) => line.id === item.id);
      return found ? current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { ...item, quantity: 1 }];
    });
  }

  function quantity(id: string, delta: number) {
    setCart((current) => current.map((line) => line.id === id ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  }

  function changeRegister(nextId: string) {
    const nextRegister = registers.find((register) => register.id === nextId);
    setRegisterId(nextId);
    setPayment(nextRegister?.defaultPayment ?? "CASH");
    setGroup("Sve");
    setCart([]);
  }

  const cartPanel = <div className="pos-cart">
    <div className="pos-cart-header"><div><span>Račun</span><strong>{cart.reduce((sum, line) => sum + line.quantity, 0)} stavki</strong></div><button className="pos-mobile-close" onClick={() => setCartOpen(false)} type="button">Zatvori</button></div>
    <div className="pos-cart-lines">{cart.length ? cart.map((line) => <div className="pos-cart-line" key={line.id}>
      <div><strong>{line.name}</strong><small>{(line.warehouseType === "RETAIL" ? line.grossPrice : line.netPrice).toFixed(2)} €{line.warehouseType === "WHOLESALE" ? " bez PDV-a" : ""} × {line.quantity}</small></div>
      <div className="pos-quantity"><button onClick={() => quantity(line.id, -1)} type="button">−</button><span>{line.quantity}</span><button onClick={() => quantity(line.id, 1)} type="button">+</button></div>
      <b>{money(lineTotalCents(line, line.quantity) / 100)} €</b>
    </div>) : <p className="pos-empty">Dodirnite artikal da ga dodate na račun.</p>}</div>
    <div className="pos-total"><span>Ukupno sa PDV-om</span><strong>{money(totalCents / 100)} €</strong></div>
    <div className="pos-payments">{[["CASH", "Gotovina"], ["CARD", "Kartica"], ["BANK_TRANSFER", "Virman"]].map(([value, label]) => <button className={payment === value ? "active" : ""} key={value} onClick={() => setPayment(value)} type="button">{label}</button>)}</div>
    <form action={createAndFiscalizePosSale} className="pos-checkout-form"><PartnerSearchInput label={payment === "BANK_TRANSFER" ? "Kupac (obavezan za virman)" : "Kupac (opciono)"} name="buyer_id" required={payment === "BANK_TRANSFER"} /><input name="register_id" type="hidden" value={registerId} /><input name="payment_method" type="hidden" value={payment} /><input name="lines_json" type="hidden" value={JSON.stringify(cart.map((line) => ({ itemId: line.id, quantity: line.quantity })))} /><PayButton totalCents={totalCents} /></form>
  </div>;

  return <div className="pos-shell"><div className="pos-catalog">
    <div className="pos-toolbar"><label><span>Kasa</span><select value={registerId} onChange={(event) => changeRegister(event.target.value)}>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select><small>{selectedRegister?.warehouseType === "WHOLESALE" ? "Veleprodaja — cijene bez PDV-a" : "Maloprodaja — cijene sa PDV-om"}{selectedRegister?.warehouseName ? ` · ${selectedRegister.warehouseName}` : ""}</small></label><input aria-label="Pretraga artikala" autoComplete="off" inputMode="search" onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži naziv, šifru ili barkod…" value={query} /></div>
    <div className="pos-groups">{groups.map((name) => <button className={group === name ? "active" : ""} key={name} onClick={() => setGroup(name)} type="button">{name}</button>)}</div>
    <div className="pos-item-grid">{filtered.map((item) => <button className="pos-item" key={item.id} onClick={() => add(item)} type="button"><span>{item.group}</span><strong>{item.name}</strong><small>{item.code} · {item.unit}</small><b>{(item.warehouseType === "RETAIL" ? item.grossPrice : item.netPrice).toFixed(2)} €</b>{item.warehouseType === "WHOLESALE" ? <small>bez PDV-a</small> : null}</button>)}</div>
  </div><aside className={`pos-cart-column${cartOpen ? " open" : ""}`}>{cartPanel}</aside><button className="pos-mobile-cart" onClick={() => setCartOpen(true)} type="button"><span>{cart.reduce((sum, line) => sum + line.quantity, 0)} stavki</span><strong>{money(totalCents / 100)} €</strong></button></div>;
}
