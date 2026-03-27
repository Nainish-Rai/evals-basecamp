import { z } from "zod";

export const modelTierSchema = z.enum(["small", "medium", "large"]);

const modelTierRank = {
  small: 1,
  medium: 2,
  large: 3
} as const satisfies Record<z.infer<typeof modelTierSchema>, number>;

export type ModelTier = z.infer<typeof modelTierSchema>;

export function isStrictlySmallerModelTier(
  candidateTier: ModelTier,
  referenceTier: ModelTier
): boolean {
  return modelTierRank[candidateTier] < modelTierRank[referenceTier];
}
