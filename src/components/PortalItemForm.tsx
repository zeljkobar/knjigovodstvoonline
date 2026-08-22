type PortalItemFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  buttonLabel: string;
  groups: Array<{ id: string; sifra: string; naziv: string }>;
  units: Array<{ id: string; sifra: string; naziv: string }>;
  vatRates: Array<{ id: string; naziv: string; procenat: { toString(): string } }>;
  initial?: {
    id: string;
    sifra: string;
    naziv: string;
    barkod: string | null;
    grupa_artikla_id: string | null;
    jedinica_mjere_id: string;
    pdv_stopa_id: string | null;
    usluga: boolean;
    prati_zalihe: boolean;
    napomena: string | null;
  };
};

export function PortalItemForm({
  action,
  buttonLabel,
  groups,
  units,
  vatRates,
  initial
}: PortalItemFormProps) {
  return (
    <form action={action} className="admin-form inventory-item-form">
      {initial ? (
        <input name="artikal_id" type="hidden" value={initial.id} />
      ) : null}
      <label>
        <span>Šifra</span>
        <input
          defaultValue={initial?.sifra ?? ""}
          maxLength={40}
          name="sifra"
          placeholder={initial ? "" : "Automatska ili ručna"}
          required={Boolean(initial)}
        />
      </label>
      <label className="form-span-2">
        <span>Naziv</span>
        <input
          defaultValue={initial?.naziv ?? ""}
          maxLength={200}
          name="naziv"
          required
        />
      </label>
      <label>
        <span>Barkod</span>
        <input
          defaultValue={initial?.barkod ?? ""}
          maxLength={80}
          name="barkod"
        />
      </label>
      <label>
        <span>Grupa</span>
        <select
          defaultValue={initial?.grupa_artikla_id ?? ""}
          name="grupa_artikla_id"
        >
          <option value="">Bez grupe</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.sifra} — {group.naziv}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Jedinica mjere</span>
        <select
          defaultValue={initial?.jedinica_mjere_id ?? units[0]?.id}
          name="jedinica_mjere_id"
          required
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.sifra} — {unit.naziv}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>PDV stopa</span>
        <select
          defaultValue={initial?.pdv_stopa_id ?? ""}
          name="pdv_stopa_id"
        >
          <option value="">Bez PDV stope</option>
          {vatRates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.naziv} ({rate.procenat.toString()}%)
            </option>
          ))}
        </select>
      </label>
      {!initial ? (
        <>
          <label>
            <span>Veleprodajna cijena bez PDV-a</span>
            <input
              inputMode="decimal"
              min="0"
              name="veleprodajna_cijena"
              placeholder="Opciono"
              step="0.01"
              type="number"
            />
          </label>
          <label>
            <span>Maloprodajna cijena sa PDV-om</span>
            <input
              inputMode="decimal"
              min="0"
              name="maloprodajna_cijena"
              placeholder="Opciono"
              step="0.01"
              type="number"
            />
          </label>
        </>
      ) : null}
      <label className="checkbox-card">
        <input
          defaultChecked={initial?.usluga ?? false}
          name="usluga"
          type="checkbox"
        />
        <span>Usluga</span>
      </label>
      <label className="checkbox-card">
        <input
          defaultChecked={initial?.prati_zalihe ?? true}
          name="prati_zalihe"
          type="checkbox"
        />
        <span>Prati zalihe (samo za robu)</span>
      </label>
      <label className="form-span-2">
        <span>Opis / napomena</span>
        <textarea
          defaultValue={initial?.napomena ?? ""}
          name="napomena"
          rows={3}
        />
      </label>
      <button type="submit">{buttonLabel}</button>
    </form>
  );
}
