"use client";

import { useEffect, useMemo, useState } from "react";
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
  shiftOpen?: boolean;
};

type CartLine = Item & { quantity: number };

type PaymentMethod = { value: string; label: string };
type PosSaleAction = (formData: FormData) => void | Promise<void>;

type PosTerminalProps = {
  items: Item[];
  registers: Register[];
  saleAction?: PosSaleAction;
  paymentMethods?: readonly PaymentMethod[];
  partnerSearchEndpoint?: string;
  partnerQuickCreateEndpoint?: string;
  partnerCompanyOnly?: boolean;
  canCreate?: boolean;
  requiresShift?: boolean;
  blockedReason?: string | null;
};

const defaultPaymentMethods: readonly PaymentMethod[] = [
  { value: "CASH", label: "Gotovina" },
  { value: "CARD", label: "Kartica" },
  { value: "BANK_TRANSFER", label: "Virman" }
];

function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function lineTotalCents(line: Item, quantity: number) {
  if (line.warehouseType === "RETAIL") {
    return Math.round(line.grossPrice * 100) * quantity;
  }

  const baseCents = Math.round(line.netPrice * 100) * quantity;
  return baseCents + Math.round((baseCents * line.vatPercent) / 100);
}

function PayButton({ blocked, totalCents }: { blocked: boolean; totalCents: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="pos-pay-button"
      disabled={blocked || pending || totalCents <= 0}
      type="submit"
    >
      {pending ? "Fiskalizacija…" : `Naplati ${money(totalCents / 100)} €`}
    </button>
  );
}

