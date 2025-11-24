import { init } from "@instantdb/admin";
import schema from "../instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;

export const adminDb = init({ appId, adminToken, schema });
