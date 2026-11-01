import { z } from 'zod';
import { VEHICLE_PAINTS, VEHICLE_PAINT_FINISHES, type VehiclePaintFinish, type VehiclePaintId } from './catalog.js';
import { CITIZEN_TASKS } from './tasks.js';
import { CIVIC_REPORT_SITES } from './civic.js';

export const registerSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, 'Use 3–20 letters, numbers or underscores.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72),
  displayName: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N} .'-]+$/u, 'Display name contains unsupported characters.'),
});

export const loginSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(20),
  password: z.string().min(1).max(72),
});

export const appearanceSchema = z.object({
  skin: z.number().int().min(0).max(5),
  hair: z.number().int().min(0).max(3),
  top: z.number().int().min(0).max(5),
  bottom: z.number().int().min(0).max(3),
});

export const onboardingSchema = z.object({ status: z.enum(['completed', 'dismissed']) }).strict();

export const acceptJobSchema = z.object({ vehicleId: z.string().uuid() });

const lifestyleRequest = { requestId: z.string().uuid() };
export const vehicleConfigurationSchema = z.object({
  paintId: z.custom<VehiclePaintId>((value) => typeof value === 'string' && VEHICLE_PAINTS.some((paint) => paint.id === value), 'Choose a supported factory paint.'),
  finish: z.custom<VehiclePaintFinish>((value) => typeof value === 'string' && Object.hasOwn(VEHICLE_PAINT_FINISHES, value), 'Choose a supported paint finish.'),
});
export const purchasePropertySchema = z.object({ ...lifestyleRequest, listingId: z.enum(['sinkor-studio', 'coastal-cottage']) });
export const upgradePropertySchema = z.object({ ...lifestyleRequest, propertyId: z.string().uuid() });
export const purchaseVehicleSchema = z.object({
  ...lifestyleRequest,
  modelId: z.enum(['modern-sedan', 'modern-suv', 'city-hatchback', 'taxi-sedan', 'city-minibus']),
  configuration: vehicleConfigurationSchema.optional(),
});
export const upgradeVehicleSchema = z.object({ ...lifestyleRequest, vehicleId: z.string().uuid(), kind: z.enum(['engine', 'brakes', 'tires']) });
export const selectVehicleSchema = z.object({ ...lifestyleRequest, vehicleId: z.string().uuid() });

const citizenTaskRequest = { requestId: z.string().uuid() };
export const acceptCitizenTaskSchema = z.object({
  ...citizenTaskRequest,
  templateId: z.string().trim().min(1).max(80).refine((value) => CITIZEN_TASKS.some((task) => task.id === value), 'Unknown citizen task.'),
  incidentId: z.string().uuid().optional(),
});
export const advanceCitizenTaskSchema = z.object({
  ...citizenTaskRequest,
  stepId: z.string().trim().min(1).max(80),
  position: z.tuple([z.number().finite(), z.number().finite()]),
});
export const cancelCitizenTaskSchema = z.object(citizenTaskRequest);

export const reportCivicIncidentSchema = z.object({
  requestId: z.string().uuid(),
  siteId: z.string().trim().min(1).max(80).refine((value) => CIVIC_REPORT_SITES.some((site) => site.id === value), 'Unknown civic report site.'),
});
