import { payrollCategories } from "./payroll";

export type PayrollPostingComponent = {
  code: string;
  label: string;
  group: string;
  sourceField: string;
  order: number;
  aggregate: boolean;
};

export const payrollPostingComponents: PayrollPostingComponent[] = [
  {
    code: "NETO_ZA_ISPLATU",
    label: "Neto za isplatu",
    group: "Zarada i obaveze",
    sourceField: "neto_za_isplatu_cent",
    order: 10,
    aggregate: false
  },
  {
    code: "POREZ",
    label: "Porez",
    group: "Zarada i obaveze",
    sourceField: "porez_cent",
    order: 20,
    aggregate: false
  },
  {
    code: "PRIREZ",
    label: "Prirez",
    group: "Zarada i obaveze",
    sourceField: "prirez_cent",
    order: 30,
    aggregate: false
  },
  {
    code: "ZAPOSLENI_PIO",
    label: "PIO — zaposleni",
    group: "Doprinosi zaposlenog",
    sourceField: "zaposleni_pio_cent",
    order: 40,
    aggregate: false
  },
  {
    code: "ZAPOSLENI_ZDRAVSTVO",
    label: "Zdravstvo — zaposleni",
    group: "Doprinosi zaposlenog",
    sourceField: "zaposleni_zdravstvo_cent",
    order: 50,
    aggregate: false
  },
  {
    code: "ZAPOSLENI_NEZAPOSLENOST",
    label: "Nezaposlenost — zaposleni",
    group: "Doprinosi zaposlenog",
    sourceField: "zaposleni_nezaposleni_cent",
    order: 60,
    aggregate: false
  },
  {
    code: "POSLODAVAC_PIO",
    label: "PIO — poslodavac",
    group: "Doprinosi poslodavca",
    sourceField: "poslodavac_pio_cent",
    order: 70,
    aggregate: false
  },
  {
    code: "POSLODAVAC_ZDRAVSTVO",
    label: "Zdravstvo — poslodavac",
    group: "Doprinosi poslodavca",
    sourceField: "poslodavac_zdravstvo_cent",
    order: 80,
    aggregate: false
  },
  {
    code: "POSLODAVAC_NEZAPOSLENOST",
    label: "Nezaposlenost — poslodavac",
    group: "Doprinosi poslodavca",
    sourceField: "poslodavac_nezaposleni_cent",
    order: 90,
    aggregate: false
  },
  {
    code: "FOND_RADA",
    label: "Fond rada",
    group: "Ostale obaveze",
    sourceField: "fond_rada_cent",
    order: 100,
    aggregate: false
  },
  {
    code: "INVALIDI",
    label: "Doprinos za profesionalnu rehabilitaciju i zapošljavanje lica sa invaliditetom",
    group: "Ostale obaveze",
    sourceField: "invalidi_cent",
    order: 110,
    aggregate: false
  },
  {
    code: "SINDIKAT",
    label: "Sindikat",
    group: "Ostale obaveze",
    sourceField: "sindikat_cent",
    order: 120,
    aggregate: false
  },
  {
    code: "PRIVREDNA_KOMORA",
    label: "Privredna komora",
    group: "Ostale obaveze",
    sourceField: "privredna_komora_cent",
    order: 130,
    aggregate: false
  },
  {
    code: "FOND_REKREACIJA",
    label: "Fond rekreacije",
    group: "Ostale obaveze",
    sourceField: "fond_rekreacija_cent",
    order: 140,
    aggregate: false
  },
  {
    code: "BRUTO_ZARADA",
    label: "Bruto zarada — zbirno",
    group: "Alternativne zbirne stavke",
    sourceField: "bruto_cent",
    order: 200,
    aggregate: true
  },
  {
    code: "DOPRINOSI_ZAPOSLENI_UKUPNO",
    label: "Doprinosi zaposlenog — zbirno",
    group: "Alternativne zbirne stavke",
    sourceField: "doprinosi_zaposleni_cent",
    order: 210,
    aggregate: true
  },
  {
    code: "DOPRINOSI_POSLODAVAC_UKUPNO",
    label: "Doprinosi poslodavca — zbirno",
    group: "Alternativne zbirne stavke",
    sourceField: "doprinosi_poslodavac_cent",
    order: 220,
    aggregate: true
  },
  {
    code: "UKUPNI_TROSAK",
    label: "Ukupni trošak — zbirno",
    group: "Alternativne zbirne stavke",
    sourceField: "ukupni_trosak_cent",
    order: 230,
    aggregate: true
  }
];