export function PosTerminal({
  items,
  registers,
  saleAction = createAndFiscalizePosSale,
  paymentMethods = defaultPaymentMethods,
  partnerSearchEndpoint,
  partnerQuickCreateEndpoint,
  partnerCompanyOnly = false,
  canCreate = true,
  requiresShift = false,
  blockedReason = null
}: PosTerminalProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Sve");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? "");
  const firstPayment =
    paymentMethods.find((method) => method.value === registers[0]?.defaultPayment)?.value ??
    paymentMethods[0]?.value ??
    "";
  const [payment, setPayment] = useState(firstPayment);
  const [cartOpen, setCartOpen] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const selectedRegister =
    registers.find((register) => register.id === registerId) ?? registers[0];
  const registerItems = useMemo(
    () => items.filter((item) => item.registerId === registerId),
    [items, registerId]
  );
  const groups = useMemo(
    () => ["Sve", ...Array.from(new Set(registerItems.map((item) => item.group)))],
    [registerItems]
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();

    return registerItems.filter(
      (item) =>
        (group === "Sve" || item.group === group) &&
        (!needle ||
          `${item.code} ${item.name} ${item.barcode ?? ""}`
            .toLocaleLowerCase()
            .includes(needle))
    );
  }, [registerItems, query, group]);
  const totalCents = cart.reduce(
    (sum, line) => sum + lineTotalCents(line, line.quantity),
    0
  );
  const shiftBlocked = requiresShift && !selectedRegister?.shiftOpen;
  const checkoutBlocked =
    !canCreate || Boolean(blockedReason) || shiftBlocked || !payment || !submissionId;

  useEffect(() => {
    setSubmissionId(window.crypto.randomUUID());
  }, []);

  function add(item: Item) {
    setCart((current) => {
      const found = current.find((line) => line.id === item.id);

      return found
        ? current.map((line) =>
            line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line
          )
        : [...current, { ...item, quantity: 1 }];
    });
  }

  function quantity(id: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.id === id ? { ...line, quantity: line.quantity + delta } : line
        )
        .filter((line) => line.quantity > 0)
    );
  }

  function changeRegister(nextId: string) {
    const nextRegister = registers.find((register) => register.id === nextId);
    const nextPayment =
      paymentMethods.find((method) => method.value === nextRegister?.defaultPayment)?.value ??
      paymentMethods[0]?.value ??
      "";

    setRegisterId(nextId);
    setPayment(nextPayment);
    setGroup("Sve");
    setCart([]);
  }

  const cartPanel = (
    <div className="pos-cart">
      <div className="pos-cart-header">
        <div>
          <span>Račun</span>
          <strong>{cart.reduce((sum, line) => sum + line.quantity, 0)} stavki</strong>
        </div>
        <button className="pos-mobile-close" onClick={() => setCartOpen(false)} type="button">
          Zatvori
        </button>
      </div>
      <div className="pos-cart-lines">
        {cart.length ? (
          cart.map((line) => (
            <div className="pos-cart-line" key={line.id}>
              <div>
                <strong>{line.name}</strong>
                <small>
                  {(line.warehouseType === "RETAIL" ? line.grossPrice : line.netPrice).toFixed(2)} €
                  {line.warehouseType === "WHOLESALE" ? " bez PDV-a" : ""} × {line.quantity}
                </small>
              </div>
              <div className="pos-quantity">
                <button onClick={() => quantity(line.id, -1)} type="button">−</button>
                <span>{line.quantity}</span>
                <button onClick={() => quantity(line.id, 1)} type="button">+</button>
              </div>
              <b>{money(lineTotalCents(line, line.quantity) / 100)} €</b>
            </div>
          ))
        ) : (
          <p className="pos-empty">Dodirnite artikal da ga dodate na račun.</p>
        )}
      </div>
      <div className="pos-total">
        <span>Ukupno sa PDV-om</span>
        <strong>{money(totalCents / 100)} €</strong>
      </div>
      <div className="pos-payments">
        {paymentMethods.map(({ value, label }) => (
          <button
            className={payment === value ? "active" : ""}
            key={value}
            onClick={() => setPayment(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {shiftBlocked ? (
        <p className="status-banner error">Otvorite smjenu na izabranoj kasi prije naplate.</p>
      ) : null}
      {blockedReason ? <p className="status-banner error">{blockedReason}</p> : null}
      {!canCreate ? (
        <p className="status-banner error">Nemate pravo izdavanja POS računa.</p>
      ) : null}
      <form action={saleAction} className="pos-checkout-form">
        <PartnerSearchInput
          companyOnly={partnerCompanyOnly}
          label={payment === "BANK_TRANSFER" ? "Kupac (obavezan za virman)" : "Kupac (opciono)"}
          name="buyer_id"
          quickCreateEndpoint={partnerQuickCreateEndpoint}
          required={payment === "BANK_TRANSFER"}
          searchEndpoint={partnerSearchEndpoint}
        />
        <input name="register_id" type="hidden" value={registerId} />
        <input name="payment_method" type="hidden" value={payment} />
        <input name="submission_id" type="hidden" value={submissionId} />
        <input
          name="lines_json"
          type="hidden"
          value={JSON.stringify(cart.map((line) => ({ itemId: line.id, quantity: line.quantity })))}
        />
        <PayButton blocked={checkoutBlocked} totalCents={totalCents} />
      </form>
    </div>
  );

  return (
    <div className="pos-shell">
      <div className="pos-catalog">
        <div className="pos-toolbar">
          <label>
            <span>Kasa</span>
            <select value={registerId} onChange={(event) => changeRegister(event.target.value)}>
              {registers.map((register) => (
                <option key={register.id} value={register.id}>{register.name}</option>
              ))}
            </select>
            <small>
              {selectedRegister?.warehouseType === "WHOLESALE"
                ? "Veleprodaja — cijene bez PDV-a"
                : "Maloprodaja — cijene sa PDV-om"}
              {selectedRegister?.warehouseName ? ` · ${selectedRegister.warehouseName}` : ""}
            </small>
          </label>
          <input
            aria-label="Pretraga artikala"
            autoComplete="off"
            inputMode="search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pretraži naziv, šifru ili barkod…"
            value={query}
          />
        </div>
        <div className="pos-groups">
          {groups.map((name) => (
            <button
              className={group === name ? "active" : ""}
              key={name}
              onClick={() => setGroup(name)}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>
        <div className="pos-item-grid">
          {filtered.map((item) => (
            <button className="pos-item" key={item.id} onClick={() => add(item)} type="button">
              <span>{item.group}</span>
              <strong>{item.name}</strong>
              <small>{item.code} · {item.unit}</small>
              <b>{(item.warehouseType === "RETAIL" ? item.grossPrice : item.netPrice).toFixed(2)} €</b>
              {item.warehouseType === "WHOLESALE" ? <small>bez PDV-a</small> : null}
            </button>
          ))}
        </div>
      </div>
      <aside className={`pos-cart-column${cartOpen ? " open" : ""}`}>{cartPanel}</aside>
      <button className="pos-mobile-cart" onClick={() => setCartOpen(true)} type="button">
        <span>{cart.reduce((sum, line) => sum + line.quantity, 0)} stavki</span>
        <strong>{money(totalCents / 100)} €</strong>
      </button>
    </div>
  );
}
