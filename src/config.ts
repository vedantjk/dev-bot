import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
  GITHUB_USERNAME: z.string().min(1, 'GITHUB_USERNAME is required'),
  AUTHORIZED_PHONE: z.string().min(1, 'AUTHORIZED_PHONE is required'),
  DAILY_BUDGET_USD: z.coerce.number().default(5.0),
});

export const config = configSchema.parse(process.env);
export type Config = z.infer<typeof configSchema>;