type PostingDefault = {
  active: boolean;
  debitCode: string | null;
  creditCode: string | null;
};

const regularDefaults: Record<string, PostingDefault> = {
  NETO_ZA_ISPLATU: { active: true, debitCode: "5200", creditCode: "4500" },
  POREZ: { active: true, debitCode: "5207", creditCode: "4510" },
  PRIREZ: { active: true, debitCode: "5559", creditCode: "4510" },
  ZAPOSLENI_PIO: { active: true, debitCode: "5208", creditCode: "4520" },
  ZAPOSLENI_ZDRAVSTVO: { active: true, debitCode: "5208", creditCode: "4521" },
  ZAPOSLENI_NEZAPOSLENOST: { active: true, debitCode: "5208", creditCode: "4522" },
  POSLODAVAC_PIO: { active: true, debitCode: "5211", creditCode: "4530" },
  POSLODAVAC_ZDRAVSTVO: { active: true, debitCode: "5211", creditCode: "4531" },
  POSLODAVAC_NEZAPOSLENOST: { active: true, debitCode: "5211", creditCode: "4532" },
  FOND_RADA: { active: true, debitCode: "5290", creditCode: "4693" },
  INVALIDI: { active: true, debitCode: "5211", creditCode: "4533" },
  SINDIKAT: { active: true, debitCode: "5290", creditCode: "4692" },
  PRIVREDNA_KOMORA: { active: true, debitCode: "5540", creditCode: "4690" },
  FOND_REKREACIJA: { active: false, debitCode: "5290", creditCode: "4693" }
};

const categoryDefaults: Record<string, { expenseCode: string; netLiabilityCode: string }> = {
  [payrollCategories.serviceContract]: {
    expenseCode: "522",
    netLiabilityCode: "4651"
  },
  [payrollCategories.rent]: {
    expenseCode: "5339",
    netLiabilityCode: "4654"
  },
  [payrollCategories.otherContracts]: {
    expenseCode: "525",
    netLiabilityCode: "4654"
  }
};

export function payrollPostingDefault(category: string, componentCode: string): PostingDefault {
  if (category === payrollCategories.regularWork) {
    return (
      regularDefaults[componentCode] ?? {
        active: false,
        debitCode: null,
        creditCode: null
      }
    );
  }

  const categoryDefault = categoryDefaults[category];
  const component = payrollPostingComponents.find((item) => item.code === componentCode);

  if (!categoryDefault || !component || component.aggregate) {
    return {
      active: false,
      debitCode: null,
      creditCode: null
    };
  }

  return {
    active: true,
    debitCode: categoryDefault.expenseCode,
    creditCode:
      componentCode === "NETO_ZA_ISPLATU"
        ? categoryDefault.netLiabilityCode
        : "4892"
  };
}

export type PayrollPostingAmountLine = {
  neto_za_isplatu_cent: number;
  porez_cent: number;
  prirez_cent: number;
  zaposleni_pio_cent: number;
  zaposleni_zdravstvo_cent: number;
  zaposleni_nezaposleni_cent: number;
  poslodavac_pio_cent: number;
  poslodavac_zdravstvo_cent: number;
  poslodavac_nezaposleni_cent: number;
  fond_rada_cent: number;
  sindikat_cent: number;
  privredna_komora_cent: number;
  bruto_cent: number;
  doprinosi_zaposleni_cent: number;
  doprinosi_poslodavac_cent: number;
  ukupni_trosak_cent: number;
};

