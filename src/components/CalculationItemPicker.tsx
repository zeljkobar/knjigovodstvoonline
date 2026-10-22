"use client";

import { useState } from "react";
import { ItemSearchSelect } from "./ItemSearchSelect";
import {
  QuickItemCreateModal,
  type QuickItemResult
} from "@/components/QuickItemCreateModal";

type ItemOption = QuickItemResult;
type Option = { id: string; label: string };

type CalculationItemPickerProps = {
  groups: Option[];
  items: ItemOption[];
  units: Option[];
  vatRates: Option[];
  onConfirm?: () => void;
};

export function CalculationItemPicker({
  groups,
  items: initialItems,
  units,
  vatRates,
  onConfirm
}: CalculationItemPickerProps) {
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  function selectItem(item: QuickItemResult) {
    setItems((current) => [...current, item].sort((a, b) => a.sifra.localeCompare(b.sifra)));
    setSelectedId(item.id);
    setIsModalOpen(false);
    const salePriceInput = document.getElementById("calculation-sale-price") as HTMLInputElement | null;
    if (salePriceInput) salePriceInput.value = item.saleGrossPrice;
  }

  function changeItem(id: string) {
    setSelectedId(id);
    const selected = items.find((item) => item.id === id);
    const salePriceInput = document.getElementById("calculation-sale-price") as HTMLInputElement | null;
    if (selected?.saleGrossPrice && salePriceInput) {
      salePriceInput.value = selected.saleGrossPrice;
    }
  }

  return (
    <>
      <div className="calculation-item-picker">
        <label>
          <span>Artikal</span>
          <ItemSearchSelect
            name="artikal_id"
            required
            onConfirm={onConfirm}
            value={selectedId}
            onChange={(event) => changeItem(event.target.value)}
          >
            <option value="" disabled>Šifra · naziv · JM · PDV</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sifra} · {item.naziv} · {item.unitCode} · {item.vatPercent}%
              </option>
            ))}
          </ItemSearchSelect>
        </label>
        <button className="secondary-button" type="button" onClick={() => setIsModalOpen(true)}>
          + Novi artikal
        </button>
      </div>
      {isModalOpen ? (
        <QuickItemCreateModal
          groups={groups}
          units={units}
          vatRates={vatRates}
          onClose={() => setIsModalOpen(false)}
          onCreated={selectItem}
        />
      ) : null}
    </>
  );
}
