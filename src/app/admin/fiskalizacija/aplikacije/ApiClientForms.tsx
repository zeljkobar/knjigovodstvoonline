"use client";

import { useActionState } from "react";
import {
  createFiscalApiClient,
  rotateFiscalApiClientKey,
  type ApiClientActionState
} from "../actions";

const initialState: ApiClientActionState = {};

const permissionGroups = [
  {
    title: "Računi",
    description: "Šta aplikacija smije raditi sa fiskalnim računima.",
    items: [
      ["invoices:create", "Kreiranje nacrta"],
      ["invoices:read", "Pregled računa i statusa"],
      ["invoices:fiscalize", "Slanje na fiskalizaciju"],
      ["invoices:storno", "Kreiranje storna"]
    ]
  },
  {
    title: "Firme i podešavanja",
    description: "Administracija firmi i njihove fiskalne konfiguracije.",
    items: [
      ["companies:read", "Pregled firmi"],
      ["companies:write", "Aktivacija i izmjena firmi"],
      ["configuration:read", "Pregled jedinica, ENU-a i operatera"],
      ["configuration:write", "Izmjena jedinica, ENU-a i operatera"]
    ]
  },
  {
    title: "Sertifikati i nadzor",
    description: "Elektronski pečati, upozorenja i trag aktivnosti.",
    items: [
      ["certificates:read", "Pregled sertifikata"],
      ["certificates:manage", "Upload, aktivacija i deaktivacija"],
      ["alerts:read", "Pregled upozorenja"],
      ["alerts:manage", "Označavanje upozorenja"],
      ["audit:read", "Pregled audit zapisa"]
    ]
  },
  {
    title: "Aktivacija okruženja",
    description: "Kontrola prelaska iz testa u produkciju.",
    items: [
      ["activation:read", "Pregled aktivacionog statusa"],
      ["activation:test", "Potvrda kontrolnog testa"],
      ["activation:production", "Aktivacija produkcije i povratak u test"]
    ]
  },
  {
    title: "Platformska administracija",
    description: "Dodjeljuj samo centralnom programu kojim ti upravljaš.",
    items: [
      ["clients:admin", "Upravljanje API aplikacijama"],
      ["platform:admin", "Pristup svim sadašnjim i budućim firmama"]
    ]
  }
] as const;

export function CreateApiClientForm({
  companies
}: {
  companies: Array<{ id: string; name: string; tin: string }>;
}) {
  const [state, action, pending] = useActionState(
    createFiscalApiClient,
    initialState
  );

  return (
    <form className="api-client-form" action={action}>
      <section className="api-form-step">
        <div className="api-step-heading">
          <span>1</span>
          <div>
            <h4>Osnovni podaci</h4>
            <p>Naziv govori koji program koristi ovaj pristup.</p>
          </div>
        </div>
        <div className="api-basic-grid">
          <label>
            <span>Naziv aplikacije</span>
            <input name="name" placeholder="npr. Summa mobilna aplikacija" required />
          </label>
          <label>
            <span>Pristup važi do (opciono)</span>
            <input name="expires_at" type="datetime-local" />
          </label>
        </div>
      </section>

      <section className="api-form-step">
        <div className="api-step-heading">
          <span>2</span>
          <div>
            <h4>Dozvole aplikacije</h4>
            <p>Označi samo operacije koje su ovom programu stvarno potrebne.</p>
          </div>
        </div>
        <div className="api-permission-groups">
          {permissionGroups.map((group) => (
            <fieldset className="api-permission-group" key={group.title}>
              <legend>{group.title}</legend>
              <p>{group.description}</p>
              <div className="api-checkbox-list">
                {group.items.map(([value, label]) => (
                  <label className="api-checkbox" key={value}>
                    <input type="checkbox" name="permissions" value={value} />
                    <span>
                      <strong>{label}</strong>
                      <code>{value}</code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="api-form-step">
        <div className="api-step-heading">
          <span>3</span>
          <div>
            <h4>Firme kojima aplikacija pristupa</h4>
            <p>
              Za običnu aplikaciju označi konkretne firme. Ako si gore dao
              <code> platform:admin</code>, ona automatski vidi sve firme i ovaj
              izbor se zanemaruje.
            </p>
          </div>
        </div>
        <div className="api-company-grid">
          {companies.length ? (
            companies.map((company) => (
              <label className="api-checkbox api-company-option" key={company.id}>
                <input type="checkbox" name="company_ids" value={company.id} />
                <span>
                  <strong>{company.name}</strong>
                  <small>PIB {company.tin}</small>
                </span>
              </label>
            ))
          ) : (
            <p>Nema fiskalnih firmi za dodjelu.</p>
          )}
        </div>
      </section>

      <section className="api-form-submit">
        <div>
          <strong>Ključ će biti prikazan samo jednom.</strong>
          <p>Odmah ga kopiraj u bezbjedno čuvanje tajni aplikacije.</p>
        </div>
        <button disabled={pending}>
          {pending ? "Kreiranje…" : "Kreiraj aplikaciju i ključ"}
        </button>
      </section>
      <SecretResult state={state} />
    </form>
  );
}

export function RotateKeyForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    rotateFiscalApiClientKey,
    initialState
  );
  return (
    <form className="api-inline-action" action={action}>
      <input type="hidden" name="client_id" value={id} />
      <button disabled={pending}>{pending ? "Rotiranje…" : "Rotiraj ključ"}</button>
      <SecretResult state={state} />
    </form>
  );
}

function SecretResult({ state }: { state: ApiClientActionState }) {
  if (state.error) return <p className="admin-message">{state.error}</p>;
  if (!state.apiKey) return null;
  return (
    <div className="api-secret-result" role="status">
      <strong>Sačuvaj odmah — ovaj ključ se više neće prikazati.</strong>
      <p>Client ID</p>
      <code>{state.clientId}</code>
      <p>API ključ</p>
      <code>{state.apiKey}</code>
    </div>
  );
}
