// Injury categories, shared by the duration calibration (nflverse report labels: scripts/calibrate/injury-durations.ts)
// and the app (Sleeper's injury_body_part), so both sides group "Right Shoulder" and "shoulder" alike.
import { INJURY_DURATIONS, type InjuryDuration } from './injury-durations';

/** Category name → pattern on the lowercased label. First match wins; order matters ("hip" before "hip flexor"-ish overlaps). */
export const INJURY_CATEGORIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Not injury', /not injury|personal|resting|coach|covid|suspen/],
  ['Concussion', /concussion|head/],
  ['Hamstring', /hamstring/],
  ['Ankle', /ankle/],
  ['Knee', /knee|acl|mcl|pcl|meniscus/],
  ['Achilles', /achilles/],
  ['Calf / lower leg', /calf|shin|lower leg|fibula|tibia/],
  ['Quad / thigh', /quad|thigh/],
  ['Groin / hip', /groin|hip|hernia|pelvi/],
  ['Abdomen / oblique', /abdom|oblique|core/],
  ['Foot / toe', /foot|toe|heel/],
  ['Back', /back/],
  ['Neck', /neck|stinger/],
  ['Shoulder', /shoulder|collarbone|clavic/],
  ['Ribs / chest', /rib|chest|pectoral|sternum/],
  ['Hand / wrist', /hand|wrist|thumb|finger/],
  ['Arm / elbow', /elbow|forearm|bicep|tricep|arm/],
  ['Illness', /illness|sick/],
];

/** The category of an injury label, 'Other' for an unrecognized one, undefined for none. */
export function injuryCategory(label: string | null | undefined): string | undefined {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return undefined;
  return INJURY_CATEGORIES.find(([, re]) => re.test(l))?.[0] ?? 'Other';
}

/**
 * How long absences with this injury lasted: its own category's numbers when it had enough absences (`own`), else
 * all injuries'. Undefined without an injury label or for a non-injury absence.
 */
export function injuryDuration(label: string | null | undefined): { category: string; own: boolean; duration: InjuryDuration } | undefined {
  const category = injuryCategory(label);
  if (!category || category === 'Not injury') return undefined;
  const own = INJURY_DURATIONS[category];
  if (own) return { category, own: true, duration: own };
  const all = INJURY_DURATIONS['All injuries'];
  return all ? { category, own: false, duration: all } : undefined;
}