export function payrollPostingAmountCents(
  componentCode: string,
  lines: PayrollPostingAmountLine[]
) {
  return lines.reduce((total, line) => {
    if (componentCode === "NETO_ZA_ISPLATU") {
      return total + line.neto_za_isplatu_cent;
    }

    if (componentCode === "POREZ") {
      return total + line.porez_cent;
    }

    if (componentCode === "PRIREZ") {
      return total + line.prirez_cent;
    }

    if (componentCode === "ZAPOSLENI_PIO") {
      return total + line.zaposleni_pio_cent;
    }

    if (componentCode === "ZAPOSLENI_ZDRAVSTVO") {
      return total + line.zaposleni_zdravstvo_cent;
    }

    if (componentCode === "ZAPOSLENI_NEZAPOSLENOST") {
      return total + line.zaposleni_nezaposleni_cent;
    }

    if (componentCode === "POSLODAVAC_PIO") {
      return total + line.poslodavac_pio_cent;
    }

    if (componentCode === "POSLODAVAC_ZDRAVSTVO") {
      return total + line.poslodavac_zdravstvo_cent;
    }

    if (componentCode === "POSLODAVAC_NEZAPOSLENOST") {
      return total + line.poslodavac_nezaposleni_cent;
    }

    if (componentCode === "FOND_RADA") {
      return total + line.fond_rada_cent;
    }

    if (componentCode === "SINDIKAT") {
      return total + line.sindikat_cent;
    }

    if (componentCode === "PRIVREDNA_KOMORA") {
      return total + line.privredna_komora_cent;
    }

    if (componentCode === "BRUTO_ZARADA") {
      return total + line.bruto_cent;
    }

    if (componentCode === "DOPRINOSI_ZAPOSLENI_UKUPNO") {
      return total + line.doprinosi_zaposleni_cent;
    }

    if (componentCode === "DOPRINOSI_POSLODAVAC_UKUPNO") {
      return total + line.doprinosi_poslodavac_cent;
    }

    if (componentCode === "UKUPNI_TROSAK") {
      return total + line.ukupni_trosak_cent;
    }

    // INVALIDI i FOND_REKREACIJA su već podesivi, ali kalkulator još nema
    // zasebna obračunska polja za njih. Do tada ne stvaraju stavku naloga.
    return total;
  }, 0);
}

export function hasPayrollPostingAggregateConflict(
  activeComponentCodes: Set<string>,
  amountByComponent: Map<string, number>
) {
  const activeWithAmount = (code: string) =>
    activeComponentCodes.has(code) && (amountByComponent.get(code) ?? 0) > 0;
  const employeeDetails = [
    "ZAPOSLENI_PIO",
    "ZAPOSLENI_ZDRAVSTVO",
    "ZAPOSLENI_NEZAPOSLENOST"
  ];
  const employerDetails = [
    "POSLODAVAC_PIO",
    "POSLODAVAC_ZDRAVSTVO",
    "POSLODAVAC_NEZAPOSLENOST",
    "FOND_RADA",
    "SINDIKAT",
    "PRIVREDNA_KOMORA"
  ];
  const grossDetails = [
    "NETO_ZA_ISPLATU",
    "POREZ",
    "PRIREZ",
    ...employeeDetails
  ];
  const allDetails = [...grossDetails, ...employerDetails];

  return (
    (activeWithAmount("BRUTO_ZARADA") && grossDetails.some(activeWithAmount)) ||
    (activeWithAmount("DOPRINOSI_ZAPOSLENI_UKUPNO") &&
      employeeDetails.some(activeWithAmount)) ||
    (activeWithAmount("DOPRINOSI_POSLODAVAC_UKUPNO") &&
      employerDetails.some(activeWithAmount)) ||
    (activeWithAmount("UKUPNI_TROSAK") && allDetails.some(activeWithAmount))
  );
}
