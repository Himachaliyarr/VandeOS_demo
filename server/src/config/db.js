import { setServers } from "node:dns";
import mongoose from "mongoose";

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error("MONGODB_URI is required");
  const uriDatabase = new URL(uri).pathname.replace(/^\/+|\/+$/g, "");
  const dnsServers = process.env.MONGODB_DNS_SERVERS
    ?.split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers?.length) setServers(dnsServers);
  // mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
    ...(!uriDatabase && { dbName: process.env.MONGODB_DB_NAME || "vande_os" }),
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}
