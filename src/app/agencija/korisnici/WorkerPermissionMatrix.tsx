"use client";

import { useState } from "react";
import { configurablePermissionActions, permissionKey } from "@/lib/permission-policy";

const actionLabels = {
  view: "Pregled",
  create: "Unos",
  update: "Izmjena",
  delete: "Brisanje",
  post: "Knjiženje",
  cancel: "Storniranje",
  export: "Izvoz",
  manage: "Administracija"
};

function GroupCheckbox({ label, values, selected, onToggle }: {
  label: string;
  values: string[];
  selected: Set<string>;
  onToggle: (values: string[], checked: boolean) => void;
}) {
  const checked = values.every(value => selected.has(value));
  const partial = !checked && values.some(value => selected.has(value));

  return <label className="matrix-checkbox">
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      checked={checked}
      ref={input => { if (input) input.indeterminate = partial; }}
      onChange={event => onToggle(values, event.target.checked)}
    />
  </label>;
}

export function WorkerPermissionMatrix({ modules, initialPermissions }: {
  modules: string[];
  initialPermissions: string[];
}) {
  const [selected, setSelected] = useState(() => new Set(initialPermissions));

  function toggle(values: string[], checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      for (const value of values) {
        if (checked) next.add(value);
        else next.delete(value);
      }
      return next;
    });
  }

  return (
    <div className="permission-matrix-wrap">
      <table className="permission-matrix">
        <thead>
          <tr>
            <th scope="col">Pravo</th>
            {modules.map(module => {
              const label = module.replaceAll("_", " ");
              return (
                <th key={module} scope="col">
                  <div>{label}</div>
                  <GroupCheckbox label={`Sva prava za ${label}`}
                    values={configurablePermissionActions.map(action => permissionKey(module, action))}
                    selected={selected} onToggle={toggle} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {configurablePermissionActions.map(action => (
            <tr key={action}>
              <th scope="row">
                <div className="permission-matrix-row-label">
                  {actionLabels[action]}
                  <GroupCheckbox label={`${actionLabels[action]} za sve module`}
                    values={modules.map(module => permissionKey(module, action))}
                    selected={selected} onToggle={toggle} />
                </div>
              </th>
              {modules.map(module => {
                const value = permissionKey(module, action);
                return (
                  <td key={value}>
                    <label className="matrix-checkbox">
                      <input
                        type="checkbox"
                        name="prava"
                        value={value}
                        checked={selected.has(value)}
                        onChange={event => toggle([value], event.target.checked)}
                      />
                      <span>{actionLabels[action]} · {module.replaceAll("_", " ")}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
