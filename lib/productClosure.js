import { z } from "zod";

export const productClosureSchema = z.object({
  product: z.enum(["reactivation", "demat", "mutual_fund_sip", "mutual_fund_lumpsum", "privilege_account", "corporate", "iepf", "ra_package"]),
  notes: z.string().trim().max(1000),
});
