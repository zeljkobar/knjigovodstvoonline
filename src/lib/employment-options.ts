export const workSchedules = {
 PUNO_8: {label:"Puno — 8 sati dnevno / 40 nedjeljno",daily:8,weekly:40,percentage:100},
 SKRACENO_6: {label:"Skraćeno — 6 sati dnevno / 30 nedjeljno",daily:6,weekly:30,percentage:75},
 SKRACENO_4: {label:"Skraćeno — 4 sata dnevno / 20 nedjeljno",daily:4,weekly:20,percentage:50},
 SKRACENO_2: {label:"Skraćeno — 2 sata dnevno / 10 nedjeljno",daily:2,weekly:10,percentage:25},
 SKRACENO_1: {label:"Skraćeno — 1 sat dnevno / 5 nedjeljno",daily:1,weekly:5,percentage:12.5}
} as const;
export function getWorkSchedule(key: string) { return Object.hasOwn(workSchedules,key) ? workSchedules[key as keyof typeof workSchedules] : null; }
export function strictEmploymentDate(value: string) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
 const date=new Date(`${value}T00:00:00Z`);
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
