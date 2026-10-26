import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);
