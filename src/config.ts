import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_USERNAME: z.string().default(''),
  AUTHORIZED_CHAT: z.string().default(''),
  DAILY_BUDGET_USD: z.coerce.number().default(5.0),
});

export const config = configSchema.parse(process.env);
export type Config = z.infer<typeof configSchema>;
